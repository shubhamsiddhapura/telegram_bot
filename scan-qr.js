'use strict';

/**
 * scan-qr.js
 * 
 * Standalone script to initialize the WhatsApp session and scan the QR code.
 * Use this if you want to link your account without running the full bot.
 */

require('./src/config/env');
const whatsAppService = require('./src/whatsapp/WhatsAppService');

async function run() {
  console.log('🚀 Initializing WhatsApp Session...');
  console.log('⚠️ If a QR code appears, scan it with your WhatsApp -> Linked Devices.');
  
  await whatsAppService.init();

  // Keep process alive
  setInterval(() => {
    whatsAppService.getStatus().then(status => {
      if (status.whatsapp) {
        console.log('✅ WhatsApp is CONNECTED and READY!');
        console.log('You can now stop this script and start the bot with: npm run dev');
        process.exit(0);
      }
    });
  }, 5000);
}

run().catch(err => {
  console.error('💥 Error:', err.message);
  process.exit(1);
});
