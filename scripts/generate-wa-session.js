'use strict';

const fs = require('fs');
const path = require('path');

/**
 * generate-wa-session.js
 * 
 * Reads the local 'wa-session' folder and converts it into a single 
 * Base64 string that can be used as an environment variable in production.
 */

const sessionDir = path.resolve(__dirname, '../wa-session');

if (!fs.existsSync(sessionDir)) {
  console.error('❌ Error: wa-session folder not found. Please link your WhatsApp locally first.');
  process.exit(1);
}

const credsFile = path.join(sessionDir, 'creds.json');

if (!fs.existsSync(credsFile)) {
  console.error('❌ Error: creds.json not found. Please link your WhatsApp locally first.');
  process.exit(1);
}

try {
  const sessionData = {
    'creds.json': fs.readFileSync(credsFile, 'utf8')
  };

  const base64Session = Buffer.from(JSON.stringify(sessionData)).toString('base64');
  
  console.log('\n============================================================');
  console.log('✅ WHATSAPP SESSION STRING GENERATED');
  console.log('============================================================\n');
  console.log('Copy the entire string below and add it to your Railway/Render');
  console.log('environment variables as: WHATSAPP_SESSION_DATA\n');
  console.log(base64Session);
  console.log('\n============================================================\n');

} catch (err) {
  console.error('❌ Failed to generate session string:', err.message);
  process.exit(1);
}
