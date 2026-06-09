'use strict';

/**
 * test-classifier.js
 *
 * Verification suite for the Women's, Beauty & Lifestyle Category routing system.
 * Run: node test-classifier.js
 */

require('./src/config/env');
const logger = require('./src/utils/logger');
const categoryClassifier = require('./src/utils/categoryClassifier');
const messageProcessor = require('./src/services/MessageProcessorService');
const telegramBotMessageProcessor = require('./src/services/TelegramBotMessageProcessor');
const whatsAppService = require('./src/whatsapp/WhatsAppService');
const axios = require('axios');

const log = logger.forModule('ClassifierTest');

// Color helpers for console output
const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan   = (s) => `\x1b[36m${s}\x1b[0m`;
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;

function header(title) {
  console.log('\n' + '═'.repeat(80));
  console.log(bold(cyan(`  ${title}`)));
  console.log('═'.repeat(80));
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, passMsg, failMsg) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ${green('✓')} ${passMsg}`);
  } else {
    failedTests++;
    console.log(`  ${red('✗')} ${failMsg}`);
  }
}

// Mock Axios for HTTP product page requests
let mockedHtmlResponse = '';
let mockedHtmlError = null;

jestMockAxios();

function jestMockAxios() {
  axios.get = async (url, config) => {
    if (mockedHtmlError) {
      throw mockedHtmlError;
    }
    return {
      data: mockedHtmlResponse,
      config: { url }
    };
  };
}

async function runTests() {
  // =========================================================================
  // TEST CASE 1: Exact and Case-Insensitive Keyword Matching
  // =========================================================================
  header('TEST CASE 1: Exact and Case-Insensitive Keyword Matching');

  const positiveCases = [
    { text: 'Check out this beautiful saree for party wear!', expected: 'saree' },
    { text: 'SAREE sale is on!', expected: 'saree' },
    { text: 'Ladies fashion deals', expected: 'ladies' },
    { text: 'Best kurti collection ever', expected: 'kurti' },
    { text: 'lip balm and lipstick combo', expected: 'lipstick' },
    { text: 'Anti aging serum for face skin care', expected: 'anti aging' },
    { text: 'Self-care routines for girls', expected: 'self-care' },
    { text: 'Buy a sports bra online', expected: 'sports bra' },
    { text: 'Check out these wedges and heels', expected: 'heels' },
    { text: 'Feminine care hygiene products', expected: 'feminine care' },
    { text: 'Postpartum feeding dress for maternity', expected: 'maternity' }
  ];

  for (const tc of positiveCases) {
    const matched = categoryClassifier.findMatchingKeyword(tc.text);
    assert(
      matched !== null,
      `Successfully matched: "${tc.text}" -> "${matched}"`,
      `Failed to match: "${tc.text}" (Expected: "${tc.expected}")`
    );
  }

  // =========================================================================
  // TEST CASE 2: Word Boundary Protection (No False Positives)
  // =========================================================================
  header('TEST CASE 2: Word Boundary Protection (No False Positives)');

  const negativeCases = [
    'This is a software engineering job.', // contains "wear" (as part of software)
    'We are sharing files today.',         // contains "sari" (as part of sharing)
    'spring is a beautiful season.',       // contains "ring" (as part of spring)
    'He is wearing a tuxedo.',             // contains "wear" as part of wearing (wear itself should match, but boundary prevents wearing? Wait, wearing should not match unless wear is isolated. "wear" has word boundary in regex, so "wearing" fails. Let's see: \bwear\b does not match wearing. Correct!)
    'mistake happens to everyone.',        // contains "mist" (as part of mistake)
    'This is an orange fruit.',            // does not contain any keyword
    'Intel Core i9 Processor laptop deal',  // tech deal, no matching keywords
    'Smartwatch for men'                   // contains "watch" inside "Smartwatch"? Wait! Does "Smartwatch" match "watch"? If regex is \bwatch\b, "Smartwatch" will NOT match because 'h' and 'w' are word characters, so no boundary. Correct!
  ];

  for (const text of negativeCases) {
    const matched = categoryClassifier.findMatchingKeyword(text);
    assert(
      matched === null,
      `Correctly bypassed non-matching text: "${text}"`,
      `FALSE POSITIVE: matched "${text}" to keyword "${matched}"`
    );
  }

  // =========================================================================
  // TEST CASE 3: HTML Stripping and Entities Decoding
  // =========================================================================
  header('TEST CASE 3: HTML Stripping & Entity Decoding');

  const html = `
    <html>
      <head>
        <style>.top-nav { color: red; }</style>
        <script>console.log("running top javascript");</script>
      </head>
      <body>
        <div class="product-title">Beautiful Saree &amp; Kurti Set</div>
        <p>Buy this now &nbsp; for &quot;Special price&quot;!</p>
        <!-- Comments to ignore -->
      </body>
    </html>
  `;

  const stripped = categoryClassifier.stripHtml(html);
  log.debug('Stripped HTML Output:', { stripped });

  assert(
    stripped.includes('Beautiful Saree & Kurti Set'),
    'Correctly decoded HTML entities and stripped tags',
    'HTML entity decoding or tag stripping failed'
  );
  assert(
    !stripped.includes('top-nav') && !stripped.includes('javascript'),
    'Correctly stripped style and script contents',
    'Failed to strip style or script block contents'
  );
  assert(
    categoryClassifier.findMatchingKeyword(stripped) === 'saree',
    'Successfully matched keyword in stripped HTML',
    'Failed to match keyword in stripped HTML'
  );

  // =========================================================================
  // TEST CASE 4: shouldRouteToBeautyLifestyle (Combined Local & URL tests)
  // =========================================================================
  header('TEST CASE 4: routing checks (Fast-Path and URL HTML fallbacks)');

  // 4a. Fast path (matches local text)
  const fpRes = await categoryClassifier.shouldRouteToBeautyLifestyle({
    text: 'Buy this designer kurti at 50% discount!',
    urls: []
  });
  assert(
    fpRes.shouldRoute === true && fpRes.source === 'text' && fpRes.matchedKeyword === 'kurti',
    'Fast path matched local text correctly',
    `Fast path failed: ${JSON.stringify(fpRes)}`
  );

  // 4b. Local mismatch, URL HTML match (scrapes page)
  mockedHtmlResponse = '<html><body><h1>Super Soft Cotton Nightdress</h1></body></html>';
  mockedHtmlError = null;
  const urlRes = await categoryClassifier.shouldRouteToBeautyLifestyle({
    text: 'Click here: https://amazon.in/dp/B0CHX1W1XY',
    urls: ['https://amazon.in/dp/B0CHX1W1XY']
  });
  assert(
    urlRes.shouldRoute === true && urlRes.source === 'html' && urlRes.matchedKeyword === 'nightdress',
    'Bypassed local mismatch and successfully matched keyword in URL HTML',
    `URL HTML match failed: ${JSON.stringify(urlRes)}`
  );

  // 4c. No match anywhere
  mockedHtmlResponse = '<html><body><h1>Intel i7 CPU Processor</h1></body></html>';
  const failRes = await categoryClassifier.shouldRouteToBeautyLifestyle({
    text: 'Checkout this tech deal: https://amazon.in/dp/B0CHX1234',
    urls: ['https://amazon.in/dp/B0CHX1234']
  });
  assert(
    failRes.shouldRoute === false && failRes.source === null,
    'Correctly returned false when no keywords match text or HTML',
    `Fail case failed: ${JSON.stringify(failRes)}`
  );

  // =========================================================================
  // TEST CASE 5: End-to-End Pipeline Mock Integration
  // =========================================================================
  header('TEST CASE 5: End-to-End Pipeline Mock Integration');

  // We mock WhatsAppService to intercept target JIDs
  const originalSendMessage = whatsAppService.sendMessage;
  let routedJid = null;

  whatsAppService.sendMessage = async ({ text, imageBuffer, chatId, messageId, targetJid }) => {
    routedJid = targetJid;
    return { success: true };
  };
  whatsAppService._isSleepTime = () => false;

  // 5a. Run EarnKaro messageProcessor with matching keyword
  routedJid = null;
  const beautyDeal = {
    messageId: 'test-ek-beauty-1',
    text: 'Checkout this beautiful lipstick cosmetics set!\n👉 https://www.flipkart.com/some-lipstick-link\nBuy now!',
    image: null,
    chatTitle: 'Beauty channel',
    chatId: '12345'
  };

  // We mock EarnKaroService.convertDeal to bypass API call in test
  const earnKaroService = require('./src/earnkaro/EarnKaroService');
  const originalConvert = earnKaroService.convertDeal;
  earnKaroService.convertDeal = async (text) => ({
    convertedText: text.replace('https://www.flipkart.com/some-lipstick-link', 'https://ekaro.in/converted-lipstick'),
    success: true
  });

  await messageProcessor.process(beautyDeal);
  assert(
    routedJid === '120363408116455659_beauty@g.us',
    'EarnKaro pipeline correctly routed beauty/lifestyle deal to Beauty & Lifestyle JID',
    `EarnKaro routing failed, got target JID: ${routedJid}`
  );

  // 5b. Run EarnKaro messageProcessor with generic/tech item
  routedJid = null;
  const genericDeal = {
    messageId: 'test-ek-tech-1',
    text: 'Checkout this SanDisk 128GB MicroSD card!\n👉 https://www.flipkart.com/sandisk-128gb-link\nBuy now!',
    image: null,
    chatTitle: 'Tech channel',
    chatId: '12345'
  };
  earnKaroService.convertDeal = async (text) => ({
    convertedText: text.replace('https://www.flipkart.com/sandisk-128gb-link', 'https://ekaro.in/converted-sandisk'),
    success: true
  });

  await messageProcessor.process(genericDeal);
  assert(
    routedJid === undefined || routedJid === null,
    'EarnKaro pipeline correctly routed generic deal to Default JID',
    `EarnKaro generic routing failed, got target JID: ${routedJid}`
  );

  // Restore EarnKaroService
  earnKaroService.convertDeal = originalConvert;

  // 5c. Run TelegramBotMessageProcessor (Amazon pipeline) with matching keyword
  routedJid = null;
  const amazonBeautyDeal = {
    messageId: 'test-tg-beauty-1',
    text: 'Checkout this body wash personal care item!\n👉 https://www.amazon.in/dp/B0CHX1W1XY\nBuy now!',
    image: null,
    chatTitle: 'Amazon deals',
    chatId: '12345'
  };

  // Mock bot converter
  const telegramBotConverter = require('./src/telegram/TelegramBotConverter');
  const originalConverterConvert = telegramBotConverter.convert;
  telegramBotConverter.convert = async (url) => 'Converted: https://amzn-to.co/dLFfn4';

  // We need to bypass deduplication check for test
  const dedup = require('./src/helpers/dedup');
  const originalIsMessageDuplicate = dedup.isMessageDuplicate;
  const originalDeduplicateUrls = dedup.deduplicateUrls;
  dedup.isMessageDuplicate = async () => false;
  dedup.deduplicateUrls = async (urls) => urls;

  await telegramBotMessageProcessor.process(amazonBeautyDeal);
  assert(
    routedJid === '120363408116455659_beauty@g.us',
    'Telegram Bot pipeline correctly routed beauty/lifestyle deal to Beauty & Lifestyle JID',
    `Telegram Bot routing failed, got JID: ${routedJid}`
  );

  // Restore mocks
  whatsAppService.sendMessage = originalSendMessage;
  telegramBotConverter.convert = originalConverterConvert;
  dedup.isMessageDuplicate = originalIsMessageDuplicate;
  dedup.deduplicateUrls = originalDeduplicateUrls;

  // =========================================================================
  // RESULTS SUMMARY
  // =========================================================================
  header('TESTS RUN COMPLETED');
  console.log(`  Total tests executed: ${totalTests}`);
  console.log(`  Passed: ${green(passedTests)}`);
  if (failedTests > 0) {
    console.log(`  Failed: ${red(failedTests)}`);
    process.exit(1);
  } else {
    console.log(`  ${green(bold('All tests passed successfully!'))}`);
    process.exit(0);
  }
}

runTests().catch(err => {
  log.error('Test execution crashed', { error: err.message, stack: err.stack });
  process.exit(1);
});
