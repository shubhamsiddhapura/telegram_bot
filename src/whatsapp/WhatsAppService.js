'use strict';

/**
 * src/whatsapp/WhatsAppService.js
 * 
 * NATIVE WhatsApp Integration (Baileys)
 * Includes Smart Delay, Quiet Hours, and Anti-Ban logic.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const config = require('../config/env');
const logger = require('../utils/logger');
const { sleep } = require('../utils/common');

const log = logger.forModule('WhatsAppService');
const baileyLogger = pino({ level: 'silent' });

class WhatsAppService {
  constructor() {
    this._sock = null;
    this._isReady = false;
    this._isReconnecting = false;
    this._authFolder = path.resolve(process.cwd(), 'wa-session');

    // Anti-Ban Logic State
    this._todayStartTime = null;
    this._lastResetDate = null;
    this._maxLongPauses = 12;
    this._breaks = [];
    this._lastPauseHour = null;

    this._generateDailyBreaks();
  }

  /**
   * Initializes the Baileys connection.
   */
  async init() {
    if (this._isReconnecting) return;
    this._isReconnecting = true;

    log.info('Initializing native WhatsApp connection (Baileys)...');

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this._authFolder);
      const { version } = await fetchLatestBaileysVersion();

      this._sock = makeWASocket({
        version,
        logger: baileyLogger,
        auth: state,
        printQRInTerminal: false, // We handle it manually
        getMessage: async () => ({ conversation: '' }), // Memory optimization
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 30_000,
      });

      // Handle Events
      this._sock.ev.on('creds.update', saveCreds);

      // Suppress 'Bad MAC' noise from other people's messages
      process.on('unhandledRejection', (err) => {
        if (err?.message?.includes('Bad MAC')) return;
        log.error('Unhandled Rejection', { error: err.message });
      });

      this._sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          log.info('📱 WhatsApp QR Code received. Please scan in Linked Devices:');
          qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
          log.info('✅ WhatsApp connected successfully!');
          this._isReady = true;
          this._isReconnecting = false;
        }

        if (connection === 'close') {
          this._isReady = false;
          const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          log.warn(`⚠️ WhatsApp connection closed`, { code: statusCode, reconnect: shouldReconnect });

          if (shouldReconnect) {
            this._isReconnecting = false;
            setTimeout(() => this.init(), 10000);
          } else {
            log.error('❌ Logged out. Delete wa-session folder and restart to re-scan QR.');
            this._isReconnecting = false;
          }
        }
      });

      // Handle incoming messages (webhook-like functionality)
      this._sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        // Logic for handling incoming WhatsApp messages can go here
        log.debug('Incoming WhatsApp message received');
      });

    } catch (err) {
      log.error('Failed to initialize Baileys', { error: err.message });
      this._isReconnecting = false;
    }
  }

  /**
   * Main method to send a message.
   * Now includes human-like pacing and quiet hours.
   */
  async sendMessage(text, imageBuffer = null, meta = {}) {
    if (!this._isReady) {
      throw new Error('WhatsApp service not ready. Please scan QR code.');
    }

    this._resetDailyIfNeeded();

    // 1. Quiet Hours Check
    while (this._isSleepTime()) {
      const cur = this._getISTMinutes();
      log.info(`🌙 Quiet hours in effect until ${Math.floor(this._todayStartTime / 60)}:${String(this._todayStartTime % 60).padStart(2, '0')} IST. Waiting...`);
      await sleep(60000);
      this._resetDailyIfNeeded();
    }

    // 2. Big Break Check
    if (this._shouldTakeBigBreak()) {
      const breakTime = (12 + Math.random() * 8) * 60 * 1000;
      log.info(`🧍 Taking a big break for ${(breakTime / 60000).toFixed(1)} minutes...`);
      await sleep(breakTime);
    }

    // 3. Smart Delay
    const delay = this._getSmartDelay();
    if (delay > 0) {
      log.debug(`⏳ Anti-ban delay: ${Math.floor(delay / 1000)}s`);
      await sleep(delay);
    }

    // 4. Actual Send
    try {
      const jid = config.whatsapp.targetGroup;
      if (imageBuffer && imageBuffer.length > 0) {
        await this._sock.sendMessage(jid, {
          image: imageBuffer,
          caption: text || '',
          mimetype: 'image/jpeg',
        });
      } else {
        await this._sock.sendMessage(jid, { text: text || '' });
      }

      log.info('✅ WhatsApp message sent successfully', { ...meta });

      // Explicit GC hint to release image buffers from memory
      if (global.gc) global.gc();

      return { success: true };
    } catch (err) {
      log.error('WhatsApp send failed', { error: err.message, ...meta });
      return { success: false, error: err.message };
    }
  }

  /**
   * Returns current service status.
   */
  async getStatus() {
    return {
      whatsapp: this._isReady,
      isSleepTime: this._isSleepTime(),
      sessionExists: fs.existsSync(this._authFolder),
    };
  }

  // ─── Private: Anti-Ban Helpers ───────────────────────────────────────────────

  _getISTMinutes() {
    const istOffset = 5.5 * 60 * 60 * 1000;
    const ist = new Date(Date.now() + istOffset);
    return ist.getUTCHours() * 60 + ist.getUTCMinutes();
  }

  _getISTDateString() {
    const istOffset = 5.5 * 60 * 60 * 1000;
    const ist = new Date(Date.now() + istOffset);
    return `${ist.getUTCFullYear()}-${ist.getUTCMonth() + 1}-${ist.getUTCDate()}`;
  }

  _isSleepTime() {
    const current = this._getISTMinutes();
    if (!this._todayStartTime) {
      this._todayStartTime = 480 + Math.floor(Math.random() * 60); // Random start between 8:00 AM and 9:00 AM
    }
    return current < this._todayStartTime;
  }

  _generateDailyBreaks() {
    this._breaks = [];
    const addBreaks = (count, start, end) => {
      for (let i = 0; i < count; i++) {
        this._breaks.push({ time: Math.floor(Math.random() * (end - start)) + start, taken: false });
      }
    };
    addBreaks(3, 8 * 60, 14 * 60);
    addBreaks(2, 14 * 60, 20 * 60);
    addBreaks(1, 20 * 60, 24 * 60);
    this._breaks.sort((a, b) => a.time - b.time);
  }

  _resetDailyIfNeeded() {
    const today = this._getISTDateString();
    if (this._lastResetDate !== today) {
      this._lastResetDate = today;
      this._todayStartTime = 480 + Math.floor(Math.random() * 60);
      this._generateDailyBreaks();
      log.info(`🔄 New day reset. Bot will start at ${Math.floor(this._todayStartTime / 60)}:${String(this._todayStartTime % 60).padStart(2, '0')} IST.`);
    }
  }

  _getSmartDelay() {
    const currentHour = new Date().getHours();
    if (this._lastPauseHour !== currentHour && Math.random() < 0.4) {
      this._lastPauseHour = currentHour;
      return (2 + Math.random()) * 60 * 1000; // 2-3 minute pause once an hour
    }
    return Math.floor(Math.random() * 3000) + 3000; // 3-6 second random delay
  }

  _shouldTakeBigBreak() {
    const current = this._getISTMinutes();
    for (let b of this._breaks) {
      if (!b.taken && current >= b.time) {
        b.taken = true;
        return true;
      }
    }
    return false;
  }
}

module.exports = new WhatsAppService();
