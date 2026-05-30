'use strict';

/**
 * test-amazon-pipeline-debug.js
 *
 * Diagnostic script to trace each step of the Amazon link pipeline:
 *   1. URL extraction from text
 *   2. Amazon URL identification
 *   3. Dedup filtering
 *   4. TelegramBotConverter conversion (mocked)
 *   5. URL replacement in text
 *
 * Run: node test-amazon-pipeline-debug.js
 */

// Load env
require('./src/config/env');

const { extractUrls, filterUrls, isAmazonUrl, isDirectAmazonUrl, replaceUrls } = require('./src/utils/urlExtractor');
const { AMAZON_DOMAINS, BLOCKED_REDIRECT_DOMAINS } = require('./src/constants');

// ─── Color helpers for console ───────────────────────────────────────────────
const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan   = (s) => `\x1b[36m${s}\x1b[0m`;
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;

function header(title) {
  console.log('\n' + '═'.repeat(70));
  console.log(bold(cyan(`  ${title}`)));
  console.log('═'.repeat(70));
}

function pass(msg) { console.log(`  ${green('✓')} ${msg}`); }
function fail(msg) { console.log(`  ${red('✗')} ${msg}`); }
function info(msg) { console.log(`  ${yellow('→')} ${msg}`); }

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, passMsg, failMsg) {
  totalTests++;
  if (condition) {
    passedTests++;
    pass(passMsg);
  } else {
    failedTests++;
    fail(failMsg);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Verify AMAZON_DOMAINS and BLOCKED_REDIRECT_DOMAINS constants
// ═══════════════════════════════════════════════════════════════════════════════
header('STEP 1: Constants Verification');

info(`AMAZON_DOMAINS (${AMAZON_DOMAINS.length} entries): ${AMAZON_DOMAINS.join(', ')}`);
info(`BLOCKED_REDIRECT_DOMAINS (${BLOCKED_REDIRECT_DOMAINS.length} entries): ${BLOCKED_REDIRECT_DOMAINS.join(', ')}`);

assert(AMAZON_DOMAINS.includes('amazon.in'), 'amazon.in is in AMAZON_DOMAINS', 'amazon.in is MISSING from AMAZON_DOMAINS');
assert(AMAZON_DOMAINS.includes('amzn.to'), 'amzn.to is in AMAZON_DOMAINS', 'amzn.to is MISSING from AMAZON_DOMAINS');
assert(AMAZON_DOMAINS.includes('amazon.com'), 'amazon.com is in AMAZON_DOMAINS', 'amazon.com is MISSING from AMAZON_DOMAINS');
assert(AMAZON_DOMAINS.includes('a.co'), 'a.co is in AMAZON_DOMAINS', 'a.co is MISSING from AMAZON_DOMAINS');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: Test URL Extraction
// ═══════════════════════════════════════════════════════════════════════════════
header('STEP 2: URL Extraction from Text');

const testMessages = [
  {
    name: 'Simple amazon.in product link',
    text: 'Check this out! https://www.amazon.in/dp/B0CHX1W1XY Grab it now!',
    expectedUrls: ['https://www.amazon.in/dp/B0CHX1W1XY'],
  },
  {
    name: 'amzn.to short link',
    text: '🔥 Hot deal! https://amzn.to/3xYz123 Limited time!',
    expectedUrls: ['https://amzn.to/3xYz123'],
  },
  {
    name: 'amazon.com link',
    text: 'Buy now: https://www.amazon.com/dp/B09V3KXJPB?tag=test',
    expectedUrls: ['https://www.amazon.com/dp/B09V3KXJPB?tag=test'],
  },
  {
    name: 'a.co short link',
    text: 'Deal: https://a.co/d/abc1234',
    expectedUrls: ['https://a.co/d/abc1234'],
  },
  {
    name: 'dealspouch.com redirect link',
    text: 'Amazing deal! https://amaz.dealspouch.com/r/hea6',
    expectedUrls: ['https://amaz.dealspouch.com/r/hea6'],
  },
  {
    name: 'Multiple URLs (Amazon + non-Amazon)',
    text: 'Amazon: https://www.amazon.in/dp/B0CHX1W1XY\nFlipkart: https://www.flipkart.com/product-xyz',
    expectedUrls: ['https://www.amazon.in/dp/B0CHX1W1XY', 'https://www.flipkart.com/product-xyz'],
  },
  {
    name: 'URL with parentheses in path',
    text: 'Link: https://www.amazon.in/Apple-iPhone-15-(128-GB)/dp/B0CHX1W1XY',
    expectedUrls: ['https://www.amazon.in/Apple-iPhone-15-(128-GB)/dp/B0CHX1W1XY'],
  },
  {
    name: 'amzn.in link',
    text: 'Check: https://amzn.in/d/someProduct',
    expectedUrls: ['https://amzn.in/d/someProduct'],
  },
  {
    name: 'No URLs at all',
    text: 'This is just a text message with no links.',
    expectedUrls: [],
  },
  {
    name: 'URL at end with trailing period',
    text: 'Buy this now: https://www.amazon.in/dp/B0CHX1W1XY.',
    expectedUrls: ['https://www.amazon.in/dp/B0CHX1W1XY'],
  },
  {
    name: 'URL wrapped in angle brackets (common in Telegram)',
    text: 'Link: <https://www.amazon.in/dp/B0CHX1W1XY>',
    expectedUrls: [], // regex may or may not pick this up — let's see
  },
  {
    name: 'Real-world Telegram deal message format',
    text: '🔥 *LOOT DEAL* 🔥\n\n📱 Apple iPhone 15 (128 GB) - Black\n💰 ₹54,999 (MRP ₹79,900)\n🏷️ 31% OFF\n\n👉 https://www.amazon.in/dp/B0CHX1W1XY\n\n✅ Bank Offer: 10% Instant Discount\n📦 Free Delivery',
    expectedUrls: ['https://www.amazon.in/dp/B0CHX1W1XY'],
  },
];

for (const tc of testMessages) {
  const extracted = extractUrls(tc.text);
  info(`Test: "${tc.name}"`);
  info(`  Input text: "${tc.text.slice(0, 80)}${tc.text.length > 80 ? '...' : ''}"`);
  info(`  Extracted URLs: [${extracted.join(', ')}]`);
  
  if (tc.expectedUrls.length === 0) {
    assert(extracted.length === 0, `  Correctly found 0 URLs`, `  Expected 0 URLs but found ${extracted.length}: [${extracted.join(', ')}]`);
  } else {
    for (const expected of tc.expectedUrls) {
      assert(
        extracted.includes(expected),
        `  Found expected URL: ${expected}`,
        `  MISSING expected URL: ${expected} (got: [${extracted.join(', ')}])`
      );
    }
  }
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: Test Amazon URL Identification
// ═══════════════════════════════════════════════════════════════════════════════
header('STEP 3: Amazon URL Identification');

const amazonTestUrls = [
  { url: 'https://www.amazon.in/dp/B0CHX1W1XY', shouldBeAmazon: true, shouldBeDirect: true },
  { url: 'https://amazon.in/dp/B0CHX1W1XY', shouldBeAmazon: true, shouldBeDirect: true },
  { url: 'https://www.amazon.com/dp/B09V3KXJPB', shouldBeAmazon: true, shouldBeDirect: true },
  { url: 'https://amzn.to/3xYz123', shouldBeAmazon: true, shouldBeDirect: true },
  { url: 'https://amzn.in/d/someProduct', shouldBeAmazon: true, shouldBeDirect: true },
  { url: 'https://a.co/d/abc1234', shouldBeAmazon: true, shouldBeDirect: true },
  { url: 'https://amaz.dealspouch.com/r/hea6', shouldBeAmazon: true, shouldBeDirect: false },
  { url: 'https://dealspouch.com/some-deal', shouldBeAmazon: true, shouldBeDirect: false },
  { url: 'https://www.flipkart.com/product-xyz', shouldBeAmazon: false, shouldBeDirect: false },
  { url: 'https://www.myntra.com/shirt', shouldBeAmazon: false, shouldBeDirect: false },
  { url: 'https://google.com', shouldBeAmazon: false, shouldBeDirect: false },
];

for (const tc of amazonTestUrls) {
  const directResult = isDirectAmazonUrl(tc.url);
  const amazonResult = isAmazonUrl(tc.url);

  info(`URL: ${tc.url}`);
  assert(
    directResult === tc.shouldBeDirect,
    `  isDirectAmazonUrl = ${directResult} (expected: ${tc.shouldBeDirect})`,
    `  isDirectAmazonUrl = ${directResult} but expected ${tc.shouldBeDirect}`
  );
  assert(
    amazonResult === tc.shouldBeAmazon,
    `  isAmazonUrl = ${amazonResult} (expected: ${tc.shouldBeAmazon})`,
    `  isAmazonUrl = ${amazonResult} but expected ${tc.shouldBeAmazon}`
  );
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: Test filterUrls (Amazon vs non-Amazon separation)
// ═══════════════════════════════════════════════════════════════════════════════
header('STEP 4: filterUrls — Amazon vs Non-Amazon Separation');

const mixedUrls = [
  'https://www.amazon.in/dp/B0CHX1W1XY',
  'https://www.flipkart.com/product-xyz',
  'https://amzn.to/3xYz123',
  'https://www.myntra.com/shirt',
  'https://amaz.dealspouch.com/r/hea6',
];

const { valid, blocked } = filterUrls(mixedUrls);
info(`Input URLs: [${mixedUrls.join(', ')}]`);
info(`Valid (non-Amazon): [${valid.join(', ')}]`);
info(`Blocked (Amazon): [${blocked.join(', ')}]`);

assert(blocked.includes('https://www.amazon.in/dp/B0CHX1W1XY'), 'amazon.in blocked', 'amazon.in NOT blocked');
assert(blocked.includes('https://amzn.to/3xYz123'), 'amzn.to blocked', 'amzn.to NOT blocked');
assert(blocked.includes('https://amaz.dealspouch.com/r/hea6'), 'dealspouch blocked', 'dealspouch NOT blocked');
assert(valid.includes('https://www.flipkart.com/product-xyz'), 'flipkart valid', 'flipkart NOT valid');
assert(valid.includes('https://www.myntra.com/shirt'), 'myntra valid', 'myntra NOT valid');

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: Test the TelegramBotMessageProcessor Amazon filtering logic
// ═══════════════════════════════════════════════════════════════════════════════
header('STEP 5: TelegramBotMessageProcessor Amazon URL Extraction Logic');

info('Simulating the exact logic from TelegramBotMessageProcessor.process():');
info('  const allUrls = extractUrls(text || "");');
info('  const amazonUrls = allUrls.filter(url => isAmazonUrl(url));');

const processorTests = [
  {
    name: 'Standard Amazon deal message',
    text: '🔥 LOOT DEAL 🔥\n\n📱 Apple iPhone 15 (128 GB)\n💰 ₹54,999\n\n👉 https://www.amazon.in/dp/B0CHX1W1XY\n\n✅ Bank Offer',
  },
  {
    name: 'amzn.to short link',
    text: 'Flash Sale! https://amzn.to/3xYz123',
  },
  {
    name: 'dealspouch redirect',
    text: 'Check this: https://amaz.dealspouch.com/r/hea6',
  },
  {
    name: 'Only Flipkart link (should find 0 Amazon URLs)',
    text: 'Buy: https://www.flipkart.com/product',
  },
  {
    name: 'Amazon + Flipkart mix',
    text: 'Amazon: https://amazon.in/dp/B0CHX1W1XY\nFlipkart: https://flipkart.com/product',
  },
  {
    name: 'No links at all',
    text: 'Just a plain text message',
  },
];

for (const tc of processorTests) {
  const allUrls = extractUrls(tc.text || '');
  const amazonUrls = allUrls.filter(url => isAmazonUrl(url));

  info(`Test: "${tc.name}"`);
  info(`  All URLs found: [${allUrls.join(', ')}]`);
  info(`  Amazon URLs: [${amazonUrls.join(', ')}]`);
  
  if (tc.name.includes('Only Flipkart') || tc.name.includes('No links')) {
    assert(amazonUrls.length === 0, `  Correctly found 0 Amazon URLs`, `  Expected 0 Amazon URLs but found ${amazonUrls.length}`);
  } else {
    assert(amazonUrls.length > 0, `  Found ${amazonUrls.length} Amazon URL(s) — pipeline would PROCEED`, `  Found 0 Amazon URLs — pipeline would SKIP (BUG!)`);
  }
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: Test replaceUrls
// ═══════════════════════════════════════════════════════════════════════════════
header('STEP 6: URL Replacement');

const originalText = '🔥 Deal: https://www.amazon.in/dp/B0CHX1W1XY\n🛒 Buy now!';
const replacements = new Map([
  ['https://www.amazon.in/dp/B0CHX1W1XY', 'https://amzn.to/converted-123'],
]);
const replacedText = replaceUrls(originalText, replacements);

info(`Original: "${originalText}"`);
info(`Replaced: "${replacedText}"`);
assert(
  replacedText.includes('https://amzn.to/converted-123'),
  'Replacement successful',
  'Replacement FAILED — original URL still present'
);
assert(
  !replacedText.includes('https://www.amazon.in/dp/B0CHX1W1XY'),
  'Original URL removed',
  'Original URL still present after replacement'
);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7: Test .env config for bot pipeline
// ═══════════════════════════════════════════════════════════════════════════════
header('STEP 7: Environment Config for Bot Pipeline');

const config = require('./src/config/env');

info(`telegramConversion.botUsername = "${config.telegramConversion.botUsername}"`);
info(`telegramConversion.timeoutMs = ${config.telegramConversion.timeoutMs}`);
info(`telegramConversion.maxRetries = ${config.telegramConversion.maxRetries}`);
info(`telegram.allowedChats = [${config.telegram.allowedChats.join(', ')}]`);

assert(
  config.telegramConversion.botUsername && config.telegramConversion.botUsername.length > 0,
  'TELEGRAM_CONVERSION_BOT_USERNAME is set',
  'TELEGRAM_CONVERSION_BOT_USERNAME is EMPTY — new pipeline will be skipped!'
);

assert(
  config.telegram.allowedChats.length > 0,
  `TELEGRAM_ALLOWED_CHATS has ${config.telegram.allowedChats.length} entries`,
  'TELEGRAM_ALLOWED_CHATS is EMPTY — no messages will be processed!'
);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8: Test the edge case — hidden entity URLs (MessageEntityTextUrl)
// ═══════════════════════════════════════════════════════════════════════════════
header('STEP 8: Hidden Entity URL Extraction (simulating TelegramService._handleMessage)');

info('Simulating message with hidden TextUrl entity (URL not visible in text)');

// Simulate the exact logic from TelegramService lines 260-279
let textWithHiddenUrl = '🔥 Click Here to Buy 🔥';
const mockEntities = [
  {
    className: 'MessageEntityTextUrl',
    url: 'https://www.amazon.in/dp/B0CHX1W1XY',
    offset: 2,    // "Click" starts at offset 2
    length: 18,   // "Click Here to Buy"
  },
];

// Apply the hidden URL extraction logic (same as TelegramService)
const hiddenUrlEntities = mockEntities
  .filter(e => e.className === 'MessageEntityTextUrl' && e.url && !textWithHiddenUrl.includes(e.url));

hiddenUrlEntities
  .sort((a, b) => (b.offset ?? 0) - (a.offset ?? 0))
  .forEach(entity => {
    const insertPos = (entity.offset ?? 0) + (entity.length ?? 0);
    textWithHiddenUrl = textWithHiddenUrl.slice(0, insertPos) + ' ' + entity.url + textWithHiddenUrl.slice(insertPos);
  });

info(`  Text after entity injection: "${textWithHiddenUrl}"`);

const hiddenExtracted = extractUrls(textWithHiddenUrl);
info(`  Extracted URLs: [${hiddenExtracted.join(', ')}]`);

const hiddenAmazon = hiddenExtracted.filter(url => isAmazonUrl(url));
info(`  Amazon URLs: [${hiddenAmazon.join(', ')}]`);

assert(
  hiddenAmazon.length > 0,
  'Hidden Amazon URL correctly extracted and identified',
  'Hidden Amazon URL was LOST — this is likely the bug!'
);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9: Test inline keyboard button URLs
// ═══════════════════════════════════════════════════════════════════════════════
header('STEP 9: Inline Keyboard Button URL Extraction');

info('Simulating message with Amazon URL only in inline keyboard buttons');

let textWithButtons = '🔥 Amazing Deal! Check it out! 🔥';
const mockReplyMarkup = {
  rows: [
    {
      buttons: [
        { url: 'https://www.amazon.in/dp/B0CHX1W1XY', text: '🛒 Buy Now' },
      ],
    },
  ],
};

// Apply button URL extraction logic (same as TelegramService lines 284-304)
const buttonUrls = [];
for (const row of mockReplyMarkup.rows) {
  if (!row.buttons) continue;
  for (const btn of row.buttons) {
    const btnUrl = btn.url || btn.data?.toString();
    if (btnUrl && /^https?:\/\//i.test(btnUrl) && !textWithButtons.includes(btnUrl)) {
      buttonUrls.push(btnUrl);
    }
  }
}
if (buttonUrls.length > 0) {
  textWithButtons += '\n' + buttonUrls.join('\n');
}

info(`  Text after button injection: "${textWithButtons}"`);

const buttonExtracted = extractUrls(textWithButtons);
info(`  Extracted URLs: [${buttonExtracted.join(', ')}]`);

const buttonAmazon = buttonExtracted.filter(url => isAmazonUrl(url));
info(`  Amazon URLs: [${buttonAmazon.join(', ')}]`);

assert(
  buttonAmazon.length > 0,
  'Button Amazon URL correctly extracted',
  'Button Amazon URL was LOST'
);

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
header('RESULTS SUMMARY');

console.log(`  Total tests: ${totalTests}`);
console.log(`  ${green(`Passed: ${passedTests}`)}`);
if (failedTests > 0) {
  console.log(`  ${red(`Failed: ${failedTests}`)}`);
  console.log(`\n  ${red(bold('⚠ FAILURES DETECTED — check the output above for details'))}`);
} else {
  console.log(`\n  ${green(bold('✓ All URL extraction and identification tests passed!'))}`);
  console.log(`  ${yellow('If Amazon links are still not coming through in production, the issue is likely in:')}`);
  console.log(`    ${yellow('1. TelegramBotConverter.convert() — bot not responding or returning invalid data')}`);
  console.log(`    ${yellow('2. Telegram connection — client not receiving messages from channels')}`);
  console.log(`    ${yellow('3. Dedup — URLs already marked as processed in the in-memory cache')}`);
  console.log(`    ${yellow('4. WhatsApp send — message constructed but failing to dispatch')}`);
}
console.log('');
