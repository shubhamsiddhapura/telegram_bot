'use strict';

/**
 * test-e2e-amazon.js
 *
 * Full end-to-end test of the Amazon link pipeline:
 *   1. Connect to Telegram (real credentials)
 *   2. Fetch recent messages from allowed Telegram groups
 *   3. Extract Amazon URLs
 *   4. Convert via TelegramBotConverter (real bot interaction)
 *   5. Build final message with replaced URLs
 *   6. Mock WhatsApp send — print what would be dispatched
 *
 * Run: node test-e2e-amazon.js
 */

require('./src/config/env');
const config = require('./src/config/env');
const logger = require('./src/utils/logger');
const telegramService = require('./src/telegram/TelegramService');
const telegramBotConverter = require('./src/telegram/TelegramBotConverter');
const { extractUrls, replaceUrls, isAmazonUrl } = require('./src/utils/urlExtractor');
const { sleep } = require('./src/utils/asyncWrapper');

const log = logger.forModule('E2E-AmazonTest');

// ─── Color helpers ───────────────────────────────────────────────────────────
const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan   = (s) => `\x1b[36m${s}\x1b[0m`;
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;
const dim    = (s) => `\x1b[2m${s}\x1b[0m`;

function header(title) {
  console.log('\n' + '='.repeat(70));
  console.log(bold(cyan(`  ${title}`)));
  console.log('='.repeat(70));
}

function divider() {
  console.log(dim('  ' + '-'.repeat(66)));
}

async function run() {
  header('E2E Amazon Link Pipeline Test');
  console.log(`  ${yellow('This test uses REAL Telegram credentials and bot interaction.')}`);
  console.log(`  ${yellow('WhatsApp send is MOCKED — nothing will be sent to your group.')}`);
  console.log('');

  // ── Step 1: Connect to Telegram ────────────────────────────────────────────
  header('STEP 1: Connecting to Telegram');
  
  try {
    await telegramService.start();
  } catch (err) {
    console.log(red(`  Failed to start TelegramService: ${err.message}`));
    process.exit(1);
  }

  let connected = false;
  for (let i = 0; i < 20; i++) {
    if (telegramService.isConnected) {
      connected = true;
      break;
    }
    console.log(`  ...waiting for Telegram connection (${i + 1}/20)`);
    await sleep(1000);
  }

  if (!connected) {
    console.log(red('  Telegram client failed to connect within 20 seconds.'));
    process.exit(1);
  }
  console.log(green('  Connected to Telegram!'));

  // Give it a moment to finish catch-up history so it doesn't interfere
  await sleep(3000);

  // ── Step 2: Fetch recent messages from allowed chats ───────────────────────
  header('STEP 2: Fetching Recent Messages from Allowed Chats');

  const allowedChats = config.telegram.allowedChats;
  console.log(`  Allowed chats: [${allowedChats.join(', ')}]`);

  const client = telegramService.client;
  const allMessages = [];

  for (const chatId of allowedChats) {
    try {
      console.log(`\n  ${cyan(`Scanning chat: ${chatId}`)}`);
      const messages = await client.getMessages(chatId, { limit: 10 });

      if (!messages || messages.length === 0) {
        console.log(`    No messages found.`);
        continue;
      }

      console.log(`    Found ${messages.length} recent messages`);

      for (const msg of messages) {
        let text = msg.message || msg.text || '';

        // Extract hidden entity URLs (same logic as TelegramService)
        if (msg.entities) {
          const hiddenUrlEntities = msg.entities
            .filter(e => e.className === 'MessageEntityTextUrl' && e.url && !text.includes(e.url));

          hiddenUrlEntities
            .sort((a, b) => (b.offset ?? 0) - (a.offset ?? 0))
            .forEach(entity => {
              const insertPos = (entity.offset ?? 0) + (entity.length ?? 0);
              text = text.slice(0, insertPos) + ' ' + entity.url + text.slice(insertPos);
            });
        }

        // Extract button URLs
        if (msg.replyMarkup && msg.replyMarkup.rows) {
          const buttonUrls = [];
          for (const row of msg.replyMarkup.rows) {
            if (!row.buttons) continue;
            for (const btn of row.buttons) {
              const btnUrl = btn.url || btn.data?.toString();
              if (btnUrl && /^https?:\/\//i.test(btnUrl) && !text.includes(btnUrl)) {
                buttonUrls.push(btnUrl);
              }
            }
          }
          if (buttonUrls.length > 0) {
            text += '\n' + buttonUrls.join('\n');
          }
        }

        const chatTitle = await (async () => {
          try {
            const chat = await msg.getChat();
            return chat?.title ?? chat?.username ?? `chat_${chatId}`;
          } catch { return `chat_${chatId}`; }
        })();

        allMessages.push({
          messageId: `${chatId}:${msg.id}`,
          text,
          chatTitle,
          chatId,
          date: msg.date,
          hasPhoto: !!msg.photo,
        });
      }
      
      await sleep(500);
    } catch (err) {
      console.log(`    ${red(`Error fetching chat ${chatId}: ${err.message}`)}`);
    }
  }

  console.log(`\n  ${bold(`Total messages fetched: ${allMessages.length}`)}`);

  // ── Step 3: Filter messages with Amazon URLs ───────────────────────────────
  header('STEP 3: Finding Messages with Amazon URLs');

  const messagesWithAmazon = [];

  for (const msg of allMessages) {
    const allUrls = extractUrls(msg.text || '');
    const amazonUrls = allUrls.filter(url => isAmazonUrl(url));

    const ageMinutes = Math.floor((Date.now() / 1000 - msg.date) / 60);

    if (allUrls.length > 0) {
      console.log(`  ${dim(`[${msg.chatTitle}] ${msg.messageId} (${ageMinutes}m ago)`)}`);
      console.log(`    Text: ${(msg.text || '').slice(0, 100).replace(/\n/g, ' ')}...`);
      console.log(`    All URLs: ${allUrls.length} | Amazon URLs: ${amazonUrls.length}`);
      
      if (amazonUrls.length > 0) {
        console.log(`    ${green(`>>> Amazon URLs: ${amazonUrls.join(', ')}`)}`);
        messagesWithAmazon.push({ ...msg, amazonUrls, allUrls });
      } else {
        console.log(`    ${dim('(no Amazon URLs, skipping)')}`);
      }
      divider();
    }
  }

  if (messagesWithAmazon.length === 0) {
    console.log(`\n  ${yellow('No messages with Amazon URLs found in recent messages.')}`);
    console.log(`  ${yellow('The channels may not have posted Amazon deals recently.')}`);
    console.log(`  ${yellow('Try again when a deal channel posts an Amazon link.')}`);
    await telegramService.stop();
    process.exit(0);
  }

  console.log(`\n  ${bold(green(`Found ${messagesWithAmazon.length} message(s) with Amazon URLs`))}`);

  // ── Step 4: Convert Amazon URLs via Bot ────────────────────────────────────
  // Only process the FIRST message to avoid spamming the bot
  header('STEP 4: Converting Amazon URLs via Bot');

  const targetMsg = messagesWithAmazon[0];
  console.log(`  ${cyan('Processing message:')}`);
  console.log(`    Chat: ${targetMsg.chatTitle}`);
  console.log(`    ID: ${targetMsg.messageId}`);
  console.log(`    Text: ${(targetMsg.text || '').slice(0, 120).replace(/\n/g, ' ')}...`);
  console.log(`    Amazon URLs to convert: ${targetMsg.amazonUrls.length}`);
  console.log('');

  const replacements = new Map();

  for (const url of targetMsg.amazonUrls) {
    console.log(`  ${yellow(`Converting: ${url}`)}`);
    try {
      const replyText = await telegramBotConverter.convert(url);
      console.log(`    Bot raw reply: "${replyText}"`);

      const replyUrls = extractUrls(replyText);
      if (replyUrls.length === 0) {
        console.log(`    ${red('Bot reply has NO valid URL — conversion FAILED for this URL')}`);
        continue;
      }

      const convertedUrl = replyUrls[0];
      replacements.set(url, convertedUrl);
      console.log(`    ${green(`Converted: ${url}`)}`);
      console.log(`    ${green(`       to: ${convertedUrl}`)}`);
    } catch (err) {
      console.log(`    ${red(`Conversion error: ${err.message}`)}`);
    }
    console.log('');
  }

  if (replacements.size === 0) {
    console.log(`  ${red('No URLs were successfully converted. Pipeline would ABORT here.')}`);
    await telegramService.stop();
    process.exit(1);
  }

  // ── Step 5: Build final message ────────────────────────────────────────────
  header('STEP 5: Building Final Message');

  const finalContent = replaceUrls(targetMsg.text || '', replacements).trim();
  
  console.log(`  ${cyan('Original message:')}`);
  console.log(`  ${dim('---')}`);
  for (const line of (targetMsg.text || '').split('\n')) {
    console.log(`  ${dim('|')} ${line}`);
  }
  console.log(`  ${dim('---')}`);

  console.log('');
  console.log(`  ${green('Final message (with converted links):')}`);
  console.log(`  ${dim('---')}`);
  for (const line of finalContent.split('\n')) {
    console.log(`  ${dim('|')} ${line}`);
  }
  console.log(`  ${dim('---')}`);
  
  console.log('');
  console.log(`  Final message empty? ${!finalContent ? red('YES — would be skipped!') : green('No')}`);

  // ── Step 6: Mock WhatsApp send ─────────────────────────────────────────────
  header('STEP 6: WhatsApp Dispatch (MOCKED)');

  const targetJid = config.whatsapp.targetGroup;
  console.log(`  Target Group JID: ${targetJid}`);
  console.log(`  Message ID:       ${targetMsg.messageId}`);
  console.log(`  Chat ID:          ${targetMsg.chatId}`);
  console.log(`  Has Image:        ${targetMsg.hasPhoto}`);
  console.log('');
  console.log(`  ${green(bold('Message that WOULD be sent to WhatsApp:'))}`);
  console.log(`  ${dim('---')}`);
  for (const line of finalContent.split('\n')) {
    console.log(`  ${dim('|')} ${line}`);
  }
  console.log(`  ${dim('---')}`);

  // ── Step 7: Verify converted URLs are valid ────────────────────────────────
  header('STEP 7: Post-Conversion Validation');

  const finalUrls = extractUrls(finalContent);
  console.log(`  URLs in final message: ${finalUrls.length}`);
  
  for (const url of finalUrls) {
    const isAmz = isAmazonUrl(url);
    console.log(`    ${url}`);
    console.log(`      isAmazonUrl: ${isAmz ? yellow('YES (converted link is still recognized as Amazon)') : green('No (clean affiliate link)')}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  header('SUMMARY');

  console.log(`  Messages scanned:         ${allMessages.length}`);
  console.log(`  Messages with Amazon URLs: ${messagesWithAmazon.length}`);
  console.log(`  URLs converted:           ${replacements.size}/${targetMsg.amazonUrls.length}`);
  console.log(`  Final message valid:      ${finalContent ? green('YES') : red('NO')}`);
  
  const convertedUrls = [...replacements.values()];
  const convertedAreAmazon = convertedUrls.filter(u => isAmazonUrl(u));
  if (convertedAreAmazon.length > 0) {
    console.log(`\n  ${red(bold('WARNING: Converted URLs are still recognized as Amazon URLs!'))}`);
    console.log(`  ${red('This could cause issues if the main EarnKaro pipeline also processes them.')}`);
    for (const u of convertedAreAmazon) {
      console.log(`    ${red(u)}`);
    }
  }

  console.log(`\n  ${bold('Replacement Map:')}`);
  for (const [orig, conv] of replacements) {
    console.log(`    ${orig}`);
    console.log(`      ${green('→')} ${conv}`);
  }

  console.log('');

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await telegramService.stop();
  process.exit(0);
}

run().catch(err => {
  console.error(red(`\nFATAL ERROR: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
