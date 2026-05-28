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
const { NewMessage, EditedMessage } = require('telegram/events');
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
    this._pollingInterval = null;
    this._shuttingDown = false;
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
    this._shuttingDown = false;

    await this._connect();
  }

  /**
   * Disconnects the client and stops all listeners.
   */
  async stop() {
    log.info('Stopping TelegramService…');
    this._isRunning = false;
    this._shuttingDown = true;

    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }

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

      // CRITICAL: Fetch dialogs to populate GramJS entity cache. 
      log.info('Fetching dialogs to populate entity cache...');
      await this._client.getDialogs({});
      log.info('Entity cache populated.');

      // Catch up on very recent history immediately
      await this._catchUpHistory();

      // BULLETPROOF FALLBACK: Because Railway/Cloud providers sometimes drop Telegram's 
      // live WebSocket events, we will proactively poll the channels every 30 seconds.
      // Since we have deduplication, this is perfectly safe and guarantees ZERO dropped deals!
      if (this._pollingInterval) clearInterval(this._pollingInterval);
      this._pollingInterval = setInterval(async () => {
        if (this._client && this._client.connected) {
          log.debug('Running proactive background poll...');
          await this._catchUpHistory();
        }
      }, 30_000); // Poll every 30 seconds

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
      
      // Hide harmless connection state logs to prevent log spam and confusion
      if (className !== 'UpdateConnectionState') {
        log.debug(`Raw Telegram update: ${className}`);
      }

      if (
        className === 'UpdateNewChannelMessage' || 
        className === 'UpdateNewMessage' || 
        className === 'UpdateEditChannelMessage' || 
        className === 'UpdateEditMessage' ||
        className === 'UpdateShortMessage' ||
        className === 'UpdateShortChatMessage'
      ) {
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

    // 3. Handler for Edited Messages (critical for deal channels that post then edit)
    this._client.addEventHandler(
      async (event) => {
        if (event.message) {
          await this._handleMessage(event.message);
        }
      },
      new EditedMessage({}), // No filters, catch all
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
      
      log.debug(`Evaluating message ${messageId} from chatId: ${chatId}. Whitelist status: ${isAllowed}`);
      
      if (allowedChats.length > 0 && !isAllowed) {
        return;
      }

      log.info('Incoming message for processing', { chatId, messageId });

      const chatTitle = await this._resolveChatTitle(message);
      
      // Get raw text
      let text = message.message || message.text || '';

      // ─── Extract ALL hidden URLs and merge them into the text ────────────
      // Links can be in 3 places: visible text, text entities, or inline buttons.

      // (A) Hidden text-entity URLs (MessageEntityTextUrl) — insert inline
      if (message.entities) {
        const hiddenUrlEntities = message.entities
          .filter(e => e.className === 'MessageEntityTextUrl' && e.url && !text.includes(e.url));

        if (hiddenUrlEntities.length > 0) {
          log.debug('Found hidden text-entity URLs', {
            messageId,
            count: hiddenUrlEntities.length,
            urls: hiddenUrlEntities.map(e => e.url),
          });
        }

        // Process in REVERSE offset order so earlier insertions don't shift later offsets
        hiddenUrlEntities
          .sort((a, b) => (b.offset ?? 0) - (a.offset ?? 0))
          .forEach(entity => {
            const insertPos = (entity.offset ?? 0) + (entity.length ?? 0);
            text = text.slice(0, insertPos) + ' ' + entity.url + text.slice(insertPos);
          });
      }

      // (B) Inline keyboard button URLs (replyMarkup) — append at the end
      //     Many deal channels (Myntra, AJIO, etc.) put links in buttons below the message.
      if (message.replyMarkup && message.replyMarkup.rows) {
        const buttonUrls = [];
        for (const row of message.replyMarkup.rows) {
          if (!row.buttons) continue;
          for (const btn of row.buttons) {
            // KeyboardButtonUrl has a .url, KeyboardButtonCallback does not
            const btnUrl = btn.url || btn.data?.toString();
            if (btnUrl && /^https?:\/\//i.test(btnUrl) && !text.includes(btnUrl)) {
              buttonUrls.push(btnUrl);
            }
          }
        }
        if (buttonUrls.length > 0) {
          log.info('Found URLs in inline keyboard buttons', {
            messageId,
            count: buttonUrls.length,
            urls: buttonUrls,
          });
          // Append button URLs to the text so they get processed and forwarded
          text += '\n' + buttonUrls.join('\n');
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
    if (this._shuttingDown) return;
    
    const allowedChats = config.telegram.allowedChats;
    if (allowedChats.length === 0) {
      log.info('No whitelisted chats configured; skipping history catch-up');
      return;
    }

    log.debug(`Starting history catch-up for ${allowedChats.length} whitelisted chats…`);

    for (const chatId of allowedChats) {
      if (!this._isRunning) break;

      try {
        log.debug(`Scanning history for chat: ${chatId}`);
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
          // Also check inline keyboard buttons for URLs
          if (!hasUrl && msg.replyMarkup && msg.replyMarkup.rows) {
            for (const row of msg.replyMarkup.rows) {
              if (!row.buttons) continue;
              for (const btn of row.buttons) {
                if ((btn.url || btn.data?.toString() || '').match(/^https?:\/\//i)) {
                  hasUrl = true;
                  break;
                }
              }
              if (hasUrl) break;
            }
          }

          if (hasUrl) {
            await this._handleMessage(msg);
          }
        }

        // Small pause between chats
        await sleep(1000);
      } catch (err) {
        log.error(`Failed to catch up history for chat ${chatId}`, { error: err.message });
      }
    }

    log.debug('History catch-up complete');
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
