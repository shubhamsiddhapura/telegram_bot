'use strict';

/**
 * routes/index.js
 *
 * Aggregates and mounts all application routes.
 */

const { Router } = require('express');
const healthController = require('../controllers/healthController');
const { processWebhook, processValidators } = require('../controllers/webhookController');
const { asyncHandler } = require('../utils/asyncWrapper');
const { webhookLimiter } = require('../middlewares/rateLimiter');

const router = Router();
const adminRouter = require('./admin');

// ── Health ──────────────────────────────────────────────────────────────────
router.get('/health', healthController.health);
router.get('/status', healthController.status);

// ── Webhook ─────────────────────────────────────────────────────────────────
router.post(
  '/webhook/process',
  webhookLimiter,
  processValidators,
  asyncHandler(processWebhook),
);

// ── Admin ───────────────────────────────────────────────────────────────────
router.use('/admin', adminRouter);

module.exports = router;
