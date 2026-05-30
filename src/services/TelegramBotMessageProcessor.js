'use strict';

/**
 * services/TelegramBotMessageProcessor.js
 *
 * Orchestrates the Telegram bot link conversion pipeline:
 *   Telegram message
 *     → Extract URLs
 *     → Deduplicate with unique namespace
 *     → Convert via TelegramBotConverter
 *     → Swap original links with converted links in-place
 *     → Send via WhatsApp to target group
 */

const config = require('../config/env');
const logger = require('../utils/logger');
const { extractUrls, replaceUrls, isDirectAmazonUrl } = require('../utils/urlExtractor');
const { isMessageDuplicate, deduplicateUrls } = require('../helpers/dedup');
const telegramBotConverter = require('../telegram/TelegramBotConverter');
const whatsAppService = require('../whatsapp/WhatsAppService');

const log = logger.forModule('TelegramBotMessageProcessor');

class TelegramBotMessageProcessor {
  /**
   * Main pipeline entry point. Called for live incoming Telegram messages.
   *
   * @param {object} params
   * @param {string} params.messageId   — globally unique message ID
   * @param {string} params.text        — raw message text / caption
   * @param {Buffer} params.image       — photo buffer if present
   * @param {string} params.chatTitle   — source channel/group title
   * @param {string|number} params.chatId — source chat identifier
   */
  async process({ messageId, text, image, chatTitle, chatId }) {
    const ctx = { messageId, chatTitle, chatId };
    const prefix = 'tg_bot:';

    // ── 1. Deduplication Check ───────────────────────────────────────────────
    // Namespace the deduplication check so it runs independently from the main pipeline.
    const isDuplicate = await isMessageDuplicate(messageId, prefix);
    if (isDuplicate) {
      log.debug('Skipping duplicate message in new pipeline', ctx);
      return;
    }

    log.info('New pipeline: Processing incoming message', {
      ...ctx,
      preview: text?.slice(0, 60),
      hasImage: !!image,
    });

    // ── 2. Extract URLs & Filter to Amazon Only ──────────────────────────────
    const allUrls = extractUrls(text || '');
    const amazonUrls = allUrls.filter(url => isDirectAmazonUrl(url));
    if (amazonUrls.length === 0) {
      log.debug('Skipping message in new pipeline — no Amazon URLs found', ctx);
      return;
    }

    log.info('Amazon URLs extracted in new pipeline', { ...ctx, count: amazonUrls.length, urls: amazonUrls });

    // ── 3. Deduplicate URLs ──────────────────────────────────────────────────
    // Separate namespace ensures url checks don't conflict with the main pipeline.
    const urlsToConvert = await deduplicateUrls(amazonUrls, prefix);
    if (urlsToConvert.length === 0) {
      log.info('Skipping message in new pipeline — all Amazon URLs already processed', ctx);
      return;
    }

    log.info('Amazon URLs to convert in new pipeline', { ...ctx, count: urlsToConvert.length, urls: urlsToConvert });

    // ── 4. Convert Links sequentially via Telegram bot ────────────────────────
    const replacements = new Map();
    for (const url of urlsToConvert) {
      try {
        const replyText = await telegramBotConverter.convert(url);

        // Extract the converted URL from the bot's reply message
        const replyUrls = extractUrls(replyText);
        if (replyUrls.length === 0) {
          log.warn('Bot reply does not contain a valid URL, skipping this URL', {
            ...ctx,
            originalUrl: url,
            replyText,
          });
          continue;
        }

        const convertedLink = replyUrls[0];
        replacements.set(url, convertedLink);
        log.info('Link converted successfully via Telegram bot', {
          ...ctx,
          originalUrl: url,
          convertedUrl: convertedLink,
        });
      } catch (err) {
        log.error('Failed to convert link via Telegram bot', {
          ...ctx,
          originalUrl: url,
          error: err.message,
        });
      }
    }

    // If zero links were converted successfully, abort forwarding
    if (replacements.size === 0) {
      log.info('Skipping message in new pipeline — zero URLs converted', ctx);
      return;
    }

    // ── 5. Build Final message (swapping links in-place) ─────────────────────
    const finalContent = replaceUrls(text || '', replacements).trim();
    if (!finalContent) {
      log.info('Skipping message in new pipeline — final text is empty', ctx);
      return;
    }

    // ── 6. Send to target WhatsApp Group ─────────────────────────────────────
    const targetJid = config.whatsapp.targetGroup;
    log.info('Dispatching bot-converted message to WhatsApp', { ...ctx, targetJid });

    try {
      await whatsAppService.sendMessage({
        text: finalContent,
        imageBuffer: image,
        chatId,
        messageId,
        targetJid,
      });
      log.info('✅ New pipeline complete', ctx);
    } catch (err) {
      log.error('WhatsApp send failed in new pipeline', { ...ctx, error: err.message });
    }
  }
}

module.exports = new TelegramBotMessageProcessor();
