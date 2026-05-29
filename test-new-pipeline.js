'use strict';

/**
 * test-new-pipeline.js
 *
 * Runs a complete simulation of the parallel Telegram bot conversion pipeline.
 * Mocks:
 *  - GramJS TelegramClient message sending and event loop for bot ID 2015117555
 *  - WhatsAppService sending logic
 *
 * Validates:
 *  - Non-Amazon links (Flipkart) are correctly skipped.
 *  - Amazon links are correctly extracted and converted.
 *  - Dealspouch redirect links (e.g. amaz.dealspouch.com) are correctly extracted and converted.
 */

require('./src/config/env');
const logger = require('./src/utils/logger');
const telegramService = require('./src/telegram/TelegramService');
const whatsAppService = require('./src/whatsapp/WhatsAppService');
const { registerListeners } = require('./src/events/messageEventBus');
const { sleep } = require('./src/utils/asyncWrapper');

const log = logger.forModule('NewPipelineTest');

const eventHandlers = [];
const BOT_ID = 2015117555;

// 1. Mock GramJS TelegramClient
const mockClient = {
  connected: true,
  getEntity: async (username) => {
    log.info(`[Mock Client] Resolving entity for ${username}`);
    return { id: BOT_ID, username: String(BOT_ID) };
  },
  sendMessage: async (entity, { message }) => {
    log.info(`[Mock Client] Sent message to bot: "${message}"`);
    
    // Simulate the bot replying back with a converted link after a short delay
    setTimeout(() => {
      if (eventHandlers.length > 0) {
        log.info(`[Mock Bot] Replying with converted affiliate link...`);
        
        // Retrieve the registered handler
        const handler = eventHandlers[eventHandlers.length - 1];
        handler({
          message: {
            chatId: BOT_ID,
            peerId: { userId: BOT_ID },
            message: `Here is your converted link:\nhttps://amzn.to/converted-amazon-link-123`,
            text: `Here is your converted link:\nhttps://amzn.to/converted-amazon-link-123`,
          }
        });
      } else {
        log.warn('[Mock Bot] No event handler registered by the converter!');
      }
    }, 1000);
  },
  addEventHandler: (handler, filter) => {
    log.info('[Mock Client] Temporary event handler registered');
    eventHandlers.push(handler);
  },
  removeEventHandler: (handler) => {
    log.info('[Mock Client] Temporary event handler removed');
    const idx = eventHandlers.indexOf(handler);
    if (idx !== -1) {
      eventHandlers.splice(idx, 1);
    }
  }
};

// Inject mock client into TelegramService
telegramService._client = mockClient;
Object.defineProperty(telegramService, 'isConnected', {
  get: () => true
});

// 2. Mock WhatsAppService
whatsAppService._sock = {};
whatsAppService._isReady = true;
whatsAppService.sendMessage = async ({ text, imageBuffer, chatId, messageId, targetJid }) => {
  log.info('=== [Mock WhatsApp] Message Received at Destination JID! ===');
  console.log(`Target Group JID : ${targetJid}`);
  console.log(`Message MessageID: ${messageId}`);
  console.log(`Original ChatID  : ${chatId}`);
  console.log(`Message Content  :\n${text}`);
  console.log(`Has Image Buffer : ${!!imageBuffer}`);
  console.log('============================================================');
  return { success: true };
};

// Override sleep time to allow testing during simulation
whatsAppService._isSleepTime = () => false;

async function runSimulation() {
  log.info('Starting Telegram Bot Conversion Parallel Pipeline Simulation...');

  // Register event bus listeners
  registerListeners();

  // Test Case 1: Non-Amazon link (should be skipped by the new pipeline)
  const nonAmazonPayload = {
    messageId: `test-live-non-amazon-${Date.now()}`,
    text: 'Check out this awesome deal on Flipkart!\n👉 https://www.flipkart.com/some-amazing-product-xyz\nGrab it now!',
    image: null,
    chatTitle: 'My Live Deals Channel',
    chatId: '1412868909'
  };

  log.info('Simulating incoming live Telegram message with non-Amazon link...', { messageId: nonAmazonPayload.messageId });
  telegramService.emit('telegram:message:new_pipeline', nonAmazonPayload);

  // Wait briefly for log output
  await sleep(2000);

  // Test Case 2: Amazon link (should be processed, converted, and sent to WhatsApp)
  const amazonPayload = {
    messageId: `test-live-amazon-${Date.now()}`,
    text: 'Check out this awesome deal on Amazon!\n👉 https://www.amazon.in/dp/B0CHX1W1XY\nGrab it now!',
    image: null,
    chatTitle: 'My Live Deals Channel',
    chatId: '1412868909'
  };

  log.info('Simulating incoming live Telegram message with Amazon link...', { messageId: amazonPayload.messageId });
  telegramService.emit('telegram:message:new_pipeline', amazonPayload);

  // Wait briefly for log output
  await sleep(4000);

  // Test Case 3: Dealspouch link (should also be processed, converted, and sent to WhatsApp)
  const dealspouchPayload = {
    messageId: `test-live-dealspouch-${Date.now()}`,
    text: 'Check out this awesome deal on Dealspouch!\n👉 https://amaz.dealspouch.com/r/hea6\nGrab it now!',
    image: null,
    chatTitle: 'My Live Deals Channel',
    chatId: '1412868909'
  };

  log.info('Simulating incoming live Telegram message with Dealspouch link...', { messageId: dealspouchPayload.messageId });
  telegramService.emit('telegram:message:new_pipeline', dealspouchPayload);

  // Wait for async processing to finish
  await sleep(4000);

  log.info('Simulation complete. Check logs to verify correct execution!');
  process.exit(0);
}

runSimulation().catch(err => {
  log.error('Simulation crashed', { error: err.message, stack: err.stack });
  process.exit(1);
});
