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
    this._latestQr = null;
    this._latestPairingCode = null;

    // Anti-Ban Logic State
    this._todayStartTime = null;
    this._lastResetDate = null;
    this._maxLongPauses = 12;
    this._breaks = [];
    this._lastPauseHour = null;

    this._pairingCodeRequested = false;
    this._enableAntiBan = config.nodeEnv === 'production'; // Only enable by default in production
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
      // ─── Hydrate Session from Env Var (Railway/Production) ────────────────
      const sessionData = process.env.WHATSAPP_SESSION_DATA;
      if (sessionData && !fs.existsSync(this._authFolder)) {
        log.info('📦 Found WHATSAPP_SESSION_DATA; hydrating session folder...');
        try {
          fs.mkdirSync(this._authFolder, { recursive: true });
          const decoded = JSON.parse(Buffer.from(sessionData, 'base64').toString('utf8'));
          for (const [filename, content] of Object.entries(decoded)) {
            fs.writeFileSync(path.join(this._authFolder, filename), content);
          }
          log.info('✅ Session folder hydrated successfully');
        } catch (err) {
          log.error('Failed to hydrate session from environment variable', { error: err.message });
        }
      }

      const { state, saveCreds } = await useMultiFileAuthState(this._authFolder);
      const { version } = await fetchLatestBaileysVersion();

      this._sock = makeWASocket({
        version,
        logger: baileyLogger,
        auth: state,
        printQRInTerminal: false, // We handle it manually
        getMessage: async () => ({ conversation: '' }), // Memory optimization
        syncFullHistory: false,
        generateHighQualityLinkPreview: true, // Enabled for better looking deals
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
          this._latestQr = qr;
          this._latestPairingCode = null;
        }

        if (qr && !config.whatsapp.phoneNumber) {
          log.info('📱 WhatsApp QR Code received. Please scan in Linked Devices:');
          qrcode.generate(qr, { small: true });
        } else if (qr && config.whatsapp.phoneNumber && !this._sock.authState.creds.registered && !this._pairingCodeRequested) {
          this._pairingCodeRequested = true;
          setTimeout(async () => {
            try {
              const code = await this._sock.requestPairingCode(config.whatsapp.phoneNumber.replace(/\D/g, ''));
              log.info(`🔑 WHATSAPP PAIRING CODE: ${code}`);
              log.info('Go to WhatsApp > Linked Devices > Link with Phone Number and enter this code.');
              this._latestPairingCode = code;
              this._latestQr = null;
            } catch (err) {
              log.error('Failed to get pairing code', { error: err.message });
              this._pairingCodeRequested = false; // Allow retry on failure
            }
          }, 5000);
        }

        if (connection === 'open') {
          log.info('✅ WhatsApp connected successfully!');
          this._isReady = true;
          this._isReconnecting = false;
          this._latestQr = null;
          this._latestPairingCode = null;
        }

        if (connection === 'close') {
          this._isReady = false;
          this._latestQr = null;
          this._latestPairingCode = null;
          const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          log.warn(`⚠️ WhatsApp connection closed`, { code: statusCode, reconnect: shouldReconnect });

          if (shouldReconnect) {
            this._isReconnecting = false;
            setTimeout(() => this.init(), 10000);
          } else {
            log.error('❌ Logged out. Automatically clearing wa-session folder...');
            try {
              if (fs.existsSync(this._authFolder)) {
                fs.rmSync(this._authFolder, { recursive: true, force: true });
                log.info('🗑️ wa-session folder cleared. Please restart the bot to generate a new code.');
              }
            } catch (err) {
              log.error('Failed to clear wa-session folder', { error: err.message });
            }
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
  async sendMessage({ text, imageBuffer, chatId, messageId, targetJid }) {
    const ctx = { messageId, chatId };

    // ─── Quiet Hours Check (12:00 AM to 9:00 AM IST) ─────────────────────
    if (this._isSleepTime()) {
      log.info('Skipping WhatsApp message dispatch — quiet hours (12:00 AM to 9:00 AM IST)', ctx);
      return { success: true, skipped: true };
    }

    if (!this._sock || !this._isReady) {
      log.warn('⏳ Waiting for WhatsApp connection to be ready...', ctx);
      // Wait up to 30s
      for (let i = 0; i < 30; i++) {
        if (this._sock && this._isReady) break;
        await sleep(1000);
      }
      if (!this._isReady) {
        log.error('❌ WhatsApp service not ready after 30s. Skipping message.', ctx);
        throw new Error('WhatsApp not ready');
      }
    }

    // ─── Pacing Logic (Simple Delay Only) ──────────────────────────────────
    
    // We keep a small 1-2 second delay to avoid looking like a bot to WhatsApp
    const delay = Math.floor(Math.random() * 1000) + 1000;
    log.debug(`⏳ Anti-ban delay: ${Math.floor(delay / 1000)}s`);
    await sleep(delay);

    // ─── Actual Send ───────────────────────────────────────────────────────
    try {
      const jid = targetJid || config.whatsapp.targetGroup;
      if (imageBuffer && imageBuffer.length > 0) {
        await this._sock.sendMessage(jid, {
          image: imageBuffer,
          caption: text || '',
          mimetype: 'image/jpeg',
        });
      } else {
        await this._sock.sendMessage(jid, { text: text || '' });
      }

      log.info('✅ WhatsApp message sent successfully', ctx);

      // Explicit GC hint to release image buffers from memory
      if (global.gc) global.gc();

      return { success: true };
    } catch (err) {
      log.error('WhatsApp send failed', { error: err.message, ...ctx });
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
      qr: this._latestQr,
      pairingCode: this._latestPairingCode,
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
    return current >= 0 && current < 540; // Quiet hours: 12:00 AM to 9:00 AM IST
  }

  _generateDailyBreaks() {
    this._breaks = [];
    const currentMin = this._getISTMinutes();

    const addBreaks = (count, start, end) => {
      for (let i = 0; i < count; i++) {
        const time = Math.floor(Math.random() * (end - start)) + start;
        // Mark as taken if it was scheduled for earlier today
        this._breaks.push({ time, taken: time < currentMin });
      }
    };
    addBreaks(2, 9 * 60, 14 * 60); // Reduced frequency
    addBreaks(2, 14 * 60, 20 * 60);
    addBreaks(1, 20 * 60, 23 * 60);
    this._breaks.sort((a, b) => a.time - b.time);
  }

  _resetDailyIfNeeded() {
    const now = new Date();
    const dateStr = now.toDateString();

    if (this._lastResetDate === dateStr) return;

    this._lastResetDate = dateStr;
    log.info('🔄 New day reset. Quiet hours disabled for testing.');

    // Set to 0 to disable quiet hours for now
    this._todayStartTime = 0;
    this._generateDailyBreaks();
  }

  _getSmartDelay() {
    const currentHour = new Date().getHours();
    // Reduced frequency and duration of pauses
    if (this._lastPauseHour !== currentHour && Math.random() < 0.2) {
      this._lastPauseHour = currentHour;
      return (1 + Math.random()) * 30 * 1000; // 30-60 second pause
    }
    return Math.floor(Math.random() * 1000) + 1000; // 1-2 second random delay
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
