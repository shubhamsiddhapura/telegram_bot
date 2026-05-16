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

// ─── Helpers ────────────────────────────────────────────────────────────────

const required = (key) => {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    throw new Error(`[Config] Missing required environment variable: ${key}`);
  }
  return val.trim();
};

const optional = (key, defaultValue = '') =>
  (process.env[key] || defaultValue).toString().trim();

const int = (key, defaultValue) => {
  const raw = process.env[key];
  const parsed = raw ? parseInt(raw, 10) : defaultValue;
  if (Number.isNaN(parsed)) {
    throw new Error(`[Config] ${key} must be an integer, got: "${raw}"`);
  }
  return parsed;
};

const bool = (key, defaultValue = false) => {
  const raw = optional(key, String(defaultValue)).toLowerCase();
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
    apiId: int('TELEGRAM_API_ID', null),
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
    timeoutMs: int('WHATSAPP_TIMEOUT_MS', 10_000),
    maxRetries: int('WHATSAPP_MAX_RETRIES', 3),
  },

  // ── Processing ────────────────────────────────────────────
  processing: {
    dedupCacheTtlSeconds: int('DEDUP_CACHE_TTL_SECONDS', 3600),
    maxUrlsPerMessage: int('MAX_URLS_PER_MESSAGE', 10),
  },

  // ── Logging ───────────────────────────────────────────────
  logging: {
    level: optional('LOG_LEVEL', 'info'),
    dir: optional('LOG_DIR', './logs'),
  },
};

// ─── Validate TELEGRAM_API_ID separately (numeric) ──────────────────────────
if (!process.env.TELEGRAM_API_ID) {
  throw new Error('[Config] Missing required environment variable: TELEGRAM_API_ID');
}
if (Number.isNaN(config.telegram.apiId)) {
  throw new Error('[Config] TELEGRAM_API_ID must be a numeric value');
}

module.exports = config;
