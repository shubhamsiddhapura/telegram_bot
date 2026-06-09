'use strict';

/**
 * server.js
 *
 * Application entry point. Responsibilities:
 *  1. Validate environment
 *  2. Create Express app
 *  3. Start HTTP server
 *  4. Start Telegram client
 *  5. Wire event bus
 *  6. Handle graceful shutdown (SIGTERM, SIGINT, uncaughtException)
 */

// ── Environment must be loaded first ──────────────────────────────────────────
const config = require('./config/env');
const logger = require('./utils/logger');

const log = logger.forModule('Server');

// ── Application imports ───────────────────────────────────────────────────────
const createApp = require('./app');
const telegramService = require('./telegram/TelegramService');
const whatsAppService = require('./whatsapp/WhatsAppService');
const { registerListeners } = require('./events/messageEventBus');

// ── HTTP Server ───────────────────────────────────────────────────────────────

let httpServer = null;

const startHttpServer = () => {
  const app = createApp();
  httpServer = app.listen(config.port, () => {
    log.info(`HTTP server listening on port ${config.port}`, {
      env: config.nodeEnv,
      pid: process.pid,
    });
  });

  httpServer.on('error', (err) => {
    log.error('HTTP server error', { error: err.message });
    process.exit(1);
  });

  return httpServer;
};

const bootstrap = async () => {
  log.info('=== Telegram Affiliate Bot — Starting ===');

  // 1. Start Express HTTP server
  startHttpServer();

  // Check if we should start active forwarding services
  const startBot = process.env.START_BOT === 'true';

  if (startBot) {
    log.info('🤖 Booting with Telegram & WhatsApp forwarding active...');
    // 2. Register event bus listeners
    registerListeners();

    // 3. Start WhatsApp client (Native Baileys)
    await whatsAppService.init();

    // 4. Start Telegram client
    await telegramService.start();
  } else {
    log.info('🖥️ Booting in Admin API mode (forwarding inactive). Run "npm run message" to start forwarding.');
  }

  log.info('=== System fully operational ===');
};

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`Received ${signal} — initiating graceful shutdown`);

  // 1. Stop accepting new HTTP connections
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
    log.info('HTTP server closed');
  }

  // 2. Disconnect Telegram
  await telegramService.stop();


  log.info('Graceful shutdown complete');
  process.exit(0);
};

// ── Process Signal Handlers ───────────────────────────────────────────────────

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException').finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  // Do NOT exit — just log. Many libraries trigger harmless rejections.
});

// ── Start ─────────────────────────────────────────────────────────────────────

bootstrap().catch((err) => {
  log.error('Fatal: bootstrap failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
