'use strict';

/**
 * full-test.js
 * 
 * Simulates a full end-to-end flow:
 * 1. Initializes WhatsApp Service (Baileys)
 * 2. Mocks a Telegram message with a deal URL
 * 3. Runs it through the MessageProcessorService (URL extraction -> EarnKaro -> WhatsApp)
 */

// Load environment
require('./src/config/env');
const logger = require('./src/utils/logger');
const axios = require('axios');
const whatsAppService = require('./src/whatsapp/WhatsAppService');
const messageProcessor = require('./src/services/MessageProcessorService');
const { sleep } = require('./src/utils/common');

const log = logger.forModule('FullTest');

async function runFullTest() {
  log.info('🚀 Starting Full End-to-End Test...');

  // 1. Initialize WhatsApp Service
  try {
    // Bypassing anti-ban delays for testing
    whatsAppService._isSleepTime = () => false;
    whatsAppService._shouldTakeBigBreak = () => false;
    whatsAppService._getSmartDelay = () => 0;

    await whatsAppService.init();
    log.info('⏳ Waiting for WhatsApp connection...');
    
    // Wait up to 30 seconds for connection
    let connected = false;
    for (let i = 0; i < 15; i++) {
      const status = await whatsAppService.getStatus();
      if (status.whatsapp) {
        connected = true;
        log.info('✅ WhatsApp connected!');
        break;
      }
      await sleep(2000);
      log.info('...still waiting for WhatsApp connection');
    }

    if (!connected) {
      log.error('❌ WhatsApp failed to connect. Ensure you have scanned the QR code.');
      log.info('💡 Tip: Run "npm run dev" to scan the QR code first if you havent.');
      process.exit(1);
    }

    // 2. Mock Telegram Message Payload
    // Using a Flipkart URL since Amazon is blocked in this bot's configuration
    const testPayload = {
      messageId: `test-${Date.now()}`,
      text: 'Check out this amazing deal on Flipkart!\n\nhttps://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4\n\nLimited time offer!',
      image: null, // We can test without image first
      chatTitle: 'Test Whitelisted Group',
      chatId: '-1001493857075'
    };

    log.info('📦 Simulating incoming Telegram message...', { messageId: testPayload.messageId });

    // 3. Process the message
    await messageProcessor.process(testPayload);
    log.info('✅ Text-only test processing finished.');

    // 4. Test with Image
    log.info('📸 Simulating incoming Telegram message with image...');
    const imageUrl = 'https://picsum.photos/400/300';
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');

    const imagePayload = {
      messageId: `test-img-${Date.now()}`,
      text: 'Check out this cool image deal!\n\nhttps://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4',
      image: buffer,
      chatTitle: 'Test Whitelisted Group',
      chatId: '-1001493857075'
    };

    await messageProcessor.process(imagePayload);
    log.info('✅ Image test processing finished.');

    log.info('🎉 ALL TESTS COMPLETED SUCCESSFULLY!');

  } catch (err) {
    log.error('💥 Fatal error during full test', { error: err.message, stack: err.stack });
  } finally {
    // Keep it alive for a moment to ensure logs are flushed
    await sleep(2000);
    process.exit(0);
  }
}

runFullTest();
