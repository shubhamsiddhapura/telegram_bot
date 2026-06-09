'use strict';

/**
 * scripts/list-groups.js
 * 
 * Connects using the existing 'wa-session' and prints all WhatsApp groups
 * the logged-in account is currently in, along with their Group JIDs.
 */

const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');

async function listGroups() {
  const authFolder = path.resolve(process.cwd(), 'wa-session');
  if (!fs.existsSync(authFolder) || !fs.existsSync(path.join(authFolder, 'creds.json'))) {
    console.error('❌ Error: wa-session folder or creds.json not found. Please link your WhatsApp locally first using "npm run dev" or "npm run start".');
    process.exit(1);
  }

  console.log('Connecting to WhatsApp...');
  const { state } = await useMultiFileAuthState(authFolder);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
    logger: require('pino')({ level: 'silent' })
  });

  sock.ev.on('connection.update', async ({ connection }) => {
    if (connection === 'open') {
      console.log('✅ Connected successfully! Fetching groups...\n');
      try {
        const groups = await sock.groupFetchAllParticipating();
        console.log('============================================================');
        console.log('         PARTICIPATING WHATSAPP GROUPS & JIDs');
        console.log('============================================================');
        
        const groupList = Object.values(groups);
        if (groupList.length === 0) {
          console.log('No participating groups found.');
        } else {
          groupList.forEach((g) => {
            console.log(`Group Name: ${g.subject}`);
            console.log(`Group JID : ${g.id}`);
            console.log('-'.repeat(60));
          });
        }
      } catch (err) {
        console.error('❌ Failed to fetch groups:', err.message);
      }
      process.exit(0);
    }
    
    if (connection === 'close') {
      console.log('❌ Connection closed. Make sure you are authenticated locally.');
      process.exit(1);
    }
  });
}

listGroups().catch((err) => {
  console.error('Failed to run listGroups:', err.message);
  process.exit(1);
});
