'use strict';

/**
 * telegram/TelegramService.js
 *
 * Manages the GramJS Telegram client lifecycle:
 *  - Initialise and connect using StringSession
 *  - Listen for new messages across all subscribed chats
 *  - Auto-reconnect on disconnect
 *  - Graceful shutdown
 *  - Emit parsed message events to the processing pipeline
 */

const { TelegramClient, Logger: GramLogger } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { EventEmitter } = require('events');

const config = require('../config/env');
const logger = require('../utils/logger');
const { EVENTS } = require('../constants');
const { sleep } = require('../utils/asyncWrapper');

const log = logger.forModule('TelegramService');

// ─── Reconnect config ─────────────────────────────────────────────────────────

const RECONNECT_INITIAL_DELAY_MS = 5_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const RECONNECT_BACKOFF_FACTOR = 2;

class TelegramService extends EventEmitter {
  constructor() {
    super();
    this._client = null;
    this._isRunning = false;
    this._reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
    this._reconnectTimer = null;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialises the GramJS client, connects, and starts listening for messages.
   */
  async start() {
    if (this._isRunning) {
      log.warn('TelegramService already running; ignoring duplicate start()');
      return;
    }

    log.info('Starting TelegramService…');
    this._isRunning = true;

    await this._connect();
  }

  /**
   * Disconnects the client and stops all listeners.
   */
  async stop() {
    log.info('Stopping TelegramService…');
    this._isRunning = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._client) {
      try {
        await this._client.disconnect();
        log.info('Telegram client disconnected');
      } catch (err) {
        log.warn('Error during disconnect', { error: err.message });
      }
    }
  }

  /**
   * Returns true if the client is currently connected.
   */
  get isConnected() {
    return this._client?.connected ?? false;
  }

  // ─── Private: Connection ─────────────────────────────────────────────────────

  async _connect() {
    try {
      if (!this._client) {
        const session = new StringSession(config.telegram.stringSession);

        this._client = new TelegramClient(
          session,
          config.telegram.apiId,
          config.telegram.apiHash,
          {
            connectionRetries: 5,
            retryDelay: 1_000,
            autoReconnect: true,
            // Suppress the interactive login prompt — we have a pre-existing session
            baseLogger: this._buildGramLogger(),
          },
        );
        
        // Register handlers once
        this._registerEventHandlers();
      }

      log.info('Connecting to Telegram…');

      await this._client.connect();

      // Verify the session is valid
      const me = await this._client.getMe();
      log.info('Connected to Telegram', {
        username: me.username,
        id: me.id?.toString(),
      });

      // Catch up on very recent history (last few messages only)
      setImmediate(() => this._catchUpHistory());
    } catch (err) {
      log.error('Failed to connect to Telegram', { error: err.message });
      await this._scheduleReconnect();
    }
  }

  // ─── Private: Event Handlers ─────────────────────────────────────────────────

  _registerEventHandlers() {
    if (!this._client) return;

    // 1. Listen for ALL updates for debugging purposes and bulletproof raw message catching
    this._client.addEventHandler(async (event) => {
      const className = event.className || event.constructor.name;
      log.debug(`Raw Telegram update: ${className}`);

      if (className === 'UpdateNewChannelMessage' || className === 'UpdateNewMessage') {
        if (event.message) {
          try {
            await this._handleMessage(event.message);
          } catch (err) {
            log.error('Fallback message handler error', { error: err.message });
          }
        }
      }
    });

    // 2. Specific handler for New Messages using the recommended NewMessage event class
    this._client.addEventHandler(
      async (event) => {
        await this._handleMessage(event.message);
      },
      new NewMessage({}), // No filters, catch all
    );

    log.info('Telegram message listener registered');
  }

  /**
   * Processes a single Telegram message (new or historical).
   * @param {import('gramjs/tl/custom/message').Message} message
   */
  async _handleMessage(message) {
    try {
      if (!message) return;

      let chatIdStr = message.chatId?.toString();
      if (!chatIdStr && message.peerId) {
        if (message.peerId.channelId) chatIdStr = message.peerId.channelId.toString();
        else if (message.peerId.chatId) chatIdStr = message.peerId.chatId.toString();
        else if (message.peerId.userId) chatIdStr = message.peerId.userId.toString();
      }
      const chatId = chatIdStr ?? 'unknown';
      const messageId = `${chatId}:${message.id}`;

      // ─── Whitelist check ───────────────────────────────────────────────────
      const allowedChats = config.telegram.allowedChats;
      // Allow matches with or without the '-100' channel prefix
      const isAllowed = allowedChats.some(
        (id) => chatId === id || chatId === `-100${id}` || `-100${chatId}` === id
      );
      if (allowedChats.length > 0 && !isAllowed) {
        return;
      }

      log.info('Incoming message for processing', { chatId, messageId });

      const chatTitle = await this._resolveChatTitle(message);
      
      // Get raw text
      let text = message.message || message.text || '';

      // Extract hidden URLs from text entities and append to text so they can be processed and forwarded
      if (message.entities) {
        for (const entity of message.entities) {
          if (entity.className === 'MessageEntityTextUrl' && entity.url) {
            if (!text.includes(entity.url)) {
              text += `\n${entity.url}`;
            }
          }
        }
      }

      // Allow messages with text, photo, video, or document
      if (!text && !message.photo && !message.video && !message.document) return;

      // ─── Media Handling ────────────────────────────────────────────────────
      let imageBuffer = null;
      if (message.photo) {
        log.debug('Downloading photo from Telegram...', { messageId });
        try {
          imageBuffer = await this._client.downloadMedia(message.photo, { workers: 1 });
          log.info('Photo downloaded successfully', { messageId, size: imageBuffer.length });
        } catch (mediaErr) {
          log.warn('Failed to download photo', { messageId, error: mediaErr.message });
          imageBuffer = null; // Ensure it's null if download failed
        }
      }

      // Final check: if buffer is empty, treat as no image
      if (imageBuffer && imageBuffer.length === 0) {
        imageBuffer = null;
      }

      log.info('Processing Telegram message', {
        messageId,
        chatTitle,
        preview: text.slice(0, 80),
        hasImage: !!imageBuffer,
      });

      // Emit to pipeline — decoupled from Telegram internals
      this.emit(EVENTS.TELEGRAM_MESSAGE, {
        messageId,
        text,
        image: imageBuffer,
        chatTitle,
        chatId,
        rawMessage: message,
      });
    } catch (err) {
      log.error('Error handling message', { error: err.message });
    }
  }

  /**
   * Resolves a human-readable chat title from the message.
   * @param {import('gramjs/tl/custom/message').Message} message
   * @returns {Promise<string>}
   */
  async _resolveChatTitle(message) {
    try {
      const chat = await message.getChat();
      return chat?.title ?? chat?.username ?? `chat_${message.chatId}`;
    } catch {
      return `chat_${message.chatId ?? 'unknown'}`;
    }
  }

  // ─── Private: Catch-up ───────────────────────────────────────────────────────

  /**
   * Scans the last 20 messages of all whitelisted chats to pick up existing links.
   */
  async _catchUpHistory() {
    const allowedChats = config.telegram.allowedChats;
    if (allowedChats.length === 0) {
      log.info('No whitelisted chats configured; skipping history catch-up');
      return;
    }

    log.info(`Starting history catch-up for ${allowedChats.length} whitelisted chats…`);

    for (const chatId of allowedChats) {
      if (!this._isRunning) break;

      try {
        log.info(`Scanning history for chat: ${chatId}`);
        // Fetch the last 10 messages to catch up on missed deals
        const messages = await this._client.getMessages(chatId, {
          limit: 10,
        });

        if (!messages || messages.length === 0) continue;

        const now = Math.floor(Date.now() / 1000);
        const FIFTEEN_MINUTES = 15 * 60;

        for (const msg of messages) {
          const age = now - (msg.date || 0);

          if (age > FIFTEEN_MINUTES) {
            log.debug('Skipping historical message (too old)', {
              messageId: `${chatId}:${msg.id}`,
              ageMinutes: Math.floor(age / 60)
            });
            continue;
          }

          let hasUrl = false;
          if (msg.message && /https?:\/\//.test(msg.message)) hasUrl = true;
          if (msg.text && /https?:\/\//.test(msg.text)) hasUrl = true;
          if (msg.entities && msg.entities.some(e => e.className === 'MessageEntityTextUrl')) hasUrl = true;

          if (hasUrl) {
            await this._handleMessage(msg);
          }
        }

        // Small pause between chats
        await sleep(1000);
      } catch (err) {
        log.warn(`Could not catch up on history for chat ${chatId}`, {
          error: err.message,
        });
      }
    }

    log.info('History catch-up complete');
  }

  // ─── Private: Reconnection ───────────────────────────────────────────────────

  async _scheduleReconnect() {
    if (!this._isRunning) return;

    log.info(`Reconnecting in ${this._reconnectDelay / 1000}s…`);

    this._reconnectTimer = setTimeout(async () => {
      if (!this._isRunning) return;
      await this._connect();
    }, this._reconnectDelay);

    // Exponential backoff with cap
    this._reconnectDelay = Math.min(
      this._reconnectDelay * RECONNECT_BACKOFF_FACTOR,
      RECONNECT_MAX_DELAY_MS,
    );
  }

  // ─── Private: GramJS Logger Bridge ──────────────────────────────────────────

  _buildGramLogger() {
    // Bridge GramJS internal logs to our Winston logger
    class BridgeLogger extends GramLogger {
      log(level, message) {
        const mapped = { error: 'error', warn: 'warn', info: 'info', debug: 'debug' };
        log[mapped[level] ?? 'debug'](`[GramJS] ${message}`);
      }
    }
    return new BridgeLogger();
  }
}

// Export singleton
module.exports = new TelegramService();
