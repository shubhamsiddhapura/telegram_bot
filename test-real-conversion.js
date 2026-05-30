'use strict';

/**
 * test-real-conversion.js
 *
 * Lightweight integration test using real credentials to connect to Telegram,
 * send a test Amazon URL to the conversion bot, and print the response.
 */

// Load environment variables
require('./src/config/env');
const logger = require('./src/utils/logger');
const telegramService = require('./src/telegram/TelegramService');
const telegramBotConverter = require('./src/telegram/TelegramBotConverter');
const { sleep } = require('./src/utils/asyncWrapper');

const log = logger.forModule('RealConversionTest');

async function run() {
  log.info('Starting Real Conversion Integration Test...');
  log.info('Connecting to Telegram using configured session...');
  
  try {
    // Start Telegram service
    await telegramService.start();
    
    // Wait for connection to be ready
    let connected = false;
    for (let i = 0; i < 15; i++) {
      if (telegramService.isConnected) {
        connected = true;
        break;
      }
      log.info('...waiting for Telegram connection to establish');
      await sleep(1000);
    }
    
    if (!connected) {
      log.error('❌ Telegram client failed to connect within 15 seconds.');
      log.info('💡 Ensure you have updated the TELEGRAM_STRING_SESSION in your local .env file.');
      process.exit(1);
    }
    
    log.info('✅ Telegram connected successfully!');
    
    const testUrl = 'https://www.amazon.in/dp/B0CHX1W1XY';
    log.info(`Submitting test URL to converter bot: "${testUrl}"`);
    
    const result = await telegramBotConverter.convert(testUrl);
    
    log.info('=== [Real Bot Response] ===');
    console.log(result);
    log.info('===========================');
    log.info('✅ Integration test completed successfully!');
    
  } catch (err) {
    log.error('💥 Integration test failed', { error: err.message, stack: err.stack });
  } finally {
    log.info('Shutting down and disconnecting...');
    await telegramService.stop();
    process.exit(0);
  }
}

run();
