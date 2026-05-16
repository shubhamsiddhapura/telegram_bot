'use strict';

/**
 * utils/urlExtractor.js
 *
 * Pure-function utilities for:
 *  - Extracting URLs from arbitrary text
 *  - Validating URLs
 *  - Filtering Amazon URLs
 *  - Deduplicating URL lists
 */

const { AMAZON_DOMAINS, BLOCKED_REDIRECT_DOMAINS } = require('../constants');

// ─── Regex ───────────────────────────────────────────────────────────────────

/**
 * Matches http/https URLs.
 * Captures trailing punctuation separately to avoid false-positive ends.
 */
const URL_REGEX =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strips common trailing punctuation that tends to get captured as part of URLs.
 * @param {string} url
 * @returns {string}
 */
const stripTrailingPunctuation = (url) => url.replace(/[.,;:!?)]+$/, '');

/**
 * Returns true if the URL is syntactically valid.
 * @param {string} url
 * @returns {boolean}
 */
const isValidUrl = (url) => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

/**
 * Returns true if the URL belongs to an Amazon domain or a known
 * affiliate redirect domain that wraps Amazon links.
 * @param {string} url
 * @returns {boolean}
 */
const isAmazonUrl = (url) => {
  try {
    const { hostname } = new URL(url);
    const normalised = hostname.replace(/^www\./, '').toLowerCase();

    // Check direct Amazon domains
    const isAmazon = AMAZON_DOMAINS.some(
      (domain) => normalised === domain || normalised.endsWith(`.${domain}`),
    );
    if (isAmazon) return true;

    // Check known affiliate redirect domains that wrap Amazon links
    const isBlockedRedirect = BLOCKED_REDIRECT_DOMAINS.some(
      (domain) => normalised === domain || normalised.endsWith(`.${domain}`),
    );
    return isBlockedRedirect;
  } catch {
    return false;
  }
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Extracts all unique, valid HTTP/HTTPS URLs from a text string.
 * Does NOT filter Amazon at this stage — use filterUrls() for that.
 *
 * @param {string} text
 * @returns {string[]}
 */
const extractUrls = (text) => {
  if (!text || typeof text !== 'string') return [];

  const matches = text.match(URL_REGEX) || [];
  const seen = new Set();
  const result = [];

  for (const raw of matches) {
    const url = stripTrailingPunctuation(raw);
    if (isValidUrl(url) && !seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }

  return result;
};

/**
 * Filters a URL list:
 *  1. Removes Amazon URLs
 *  2. Removes duplicates (by href)
 *
 * @param {string[]} urls
 * @returns {{ valid: string[], blocked: string[] }}
 */
const filterUrls = (urls) => {
  const valid = [];
  const blocked = [];
  const seen = new Set();

  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);

    if (isAmazonUrl(url)) {
      blocked.push(url);
    } else {
      valid.push(url);
    }
  }

  return { valid, blocked };
};

/**
 * Replaces original URLs in a text with their converted counterparts.
 * Falls back to the original URL if no replacement is found.
 *
 * @param {string} text  — original message text
 * @param {Map<string, string>} replacements — Map<originalUrl, convertedUrl>
 * @returns {string}
 */
const replaceUrls = (text, replacements) => {
  let result = text;
  for (const [original, converted] of replacements) {
    // Escape special regex chars in the original URL
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), converted);
  }
  return result;
};

module.exports = { extractUrls, filterUrls, isAmazonUrl, isValidUrl, replaceUrls };
