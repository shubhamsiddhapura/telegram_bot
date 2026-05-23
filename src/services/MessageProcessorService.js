'use strict';

/**
 * services/MessageProcessorService.js
 *
 * Orchestrates the full deal processing pipeline:
 *
 *   Telegram message
 *     → Extract URLs
 *     → Filter Amazon + duplicates
 *     → Convert via EarnKaro
 *     → Build final message
 *     → Send via WhatsApp
 *
 * This service is intentionally dependency-injected to keep it testable.
 */

const config = require('../config/env');
const logger = require('../utils/logger');
const { extractUrls, filterUrls, replaceUrls } = require('../utils/urlExtractor');
const { isMessageDuplicate, deduplicateUrls } = require('../helpers/dedup');
const earnKaroService = require('../earnkaro/EarnKaroService');
const whatsAppService = require('../whatsapp/WhatsAppService');

const log = logger.forModule('MessageProcessor');

class MessageProcessorService {
  // ─── Public Entry Point ──────────────────────────────────────────────────────

  /**
   * Main pipeline entry point. Called for every incoming Telegram message.
   *
   * @param {object} params
   * @param {string} params.messageId   — globally unique message ID (chatId:msgId)
   * @param {string} params.text        — raw message text
   * @param {string} params.chatTitle   — source channel/group title for logging
   * @param {number} params.chatId      — numeric chat/channel ID
   */
  async process({ messageId, text, image, chatTitle, chatId }) {
    const ctx = { messageId, chatTitle, chatId };

    // ── 1. Dedup check ───────────────────────────────────────────────────────
    const isDuplicate = await isMessageDuplicate(messageId);
    if (isDuplicate) {
      log.debug('Skipping duplicate message', ctx);
      return;
    }

    log.info('Processing new message', { ...ctx, preview: text?.slice(0, 60), hasImage: !!image });

    // ── 2. Extract URLs ──────────────────────────────────────────────────────
    const allUrls = extractUrls(text || '');

    if (allUrls.length > 0) {
      log.info('URLs extracted', { ...ctx, count: allUrls.length, urls: allUrls });
    }

    // ── 3. Convert Links (EarnKaro) ───────────────────────────────────────────
    let finalContent = text;

    // Remove Amazon links first, then cap the remaining URLs.
    const { valid: eligibleUrls, blocked: blockedUrls } = filterUrls(allUrls);
    const capped = eligibleUrls.slice(0, config.processing.maxUrlsPerMessage);

    // ── 4b. Deduplicate URLs check
    const urlsToConvert = await deduplicateUrls(capped);
    const urlsToRemove = allUrls.filter((url) => !urlsToConvert.includes(url));

    if (urlsToConvert.length > 0) {
      log.info('URLs to convert', { ...ctx, count: urlsToConvert.length, urls: urlsToConvert });

      // ── 5. Convert via EarnKaro ─────────────────────────────────────────────
      const dealTextForConversion = this._buildDealTextForConversion(text, urlsToConvert);

      const { convertedText, success: conversionSuccess, error: conversionError } =
        await earnKaroService.convertDeal(dealTextForConversion);

      if (conversionSuccess) {
        // ── 5b. Detect EarnKaro "soft" errors ─────────────────────────────────
        const earnKaroErrorPatterns = [
          'could not locate',
          'verify if the seller',
          'not supported',
          'unable to convert',
        ];
        const lowerConverted = convertedText.toLowerCase();
        const isEarnKaroError = earnKaroErrorPatterns.some((p) => lowerConverted.includes(p));

        if (!isEarnKaroError) {
          finalContent = convertedText;
        } else {
          log.warn('EarnKaro returned a soft error; using original text', {
            ...ctx,
            response: convertedText.slice(0, 120),
          });
        }
      } else {
        log.error('Link conversion failed; using original text', {
          ...ctx,
          error: conversionError,
        });
      }
    } else {
      log.info('No URLs to convert; proceeding with original message content', ctx);
    }

    const cleanedContent = this._removeUrlsFromText(finalContent, urlsToRemove);

    if (!cleanedContent.trim()) {
      log.info('No sendable content after filtering; skipping WhatsApp send', {
        ...ctx,
        blockedCount: blockedUrls.length,
        removedCount: urlsToRemove.length,
      });
      return;
    }

    log.info('Links ready', ctx);

    // ── 6. Build final WhatsApp message ──────────────────────────────────────
    const finalMessage = this._buildFinalMessage(cleanedContent);

    // ── 6. Send to WhatsApp ──────────────────────────────────────────────────
    log.info('Final message built; dispatching to WhatsApp', ctx);

    try {
      await whatsAppService.sendMessage({
        text: finalMessage,
        imageBuffer: image,
        chatId,
        messageId
      });
      log.info('Message sent successfully', ctx);
    } catch (err) {
      log.error('WhatsApp send failed', { ...ctx, error: err.message });
      return;
    }

    log.info('✅ Pipeline complete', ctx);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Builds the text blob we send to EarnKaro for conversion.
   * We pass the full original message so EarnKaro can swap URLs in-place,
   * preserving surrounding context.
   *
   * @param {string} originalText
   * @param {string[]} urlsToConvert  — subset of URLs we want converted
   * @returns {string}
   */
  _buildDealTextForConversion(originalText, urlsToConvert) {
    if (!originalText) return urlsToConvert.join('\n');

    return originalText || urlsToConvert.join('\n');
  }

  /**
   * Removes filtered URLs from the text before sending.
   *
   * @param {string} text
   * @param {string[]} urlsToRemove
   * @returns {string}
   */
  _removeUrlsFromText(text, urlsToRemove) {
    if (!text || !urlsToRemove || urlsToRemove.length === 0) {
      return text || '';
    }

    const replacements = new Map(urlsToRemove.map((url) => [url, '']));
    return replaceUrls(text, replacements)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Applies any final formatting to the converted message before sending.
   * Add a footer, emoji, etc. here as desired.
   *
   * @param {string} convertedText
   * @returns {string}
   */
  _buildFinalMessage(convertedText) {
    const lines = [
      '🔥 *New Deal Alert!*',
      '',
      convertedText.trim(),
    ];
    return lines.join('\n');
  }
}

module.exports = new MessageProcessorService();
