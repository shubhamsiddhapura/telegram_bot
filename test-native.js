'use strict';

/**
 * test-native.js
 * 
 * Tests the integrated native WhatsApp service.
 */

// Load environment
require('./src/config/env');

const axios = require('axios');
const whatsAppService = require('./src/whatsapp/WhatsAppService');
const { sleep } = require('./src/utils/common');

async function testNative() {
  console.log('🧪 Starting native WhatsApp integration test...');
  
  // 1. Initialize the service
  await whatsAppService.init();
  
  console.log('⏳ Waiting for connection (check terminal for QR if needed)...');
  
  // Wait up to 60 seconds for connection
  for (let i = 0; i < 60; i++) {
    const status = await whatsAppService.getStatus();
    if (status.whatsapp) {
      console.log('✅ WhatsApp connected!');
      break;
    }
    await sleep(2000);
    if (i % 5 === 0) console.log(`...waiting (${i*2}s)`);
  }

  const finalStatus = await whatsAppService.getStatus();
  if (!finalStatus.whatsapp) {
    console.error('❌ Failed to connect in time. Make sure you scanned the QR.');
    process.exit(1);
  }

  // 2. Send a test text message
  console.log('📤 Sending test text message...');
  await whatsAppService.sendMessage('🤖 *Native Integration Test*\n\nThis message was sent directly from the bot codebase (no external sender)!');

  // 3. Send a test image message
  console.log('📸 Sending test image message...');
  try {
    const imageUrl = 'https://picsum.photos/400/300';
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    await whatsAppService.sendMessage('📸 *Native Image Test*\n\nImage sent directly from the bot!', buffer);
    console.log('🎉 All tests passed!');
  } catch (err) {
    console.error('❌ Image test failed:', err.message);
  }

  console.log('Done.');
  process.exit(0);
}

testNative();
