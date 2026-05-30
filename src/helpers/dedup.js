'use strict';

/**
 * helpers/dedup.js
 *
 * Redis-backed deduplication for:
 *  - Telegram message IDs (prevent processing the same message twice)
 *  - URLs (prevent converting the same URL multiple times per session)
 *
 * Falls back to in-memory Set when Redis is unavailable.
 */

const { createHash } = require('crypto');
const config = require('../config/env');
const { CACHE_KEYS } = require('../constants');
const logger = require('../utils/logger');

// ─── In-memory Cache ─────────────────────────────────────────────────────────

const memCache = new Set();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const hashUrl = (url) =>
  createHash('sha256').update(url).digest('hex').slice(0, 16);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns true if the message has already been processed (seen before).
 * Marks it as seen if not.
 *
 * @param {string} messageId — globally unique message identifier
 * @returns {Promise<boolean>}
 */
const isMessageDuplicate = async (messageId, prefix = '') => {
  const key = `${prefix}${CACHE_KEYS.MESSAGE_DEDUP}${messageId}`;

  if (memCache.has(key)) return true;
  memCache.add(key);

  // Keep cache size manageable in memory (optional safety)
  if (memCache.size > 10000) {
    const firstValue = memCache.values().next().value;
    memCache.delete(firstValue);
  }

  return false;
};

/**
 * Returns true if the URL has already been processed recently.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
const isUrlDuplicate = async (url, prefix = '') => {
  const key = `${prefix}${CACHE_KEYS.URL_DEDUP}${hashUrl(url)}`;

  if (memCache.has(key)) return true;
  memCache.add(key);

  if (memCache.size > 10000) {
    const firstValue = memCache.values().next().value;
    memCache.delete(firstValue);
  }

  return false;
};

/**
 * Filters an array of URLs, returning only those not seen before.
 *
 * @param {string[]} urls
 * @returns {Promise<string[]>}
 */
const deduplicateUrls = async (urls, prefix = '') => {
  const results = await Promise.all(
    urls.map(async (url) => ({ url, isDup: await isUrlDuplicate(url, prefix) })),
  );
  return results.filter((r) => !r.isDup).map((r) => r.url);
};

module.exports = { isMessageDuplicate, isUrlDuplicate, deduplicateUrls };
