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

  const lines = text.split('\n');

  // Helper to determine if a line has a valid title candidate
  const getTitleCandidate = (line) => {
    URL_REGEX.lastIndex = 0;
    const withoutUrl = line.replace(URL_REGEX, '').trim();
    URL_REGEX.lastIndex = 0;
    const cleaned = cleanTitle(withoutUrl);
    if (cleaned && isContentLine(cleaned) && cleaned.length > 2) {
      return cleaned;
    }
    return null;
  };

  if (urls.length === 1) {
    // ─── Pathway A: Single URL (Traditional Deal Format) ────────────────────
    const targetUrl = urls[0];
    let title = '';
    const dealDetails = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // If the line is pure noise (like lone hashtags, stray markdown, etc.), skip it
      if (cleanTitle(line) === '') {
        continue;
      }

      URL_REGEX.lastIndex = 0;
      if (hasUrl(line)) {
        URL_REGEX.lastIndex = 0;
        const cleaned = line
          .replace(URL_REGEX, '')
          .replace(/^link\s*:?\s*/i, '')
          .replace(/^🔗\s*product\s*link\s*:?\s*/i, '')
          .replace(/^🔗\s*link\s*:?\s*/i, '')
          .replace(/^🔗\s*/, '')
          .trim();

        if (cleaned && cleaned.length >= 3) {
          const candidate = getTitleCandidate(cleaned);
          if (!title && candidate) {
            title = candidate;
          } else {
            dealDetails.push(cleaned);
          }
        }
      } else {
        const candidate = getTitleCandidate(line);
        if (!title && candidate) {
          title = candidate;
        } else if (isContentLine(line) || isPriceLine(line)) {
          dealDetails.push(line);
        }
      }
    }

    // Fallbacks
    if (!title && dealDetails.length > 0) {
      title = cleanTitle(dealDetails.shift());
    }
    if (!title) {
      title = 'Hot Deal';
    }

    const cleanedDetails = dealDetails
      .map((d) => d.trim())
      .filter((d) => d.length > 2)
      .filter((d, i, arr) => arr.indexOf(d) === i);

    const parts = [];
    parts.push(`*${title}*`);
    parts.push('');

    if (cleanedDetails.length > 0) {
      parts.push(cleanedDetails.join('\n'));
      parts.push('');
    }

    parts.push(`🛒 *Buy Now:* ${targetUrl}`);

    const formatted = parts.join('\n');
    log.debug('Message formatted (single-link)', { titleExtracted: title });
    return formatted;

  } else {
    // ─── Pathway B: Multi-URL (Preserve Inline Associations) ─────────────────
    let titleIndex = -1;
    let titleText = '';

    for (let i = 0; i < lines.length; i++) {
      if (getTitleCandidate(lines[i])) {
        titleIndex = i;
        break;
      }
    }

    const formattedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        formattedLines.push('');
        continue;
      }

      // If the line is pure noise (like lone hashtags, stray markdown, etc.), skip it
      if (cleanTitle(line) === '') {
        continue;
      }

      if (i === titleIndex) {
        URL_REGEX.lastIndex = 0;
        if (hasUrl(line)) {
          URL_REGEX.lastIndex = 0;
          const urlsInLine = line.match(URL_REGEX) || [];
          const textPart = line.replace(URL_REGEX, '').trim();

          titleText = cleanTitle(textPart);
          if (!titleText) {
            titleText = 'Hot Deal';
          }

          formattedLines.push(`*${titleText}*`);
          urlsInLine.forEach((url) => formattedLines.push(url));
        } else {
          titleText = cleanTitle(line);
          formattedLines.push(`*${titleText}*`);
        }
        formattedLines.push('');
      } else {
        formattedLines.push(line);
      }
    }

    // Collapse consecutive empty lines
    const finalLines = [];
    for (let i = 0; i < formattedLines.length; i++) {
      const curr = formattedLines[i];
      if (curr === '') {
        if (finalLines.length > 0 && finalLines[finalLines.length - 1] !== '') {
          finalLines.push('');
        }
      } else {
        finalLines.push(curr);
      }
    }

    if (finalLines.length > 0 && finalLines[finalLines.length - 1] === '') {
      finalLines.pop();
    }

    const formatted = finalLines.join('\n');
    log.debug('Message formatted (multi-link)', { titleExtracted: titleText });
    return formatted;
  }
}

module.exports = { formatDealMessage };
