'use strict';

/**
 * constants/index.js
 *
 * Application-wide constants. No business logic here — pure data.
 */

// ─── Amazon blocked domains ───────────────────────────────────────────────────

const AMAZON_DOMAINS = Object.freeze([
  'amazon.in',
  'amazon.com',
  'amazon.co.uk',
  'amazon.de',
  'amazon.fr',
  'amazon.ca',
  'amazon.com.au',
  'amazon.com.br',
  'amazon.co.jp',
  'amzn.to',
  'amzn.in',
  'amzn.eu',
  'amzn-to.co',       // copycat Amazon shortener
  'a.co',
]);

// ─── Affiliate redirect domains that wrap Amazon/unsupported links ────────────
// These are deal aggregator sites whose links EarnKaro cannot convert.
const BLOCKED_REDIRECT_DOMAINS = Object.freeze([
  'dealspouch.com',   // redirects to Amazon
  'amaz.dealspouch.com',
]);

// ─── Queue names ─────────────────────────────────────────────────────────────

const QUEUE_NAMES = Object.freeze({
  MESSAGE_PROCESSING: 'message-processing',
  WHATSAPP_SENDER: 'whatsapp-sender',
});

// ─── Event names ─────────────────────────────────────────────────────────────

const EVENTS = Object.freeze({
  TELEGRAM_MESSAGE: 'telegram:message',
  URLS_EXTRACTED: 'urls:extracted',
  LINKS_CONVERTED: 'links:converted',
  WHATSAPP_SEND: 'whatsapp:send',
});

// ─── HTTP status codes ───────────────────────────────────────────────────────

const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

// ─── Cache key prefixes ──────────────────────────────────────────────────────

const CACHE_KEYS = Object.freeze({
  MESSAGE_DEDUP: 'dedup:msg:',
  URL_DEDUP: 'dedup:url:',
});

// ─── Retry config ────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 5_000]); // exponential-ish

module.exports = {
  AMAZON_DOMAINS,
  BLOCKED_REDIRECT_DOMAINS,
  QUEUE_NAMES,
  EVENTS,
  HTTP_STATUS,
  CACHE_KEYS,
  RETRY_DELAYS_MS,
};
