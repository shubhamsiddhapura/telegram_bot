'use strict';

/**
 * gen-telegram-session.js
 * 
 * Interactive script to generate a Telegram StringSession.
 * You will need:
 *  1. TELEGRAM_API_ID
 *  2. TELEGRAM_API_HASH
 * 
 * Run: node gen-telegram-session.js
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');
const dotenv = require('dotenv');

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
  console.error('❌ Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env file.');
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const stringSession = new StringSession(""); // Start with empty session

(async () => {
  console.log('--- Telegram Session Generator ---');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await question('Please enter your phone number (with country code): '),
    password: async () => await question('Please enter your 2FA password (if any): '),
    phoneCode: async () => await question('Please enter the code you received: '),
    onError: (err) => console.error('Error:', err.message),
  });

  console.log('✅ Successfully logged in!');
  const newSession = client.session.save();
  console.log('\n--- YOUR NEW STRING SESSION ---');
  console.log(newSession);
  console.log('-------------------------------\n');
  console.log('💡 COPY the string above and update your .env file:');
  console.log('TELEGRAM_STRING_SESSION=' + newSession);
  
  rl.close();
  await client.disconnect();
  process.exit(0);
})();
