'use strict';

/**
 * test-both-pipelines.js
 *
 * Runs a real end-to-end integration test of BOTH pipelines:
 *  1. EarnKaro Pipeline (Normal Flow) -> Processes Flipkart URLs -> Sends to WhatsApp
 *  2. ExtraPe Bot Pipeline (Amazon Flow) -> Processes raw Amazon URLs -> Converts via Bot -> Sends to WhatsApp
 *  3. ExtraPe Bot Pipeline (Bypass Flow) -> Processes already-converted amzn-to.co URLs -> Bypasses Bot -> Sends to WhatsApp
 *
 * Run: node test-both-pipelines.js
 */

require('./src/config/env');
const logger = require('./src/utils/logger');
const telegramService = require('./src/telegram/TelegramService');
const whatsAppService = require('./src/whatsapp/WhatsAppService');
const messageProcessor = require('./src/services/MessageProcessorService');
const telegramBotMessageProcessor = require('./src/services/TelegramBotMessageProcessor');
const { sleep } = require('./src/utils/common');

const log = logger.forModule('TestBothPipelines');

async function run() {
  log.info('🚀 Starting Joint End-to-End Test for Normal and ExtraPe pipelines...');

  // Disable sleep time constraints for this test
  whatsAppService._isSleepTime = () => false;
  whatsAppService._shouldTakeBigBreak = () => false;

  // 1. Start WhatsApp Client
  try {
    log.info('Initializing WhatsApp client...');
    await whatsAppService.init();

    log.info('Waiting for WhatsApp connection...');
    let waConnected = false;
    for (let i = 0; i < 30; i++) {
      const status = await whatsAppService.getStatus();
      if (status.whatsapp) {
        waConnected = true;
        log.info('✅ WhatsApp client connected successfully!');
        break;
      }
      await sleep(1000);
    }

    if (!waConnected) {
      log.error('❌ WhatsApp failed to connect. Make sure WhatsApp is authenticated/active.');
      process.exit(1);
    }
  } catch (err) {
    log.error('Failed to init WhatsApp', { error: err.message });
    process.exit(1);
  }

  // 2. Start Telegram Client
  try {
    log.info('Initializing Telegram client...');
    await telegramService.start();

    log.info('Waiting for Telegram connection...');
    let tgConnected = false;
    for (let i = 0; i < 20; i++) {
      if (telegramService.isConnected) {
        tgConnected = true;
        log.info('✅ Telegram client connected successfully!');
        break;
      }
      await sleep(1000);
    }

    if (!tgConnected) {
      log.error('❌ Telegram failed to connect.');
      process.exit(1);
    }
  } catch (err) {
    log.error('Failed to init Telegram', { error: err.message });
    process.exit(1);
  }

  // Allow catch-up history to run/finish so it does not conflict
  log.info('Waiting 3 seconds for initial setup / catch-up messages to complete...');
  await sleep(3000);

  // 3. Prepare Payloads
  const normalPayload = {
    messageId: `test-normal-fk-${Date.now()}`,
    text: '🔥 *Flipkart Deal (Normal Flow)* 🔥\n\nCheckout this amazing item on Flipkart!\n👉 https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4\n\nBuy it now!',
    image: null,
    chatTitle: 'Test Whitelisted Channel',
    chatId: '-1001493857075'
  };

  const extrapePayload = {
    messageId: `test-bot-amazon-${Date.now()}`,
    text: '🔥 *Amazon Deal (ExtraPe Bot Flow)* 🔥\n\nCheckout this amazing item on Amazon!\n👉 https://www.amazon.in/dp/B0CHX1W1XY\n\nGrab it now!',
    image: null,
    chatTitle: 'Test Whitelisted Channel',
    chatId: '-1001493857075'
  };

  const bypassPayload = {
    messageId: `test-bot-bypass-${Date.now()}`,
    text: '🔥 *Already-Converted Link (Bypass Flow)* 🔥\n\nHere is a converted deal link!\n👉 https://amzn-to.co/dLFfn4\n\nOrder today!',
    image: null,
    chatTitle: 'Test Whitelisted Channel',
    chatId: '-1001493857075'
  };

  // 4. Run Joint Test Cases
  log.info('--- RUNNING TEST CASES ---');

  // Test Case 1: EarnKaro Normal Pipeline (Flipkart URL)
  log.info('Starting Test Case 1: Normal EarnKaro Pipeline...');
  try {
    await messageProcessor.process(normalPayload);
    log.info('✅ Test Case 1 completed processing');
  } catch (err) {
    log.error('❌ Test Case 1 failed', { error: err.message });
  }

  await sleep(3000); // Wait between message dispatches to keep order and pacing

  // Test Case 2: ExtraPe Bot Pipeline (Raw Amazon URL)
  log.info('Starting Test Case 2: ExtraPe Bot Pipeline (Raw Amazon URL)...');
  try {
    await telegramBotMessageProcessor.process(extrapePayload);
    log.info('✅ Test Case 2 completed processing');
  } catch (err) {
    log.error('❌ Test Case 2 failed', { error: err.message });
  }

  await sleep(3000);

  // Test Case 3: ExtraPe Bot Pipeline (Already-Converted URL Bypass)
  log.info('Starting Test Case 3: ExtraPe Bot Pipeline (Bypassing already-converted link)...');
  try {
    await telegramBotMessageProcessor.process(bypassPayload);
    log.info('✅ Test Case 3 completed processing');
  } catch (err) {
    log.error('❌ Test Case 3 failed', { error: err.message });
  }

  log.info('--- ALL Joint Tests Triggered ---');
  log.info('Waiting 5 seconds before clean-up...');
  await sleep(5000);

  log.info('Disconnecting services...');
  await telegramService.stop();
  process.exit(0);
}

run().catch((err) => {
  log.error('FATAL Joint Test failure', { error: err.message, stack: err.stack });
  process.exit(1);
});
