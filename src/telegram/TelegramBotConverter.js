'use strict';

/**
 * telegram/TelegramBotConverter.js
 *
 * Interacts with a Telegram conversion bot via GramJS:
 *  - Sends the link to the bot
 *  - Awaits the reply from the bot in the same chat
 *  - Uses a single-concurrency queue to avoid interleaving messages and preserve correlation
 *  - Uses exponential retries on transient errors/timeouts
 */

const { default: PQueue } = require('p-queue');
const { NewMessage } = require('telegram/events');
const config = require('../config/env');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/asyncWrapper');

const log = logger.forModule('TelegramBotConverter');

class TelegramBotConverter {
  constructor() {
    this._queue = new PQueue({ concurrency: 1 });
    this._botEntity = null;
  }

  /**
   * Public interface to convert a single link.
   *
   * @param {string} link — The original URL to convert.
   * @returns {Promise<string>} — The bot's reply text.
   */
  async convert(link) {
    if (!link || typeof link !== 'string') {
      throw new TypeError('[TelegramBotConverter] link must be a non-empty string');
    }

    const maxRetries = config.telegramConversion.maxRetries;

    // Retry inside the queue to prevent interleaving of requests
    return this._queue.add(() =>
      withRetry(
        () => this._convertSingle(link),
        {
          maxRetries,
          label: `TelegramBotConverter.convertSingle(${link})`,
          shouldRetry: () => true, // Retry on any timeout or transient network error
        }
      )
    );
  }

  /**
   * Performs a single conversion cycle.
   *
   * @param {string} link
   * @returns {Promise<string>}
   */
  async _convertSingle(link) {
    const telegramService = require('./TelegramService');
    const client = telegramService.client;

    if (!client || !client.connected) {
      throw new Error('Telegram client is not connected');
    }

    const botUsername = config.telegramConversion.botUsername;
    if (!botUsername) {
      throw new Error('TELEGRAM_CONVERSION_BOT_USERNAME is not configured');
    }

    log.info('Submitting link to Telegram bot for conversion', { botUsername, link });

    // 1. Resolve and cache the bot entity if not done already
    if (!this._botEntity) {
      const entityKey = /^[+-]?\d+$/.test(botUsername) ? parseInt(botUsername, 10) : botUsername;
      try {
        log.debug('Resolving bot entity', { entityKey });
        this._botEntity = await client.getEntity(entityKey);
      } catch (err) {
        if (typeof entityKey === 'number') {
          try {
            log.debug('Resolving bot entity via input PeerUser', { userId: entityKey });
            const { Api } = require('telegram');
            this._botEntity = await client.getEntity(new Api.PeerUser({ userId: entityKey }));
          } catch (peerErr) {
            log.error('Failed to resolve conversion bot entity via input PeerUser', { botUsername, error: peerErr.message });
            throw err;
          }
        } else {
          log.error('Failed to resolve conversion bot entity', { botUsername, error: err.message });
          throw err;
        }
      }
    }

    const botChatId = this._botEntity.id.toString();
    const timeoutMs = config.telegramConversion.timeoutMs;
    let handler;

    // 2. Set up event listener for the bot's response
    const replyPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (handler) {
          client.removeEventHandler(handler);
        }
        reject(new Error(`Timeout waiting for reply from bot ${botUsername} after ${timeoutMs}ms`));
      }, timeoutMs);

      handler = async (event) => {
        try {
          const message = event.message;
          if (!message) return;

          // Resolve message chat/sender ID
          let messageChatId = message.chatId?.toString();
          if (!messageChatId && message.peerId) {
            if (message.peerId.userId) messageChatId = message.peerId.userId.toString();
            else if (message.peerId.chatId) messageChatId = message.peerId.chatId.toString();
            else if (message.peerId.channelId) messageChatId = message.peerId.channelId.toString();
          }

          // Check if message is from the conversion bot
          if (messageChatId === botChatId) {
            clearTimeout(timeoutId);
            client.removeEventHandler(handler);

            const replyText = message.message || message.text || '';
            resolve(replyText);
          }
        } catch (err) {
          log.error('Error in bot response handler', { error: err.message });
        }
      };

      // Register temporary handler
      client.addEventHandler(handler, new NewMessage({}));
    });

    // 3. Send link to the bot
    await client.sendMessage(this._botEntity, { message: link });

    // 4. Wait for the response
    return await replyPromise;
  }
}

module.exports = new TelegramBotConverter();
