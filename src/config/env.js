'use strict';

/**
 * config/env.js
 *
 * Central environment configuration.
 * Validates all required variables at startup; throws descriptive
 * errors rather than letting undefined values surface at runtime.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

// Deploy ID: force_deploy_v2

// ─── Debug: Print available environment keys (NO VALUES) ──────────────────
const availableKeys = Object.keys(process.env).filter(k => !k.startsWith('npm_') && !k.startsWith('NODE_'));
console.log(`[Config] Debug: Available Environment Keys: ${availableKeys.join(', ')}`);

// ─── Helpers ────────────────────────────────────────────────────────────────

const required = (key) => {
  let val = process.env[key];

  // Remove any accidental double quotes from the value
  if (val) {
    val = val.replace(/^["'](.+)["']$/, '$1').trim();
  }

  if (!val || val === '') {
    console.error(`[Config] Missing required environment variable: ${key}`);
    throw new Error(`[Config] Missing required environment variable: ${key}`);
  }
  return val;
};

const optional = (key, defaultValue = '') => {
  let val = process.env[key];
  if (val) {
    val = val.replace(/^["'](.+)["']$/, '$1').trim();
  }
  return (val || defaultValue).toString();
};

const int = (key, defaultValue) => {
  let raw = process.env[key];
  if (raw) {
    raw = raw.replace(/^["'](.+)["']$/, '$1').trim();
  }
  const parsed = raw ? parseInt(raw, 10) : defaultValue;
  if (Number.isNaN(parsed)) {
    throw new Error(`[Config] ${key} must be an integer, got: "${raw}"`);
  }
  return Number(parsed);
};

const bool = (key, defaultValue = false) => {
  let raw = process.env[key];
  if (raw) {
    raw = raw.replace(/^["'](.+)["']$/, '$1').trim().toLowerCase();
  } else {
    raw = String(defaultValue).toLowerCase();
  }
  return raw === 'true' || raw === '1';
};

// ─── Config Object ───────────────────────────────────────────────────────────

const config = {
  // ── Server ────────────────────────────────────────────────
  port: int('PORT', 3000),
  nodeEnv: optional('NODE_ENV', 'development'),
  isDev: optional('NODE_ENV', 'development') === 'development',
  isProd: optional('NODE_ENV', 'development') === 'production',

  // ── Telegram ──────────────────────────────────────────────
  telegram: {
    apiId: int('TELEGRAM_API_ID', 0),
    apiHash: required('TELEGRAM_API_HASH'),
    stringSession: required('TELEGRAM_STRING_SESSION'),
    allowedChats: optional('TELEGRAM_ALLOWED_CHATS', '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  },

  // ── EarnKaro ──────────────────────────────────────────────
  earnkaro: {
    apiToken: required('EARNKARO_API_TOKEN'),
    apiUrl: optional(
      'EARNKARO_API_URL',
      'https://ekaro-api.affiliaters.in/api/converter/public',
    ),
    timeoutMs: int('EARNKARO_TIMEOUT_MS', 10_000),
    maxRetries: int('EARNKARO_MAX_RETRIES', 3),
  },

  // ── WhatsApp ──────────────────────────────────────────────
  whatsapp: {
    secret: optional('WHATSAPP_SECRET', 'mysecret123'),
    targetGroup: required('WHATSAPP_TARGET_GROUP'),
    phoneNumber: optional('WHATSAPP_PHONE_NUMBER', ''),
    timeoutMs: int('WHATSAPP_TIMEOUT_MS', 10_000),
    maxRetries: int('WHATSAPP_MAX_RETRIES', 3),
  },

  // ── Processing ────────────────────────────────────────────
  processing: {
    dedupCacheTtlSeconds: int('DEDUP_CACHE_TTL_SECONDS', 3600),
    maxUrlsPerMessage: int('MAX_URLS_PER_MESSAGE', 25),
  },

  // ── Logging ───────────────────────────────────────────────
  logging: {
    level: optional('LOG_LEVEL', 'info'),
    dir: optional('LOG_DIR', './logs'),
  },
};

// ─── Validate TELEGRAM_API_ID separately (numeric) ──────────────────────────

if (Number.isNaN(config.telegram.apiId)) {
  throw new Error('[Config] TELEGRAM_API_ID must be a numeric value');
}

module.exports = config;
