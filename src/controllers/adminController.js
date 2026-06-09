'use strict';

/**
 * controllers/adminController.js
 * 
 * Administration controllers for the Next.js dashboard API.
 * Includes auth sessions, status, logs, .env config management,
 * and GramJS interactive logins.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');
const logger = require('../utils/logger');
const telegramService = require('../telegram/TelegramService');
const whatsAppService = require('../whatsapp/WhatsAppService');
const { getQueueStats } = require('../events/messageEventBus');
const telegramLoginHelper = require('../helpers/telegramLoginHelper');

const log = logger.forModule('AdminController');

// In-memory sessions store
const activeSessions = new Set();

/**
 * Middleware to protect admin routes
 */
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  if (!activeSessions.has(token)) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid token' });
  }

  next();
};

/**
 * POST /api/admin/login
 * Validates the admin password and generates a session token
 */
const login = async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required' });
  }

  if (password !== config.adminPassword) {
    log.warn('Failed admin login attempt');
    return res.status(401).json({ success: false, message: 'Invalid admin password' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.add(token);

  log.info('Successful admin login. Session token issued.');
  return res.status(200).json({ success: true, token });
};

/**
 * POST /api/admin/logout
 * Destroys the admin session token
 */
const logout = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    activeSessions.delete(token);
  }
  return res.status(200).json({ success: true, message: 'Logged out successfully' });
};

/**
 * GET /api/admin/status
 * Exposes system stats, connection info, queues, and active channels
 */
const getStatus = async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const waStatus = await whatsAppService.getStatus();

    // Fetch Telegram user info if connected
    let tgUser = null;
    if (telegramService.isConnected && telegramService.client) {
      try {
        const me = await telegramService.client.getMe();
        tgUser = {
          username: me.username || 'unknown',
          id: me.id?.toString() || 'unknown',
          firstName: me.firstName || '',
          lastName: me.lastName || '',
        };
      } catch (err) {
        log.warn('Failed to fetch Telegram client details', { error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      process: {
        uptime: process.uptime(),
        memory: {
          heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(2),
          heapTotalMb: (mem.heapTotal / 1024 / 1024).toFixed(2),
          rssMb: (mem.rss / 1024 / 1024).toFixed(2),
        },
        nodeVersion: process.version,
        env: config.nodeEnv,
      },
      telegram: {
        connected: telegramService.isConnected,
        user: tgUser,
        allowedChats: config.telegram.allowedChats,
      },
      whatsapp: {
        connected: waStatus.whatsapp,
        isSleepTime: waStatus.isSleepTime,
        sessionExists: waStatus.sessionExists,
        qr: waStatus.qr,
        pairingCode: waStatus.pairingCode,
        targetGroup: config.whatsapp.targetGroup,
      },
      queues: getQueueStats(),
    });
  } catch (err) {
    log.error('Failed to compile admin status', { error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/admin/config
 * Retrieves existing config with sensitive tokens masked
 */
const getConfig = async (req, res) => {
  const mask = (str) => {
    if (!str) return '';
    if (str.length <= 8) return '********';
    return str.slice(0, 4) + '...' + str.slice(-4);
  };

  return res.status(200).json({
    success: true,
    config: {
      PORT: config.port,
      NODE_ENV: config.nodeEnv,
      TELEGRAM_API_ID: config.telegram.apiId,
      TELEGRAM_API_HASH: mask(config.telegram.apiHash),
      TELEGRAM_STRING_SESSION: mask(config.telegram.stringSession),
      TELEGRAM_ALLOWED_CHATS: config.telegram.allowedChats.join(', '),
      TELEGRAM_CONVERSION_BOT_USERNAME: config.telegramConversion.botUsername || '',
      EARNKARO_API_TOKEN: mask(config.earnkaro.apiToken),
      EARNKARO_API_URL: config.earnkaro.apiUrl,
      WHATSAPP_TARGET_GROUP: config.whatsapp.targetGroup,
      WHATSAPP_PHONE_NUMBER: config.whatsapp.phoneNumber || '',
      ADMIN_PASSWORD: mask(config.adminPassword),
      LOG_LEVEL: config.logging.level,
    },
  });
};

/**
 * POST /api/admin/config/update
 * Updates the local .env file with new config key-values
 */
const updateConfig = async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No updates provided' });
    }

    const envPath = path.resolve(process.cwd(), '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8');
    }

    let lines = content.split(/\r?\n/);
    const newKeys = { ...updates };

    // Format new values cleanly (trim them, remove quotes, etc.)
    for (const key of Object.keys(newKeys)) {
      if (typeof newKeys[key] === 'string') {
        newKeys[key] = newKeys[key].trim();
      }
    }

    // Replace existing values, leaving other comments and keys unchanged
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#') || !line.includes('=')) continue;
      
      const eqIndex = line.indexOf('=');
      const key = line.slice(0, eqIndex).trim();

      if (newKeys[key] !== undefined) {
        // If it was masked and not changed in UI, do not overwrite it with masks
        if (typeof newKeys[key] === 'string' && newKeys[key].includes('...')) {
          delete newKeys[key];
          continue;
        }
        lines[i] = `${key}=${newKeys[key]}`;
        delete newKeys[key];
      }
    }

    // Append any new keys
    for (const [key, val] of Object.entries(newKeys)) {
      lines.push(`${key}=${val}`);
    }

    fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
    log.info('Environment configuration .env updated successfully');

    return res.status(200).json({
      success: true,
      message: 'Configuration saved. Restart the bot to apply settings.',
    });
  } catch (err) {
    log.error('Failed to update config', { error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/bot/restart
 * Restarts the bot by exiting the process (relies on nodemon / pm2)
 */
const restartBot = async (req, res) => {
  log.info('Admin triggered bot restart');

  res.status(200).json({
    success: true,
    message: 'Restart command received. Exiting process...',
  });

  // Small delay so response finishes sending
  setImmediate(() => {
    try {
      const serverFile = path.resolve(__dirname, '../server.js');
      if (fs.existsSync(serverFile)) {
        const now = new Date();
        fs.utimesSync(serverFile, now, now);
        log.info('Touched server.js to trigger Nodemon reload');
      }
    } catch (err) {
      log.warn('Failed to touch server.js during restart', { error: err.message });
    }
    
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  });
};

/**
 * GET /api/admin/logs
 * Fetches the latest 150 lines from the active combined logs
 */
const getLogs = async (req, res) => {
  try {
    const logDir = path.resolve(config.logging.dir);
    if (!fs.existsSync(logDir)) {
      return res.status(200).json({ success: true, logs: ['Log directory does not exist yet'] });
    }

    const files = fs.readdirSync(logDir);
    const logFiles = files
      .filter((f) => f.startsWith('combined-') && f.endsWith('.log'))
      .sort();

    if (logFiles.length === 0) {
      return res.status(200).json({ success: true, logs: ['No log files found'] });
    }

    const latestFile = path.join(logDir, logFiles[logFiles.length - 1]);
    const fileContent = fs.readFileSync(latestFile, 'utf8');

    // Split and get the last 150 lines, filtering out empty lines
    const lines = fileContent
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .slice(-150);

    return res.status(200).json({ success: true, logs: lines });
  } catch (err) {
    log.error('Failed to read logs', { error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/telegram/login/send-code
 * Requests an OTP code from Telegram
 */
const sendTelegramCode = async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'Phone number is required' });
  }

  try {
    const phoneCodeHash = await telegramLoginHelper.sendCode(phoneNumber);
    return res.status(200).json({
      success: true,
      phoneCodeHash,
      message: 'Verification code sent successfully.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/admin/telegram/login/verify-code
 * Verifies the OTP, checks for 2FA, and saves session to .env
 */
const verifyTelegramCode = async (req, res) => {
  const { phoneCode, phoneCodeHash, password } = req.body;

  if (!phoneCode || !phoneCodeHash) {
    return res.status(400).json({
      success: false,
      message: 'Verification code and phoneCodeHash are required',
    });
  }

  try {
    const result = await telegramLoginHelper.verifyCode(phoneCode, phoneCodeHash, password);

    if (result.needsPassword) {
      return res.status(200).json({
        success: false,
        needsPassword: true,
        message: 'Two-Factor Authentication is enabled. Please enter your password.',
      });
    }

    if (result.success && result.sessionString) {
      // Save string session into .env file
      const envPath = path.resolve(process.cwd(), '.env');
      let content = '';
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf8');
      }

      let lines = content.split(/\r?\n/);
      let sessionExists = false;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('TELEGRAM_STRING_SESSION=')) {
          lines[i] = `TELEGRAM_STRING_SESSION=${result.sessionString}`;
          sessionExists = true;
          break;
        }
      }

      if (!sessionExists) {
        lines.push(`TELEGRAM_STRING_SESSION=${result.sessionString}`);
      }

      fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
      log.info('Updated TELEGRAM_STRING_SESSION in .env');

      return res.status(200).json({
        success: true,
        sessionString: result.sessionString,
        message: 'Successfully authenticated! String session saved. Restart the bot to connect.',
      });
    }

    return res.status(500).json({ success: false, message: 'Unknown login error' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  adminAuth,
  login,
  logout,
  getStatus,
  getConfig,
  updateConfig,
  restartBot,
  getLogs,
  sendTelegramCode,
  verifyTelegramCode,
};
