'use strict';

/**
 * utils/MessageFormatter.js
 *
 * Formats deal messages into a clean, consistent WhatsApp template.
 *
 * Takes the raw converted text (from EarnKaro) which may arrive in
 * wildly different formats from various Telegram channels, and normalises
 * it into a branded, readable message.
 *
 * Template:
 *   🔥 *{Product Title}*
 *
 *   {Deal details — price, discount, coupon, etc.}
 *
 *   🛒 *Buy Now:*
 *   {link(s)}
 *
 *   ━━━━━━━━━━━━━━━
 */

const logger = require('./logger');
const log = logger.forModule('MessageFormatter');

// ─── Regex patterns ──────────────────────────────────────────────────────────

const URL_REGEX =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

/** Patterns that indicate a price or discount — kept on "deal details" lines */
const PRICE_PATTERNS = [
  /rs\.?\s*[\d,]+/i,
  /₹\s*[\d,]+/i,
  /\d+%\s*off/i,
  /mrp/i,
  /coupon/i,
  /discount/i,
  /flat\s+\d+/i,
  /save\s+/i,
  /price/i,
  /offer/i,
  /lowest/i,
  /deal/i,
  /cashback/i,
  /apply\s/i,
  /upto\s/i,
  /up\s+to\s/i,
  /free\s+delivery/i,
  /shipping/i,
];

/** Noise prefixes to strip from the first line (product title) */
const TITLE_NOISE = [
  /^loot\s*:?\s*/i,
  /^#\w+\s*/,           // channel hashtags like #Grab, #AJIO
  /^\*\*\s*/,           // stray Telegram bold markers
  /^🔥\s*/,
  /^💥\s*/,
  /^⚡\s*/,
  /^✅\s*/,
  /^🎯\s*/,
  /^👉\s*/,
  /^➡️?\s*/,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Cleans Telegram-style markdown artifacts from text.
 * Telegram uses **bold** and __italic__; WhatsApp uses *bold* and _italic_.
 * @param {string} text
 * @returns {string}
 */
function cleanTelegramMarkdown(text) {
  // Replace **text** with *text* for WhatsApp bold
  let cleaned = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  // Replace __text__ with _text_ for WhatsApp italic
  cleaned = cleaned.replace(/__(.+?)__/g, '_$1_');
  return cleaned;
}

/**
 * Strips noise prefixes from a title line.
 * @param {string} line
 * @returns {string}
 */
function cleanTitle(line) {
  let title = line.trim();
  for (const pattern of TITLE_NOISE) {
    title = title.replace(pattern, '').trim();
  }
  // Remove trailing colons or dashes
  title = title.replace(/[:\-–—]+\s*$/, '').trim();
  return title;
}

/**
 * Returns true if the line contains a URL.
 * @param {string} line
 * @returns {boolean}
 */
function hasUrl(line) {
  return URL_REGEX.test(line);
}

/**
 * Returns true if the line looks like price/deal info.
 * @param {string} line
 * @returns {boolean}
 */
function isPriceLine(line) {
  return PRICE_PATTERNS.some((p) => p.test(line));
}

/**
 * Extracts all URLs from a text.
 * @param {string} text
 * @returns {string[]}
 */
function extractAllUrls(text) {
  const matches = text.match(URL_REGEX) || [];
  // Deduplicate
  return [...new Set(matches)];
}

/**
 * Returns true if a line is "content-bearing" (not just whitespace, emojis, or punctuation).
 * @param {string} line
 * @returns {boolean}
 */
function isContentLine(line) {
  // Strip emojis, punctuation, whitespace and see if anything is left
  const stripped = line
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/[^\w\s]/g, '')
    .trim();
  return stripped.length > 0;
}

// ─── Main Formatter ──────────────────────────────────────────────────────────

/**
 * Formats a converted deal message into a clean, consistent WhatsApp template.
 *
 * @param {string} rawText — the converted deal text from EarnKaro
 * @returns {string} — formatted WhatsApp message
 */
function formatDealMessage(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return rawText || '';
  }

  // Safety net: if EarnKaro parsing failed and raw JSON leaked through,
  // try to extract the actual deal text from it
  let inputText = rawText;
  if (inputText.trimStart().startsWith('{') && inputText.includes('"data"')) {
    try {
      const parsed = JSON.parse(inputText);
      if (parsed.data && typeof parsed.data === 'string') {
        log.warn('Caught raw JSON in formatter — extracting data field');
        inputText = parsed.data;
      }
    } catch {
      // Not valid JSON, continue with raw text
    }
  }

  // Step 0: Clean Telegram markdown
  let text = cleanTelegramMarkdown(inputText.trim());

  // Step 1: Extract all URLs from the text
  const urls = extractAllUrls(text);

  if (urls.length === 0) {
    // No links at all — just clean up and return
    log.debug('No URLs found in message, returning cleaned text');
    return text;
  }

  // Step 2: Split into lines and categorise
  const lines = text.split('\n');
  let title = '';
  const dealDetails = [];
  const linkLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Reset the regex lastIndex (global flag issue)
    URL_REGEX.lastIndex = 0;

    if (hasUrl(line)) {
      // Reset again after the test call
      URL_REGEX.lastIndex = 0;

      // If the line is ONLY a URL (possibly with "Link:" prefix), treat as link line
      const lineWithoutUrl = line.replace(URL_REGEX, '').replace(/^link\s*:?\s*/i, '').trim();
      if (!lineWithoutUrl || lineWithoutUrl.length < 5) {
        linkLines.push(line);
      } else {
        // Line has both text and URL — split: text goes to details, URL to links
        URL_REGEX.lastIndex = 0;
        const urlsInLine = line.match(URL_REGEX) || [];
        const textPart = line.replace(URL_REGEX, '').replace(/^link\s*:?\s*/i, '').trim();
        if (textPart) {
          dealDetails.push(textPart);
        }
        urlsInLine.forEach((u) => linkLines.push(u));
      }
      continue;
    }

    // Reset again
    URL_REGEX.lastIndex = 0;

    // First content-bearing non-URL line becomes the title
    if (!title && isContentLine(line)) {
      title = cleanTitle(line);
      continue;
    }

    // Everything else is deal detail
    if (isContentLine(line) || isPriceLine(line)) {
      dealDetails.push(line);
    }
  }

  // Step 3: Fallback — if no title was extracted, use the first deal detail
  if (!title && dealDetails.length > 0) {
    title = cleanTitle(dealDetails.shift());
  }

  // If still no title, use a generic one
  if (!title) {
    title = 'Hot Deal';
  }

  // Step 4: Extract clean URLs for the buy section
  const buyLinks = [];
  for (const linkLine of linkLines) {
    URL_REGEX.lastIndex = 0;
    const lineUrls = linkLine.match(URL_REGEX) || [];
    buyLinks.push(...lineUrls);
  }
  // Deduplicate
  const uniqueLinks = [...new Set(buyLinks.length > 0 ? buyLinks : urls)];

  // Step 5: Clean up deal details
  const cleanedDetails = dealDetails
    .map((d) => d.replace(/^link\s*:?\s*/i, '').trim())
    .filter((d) => d.length > 0)
    // Remove lines that are just "at" or single words
    .filter((d) => d.length > 2)
    // Remove duplicate lines
    .filter((d, i, arr) => arr.indexOf(d) === i);

  // Step 6: Build the formatted message
  const parts = [];

  // Header with title
  parts.push(`🔥 *${title}*`);
  parts.push('');

  // Deal details
  if (cleanedDetails.length > 0) {
    parts.push(cleanedDetails.join('\n'));
    parts.push('');
  }

  // Buy links
  if (uniqueLinks.length === 1) {
    parts.push(`🛒 *Buy Now:* ${uniqueLinks[0]}`);
  } else {
    parts.push('🛒 *Buy Now:*');
    uniqueLinks.forEach((link) => parts.push(link));
  }

  // Footer separator
  parts.push('');
  parts.push('━━━━━━━━━━━━━━━');

  const formatted = parts.join('\n');

  log.debug('Message formatted', {
    titleExtracted: title,
    detailLines: cleanedDetails.length,
    linkCount: uniqueLinks.length,
  });

  return formatted;
}

module.exports = { formatDealMessage };
