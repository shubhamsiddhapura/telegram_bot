'use strict';

/**
 * controllers/healthController.js
 *
 * Health check and system status endpoints.
 *
 * GET /health         — lightweight liveness probe
 * GET /status         — detailed system status (Telegram, queues, memory)
 */

const { HTTP_STATUS } = require('../constants');
const telegramService = require('../telegram/TelegramService');
const { getQueueStats } = require('../events/messageEventBus');
const whatsAppService = require('../whatsapp/WhatsAppService');

/**
 * GET /health
 * Lightweight liveness probe used by load balancers / uptime monitors.
 */
const health = async (_req, res) => {
  const senderStatus = await whatsAppService.getStatus();
  const telegramStatus = telegramService.isConnected;

  // We use a specific keyword "OK_CONNECTED" so HetrixTools can alert
  // if either the server is down OR if the bot is disconnected.
  const isHealthy = telegramStatus && senderStatus.whatsapp;

  res.status(HTTP_STATUS.OK).json({
    status: isHealthy ? 'OK_CONNECTED' : 'DEGRADED',
    telegram: telegramStatus ? 'connected' : 'disconnected',
    whatsapp: senderStatus.whatsapp ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
};

/**
 * GET /status
 * Detailed operational status — protected or internal use only.
 */
const status = async (_req, res) => {
  const mem = process.memoryUsage();

  // Fetch remote sender status
  const senderStatus = await whatsAppService.getStatus();

  const payload = {
    success: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    telegram: {
      connected: telegramService.isConnected,
    },
    whatsappSender: {
      connected: senderStatus.whatsapp,
      queue: senderStatus.queue,
      sleeping: senderStatus.sleeping,
    },
    queues: {
      processing: getQueueStats(),
    },
    memory: {
      heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMb: (mem.heapTotal / 1024 / 1024).toFixed(2),
      rssMb: (mem.rss / 1024 / 1024).toFixed(2),
    },
    node: {
      version: process.version,
      env: process.env.NODE_ENV,
    },
  };

  res.status(HTTP_STATUS.OK).json(payload);
};

module.exports = { health, status };
