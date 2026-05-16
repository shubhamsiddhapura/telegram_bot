'use strict';

/**
 * controllers/webhookController.js
 *
 * POST /webhook/process
 *
 * Allows external systems (or testing) to manually push a message through
 * the full processing pipeline without going via Telegram.
 *
 * Body: { message: string, chatTitle?: string, chatId?: string }
 */

const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { HTTP_STATUS } = require('../constants');
const messageProcessor = require('../services/MessageProcessorService');
const logger = require('../utils/logger');

const log = logger.forModule('WebhookController');

// ─── Validators ──────────────────────────────────────────────────────────────

const processValidators = [
  body('message')
    .isString()
    .trim()
    .isLength({ min: 1, max: 4096 })
    .withMessage('message must be a non-empty string (max 4096 chars)'),
  body('chatTitle').optional().isString().trim(),
  body('chatId').optional().isString().trim(),
];

// ─── Handler ─────────────────────────────────────────────────────────────────

const processWebhook = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { message, chatTitle = 'webhook', chatId = 'webhook' } = req.body;
    const messageId = `webhook:${uuidv4()}`;

    log.info('Webhook message received', { messageId, chatTitle, preview: message.slice(0, 60) });

    // Fire-and-forget — respond immediately so the caller isn't blocked
    setImmediate(() => {
      messageProcessor
        .process({ messageId, text: message, chatTitle, chatId })
        .catch((err) => log.error('Webhook processing error', { error: err.message }));
    });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Message accepted for processing',
      messageId,
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = { processWebhook, processValidators };
