'use strict';

/**
 * events/messageEventBus.js
 *
 * Wires the TelegramService event emitter to the MessageProcessorService.
 *
 * Design:
 *  - TelegramService emits EVENTS.TELEGRAM_MESSAGE when a new message arrives.
 *  - This bus subscribes, applies concurrency control (p-queue), and
 *    invokes the processor pipeline.
 *
 * Keeping this separate from both services preserves the SRP:
 *  - TelegramService only knows about Telegram.
 *  - MessageProcessorService only knows about the processing pipeline.
 *  - This bus knows about wiring.
 */

const { default: PQueue } = require('p-queue');
const config = require('../config/env');
const { EVENTS } = require('../constants');
const logger = require('../utils/logger');
const telegramService = require('../telegram/TelegramService');
const messageProcessor = require('../services/MessageProcessorService');

const log = logger.forModule('MessageEventBus');

// ─── Concurrency settings ─────────────────────────────────────────────────────

// Use concurrency 1 to ensure strict human-like pacing between messages.
const processingQueue = new PQueue({ concurrency: 1 });
const newPipelineQueue = new PQueue({ concurrency: 1 });

// ─── Wiring ───────────────────────────────────────────────────────────────────

const registerListeners = () => {
  telegramService.on(EVENTS.TELEGRAM_MESSAGE, async (payload) => {
    const { messageId, text, image, chatTitle, chatId } = payload;

    log.debug('Event received', { event: EVENTS.TELEGRAM_MESSAGE, messageId });

    // Enqueue processing — non-blocking for the Telegram event loop
    processingQueue
      .add(async () => {
        await messageProcessor.process({ messageId, text, image, chatTitle, chatId });
      })
      .catch((err) => {
        log.error('Unhandled error in processing queue', {
          messageId,
          error: err.message,
        });
      });
  });

  // ─── New parallel pipeline listener ─────────────────────────────────────────
  if (config.telegramConversion.botUsername) {
    const telegramBotMessageProcessor = require('../services/TelegramBotMessageProcessor');

    telegramService.on(EVENTS.TELEGRAM_MESSAGE_NEW_PIPELINE, async (payload) => {
      const { messageId, text, image, chatTitle, chatId } = payload;

      log.debug('New pipeline event received', { event: EVENTS.TELEGRAM_MESSAGE_NEW_PIPELINE, messageId });

      newPipelineQueue
        .add(async () => {
          await telegramBotMessageProcessor.process({ messageId, text, image, chatTitle, chatId });
        })
        .catch((err) => {
          log.error('Unhandled error in new pipeline queue', {
            messageId,
            error: err.message,
          });
        });
    });

    log.info('New pipeline message listeners registered');
  } else {
    log.info('New pipeline message listeners skipped: TELEGRAM_CONVERSION_BOT_USERNAME not set');
  }

  log.info('MessageEventBus listeners registered');
};

const getQueueStats = () => ({
  size: processingQueue.size,
  pending: processingQueue.pending,
  isPaused: processingQueue.isPaused,
  newPipeline: {
    size: newPipelineQueue.size,
    pending: newPipelineQueue.pending,
    isPaused: newPipelineQueue.isPaused,
  },
});

module.exports = { registerListeners, getQueueStats };
