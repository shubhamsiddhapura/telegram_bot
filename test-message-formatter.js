'use strict';

/**
 * test-message-formatter.js
 *
 * Quick test script to verify the MessageFormatter produces
 * clean, consistent output for various Telegram message formats.
 *
 * Run: node test-message-formatter.js
 */

const { formatDealMessage } = require('./src/utils/MessageFormatter');

// ─── Test cases based on actual log data ─────────────────────────────────────

const testCases = [
  {
    name: 'Simple Flipkart deal',
    input: 'Rs.1,700: https://fktr.in/2dz8TcE',
    desc: 'Single price + link message',
  },
  {
    name: 'Flipkart multi-link deal',
    input: '#Grab \n\nRs.709: https://fktr.in/ld6y7l5\n\nRs.609: https://fktr.in/hkElfWz',
    desc: 'Channel hashtag with multiple price+link combos',
  },
  {
    name: 'AJIO deal with bold markers',
    input: '#AJIO \n**\nADIDAS ORIGINALS **Sneakers - Upto 71% Off 🔥\n\nhttps://fktr.in/somelink',
    desc: 'Telegram bold markers and hashtag prefix',
  },
  {
    name: 'Detailed product deal',
    input: '71% Off: Vaseline Deep Moisture Body Lotion, 600 ml \n\nat Rs.205 🔥\n\n**Apply 5% Off coupon**\n\nLink: https://fktr.in/converted123',
    desc: 'Full deal with discount, product name, price, coupon, and link',
  },
  {
    name: 'Flipkart loot deal',
    input: 'Flipkart Loot : OPPO Reno14, K13TurboPro & K13Turbo\n\nhttps://fktr.in/link1\nhttps://fktr.in/link2\nhttps://fktr.in/link3',
    desc: 'Multiple product links',
  },
  {
    name: 'Personal care deal',
    input: 'Personal Care Products - Upto 70% off\n\nhttps://fktr.in/carelink',
    desc: 'Simple title + link',
  },
  {
    name: 'Loot prefix deal',
    input: 'Loot:\n\nSebamed Baby Body Lotion, 400 ml \n\nat Rs.630 🔥\n\nLink: https://fktr.in/looted',
    desc: 'Message starting with "Loot:" prefix',
  },
  {
    name: 'Emoji-heavy deal',
    input: '🔥 💥 ⚡ Big Sale Alert ⚡ 💥 🔥\n\nFlat 50% Off on Electronics\n\n🛒 https://fktr.in/bigsale',
    desc: 'Heavy emoji usage',
  },
  {
    name: 'No title — just price and link',
    input: 'at Rs.436 🔥\n\nLink: https://fktr.in/backpack',
    desc: 'Message with no clear product title',
  },
  {
    name: 'Raw JSON that used to leak (bug scenario)',
    input: '{"success":1,"data":"Rs.1,700: https://fktr.in/2dz8TcE","randomPostID":"s8O99U"}',
    desc: 'This should NOT happen anymore after the EarnKaro fix, but just in case',
  },
  {
    name: 'Myntra Fragrances Trio (User Reported Issue)',
    input: `Myntra | Luxury Men's Fragrances Trio
Perfect for premium long-lasting scents from iconic brands with up to 75% off.

JAGUAR Men Classic Black Eau De Toilette (100 ml) 🏷️ Discount: 70% OFF
🔗 Product Link: https://myntr.in/M9hJFn

Nautica Men Voyage Eau De Toilette (100 ml) 🏷️ Discount: 70% OFF
🔗 Product Link: https://myntr.in/dZNc5J

JAGUAR Men Classic Eau De Toilette (100 ml) 🏷️ Discount: 75% OFF
🔗 Product Link: https://myntr.in/PWEv09`,
    desc: 'Multi-link product list with titles and inline URLs',
  }
];

// ─── Run tests ───────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════');
console.log('  MessageFormatter Test Suite');
console.log('═══════════════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  console.log(`── Test: ${tc.name} ──`);
  console.log(`   (${tc.desc})\n`);
  console.log('   INPUT:');
  console.log('   ' + tc.input.split('\n').join('\n   '));
  console.log('');

  try {
    const result = formatDealMessage(tc.input);
    console.log('   OUTPUT:');
    console.log('   ' + result.split('\n').join('\n   '));
    console.log('');

    // Basic validations
    const checks = [];

    // Extract urls to see count
    const URL_REGEX = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;
    const inputUrls = tc.input.match(URL_REGEX) || [];
    const uniqueInputUrls = [...new Set(inputUrls)];
    const inputHasUrl = uniqueInputUrls.length > 0;
    const outputHasUrl = /https?:\/\//.test(result);

    // Must contain at least one URL (if input had URLs)
    if (inputHasUrl && !outputHasUrl) {
      checks.push('❌ FAIL: URL was lost in formatting!');
    }

    // Must not contain raw JSON
    if (result.includes('"success"') || result.includes('"data"')) {
      checks.push('❌ FAIL: Raw JSON detected in output!');
    }

    // Must have the Buy Now section for single URL deals
    if (inputHasUrl && uniqueInputUrls.length === 1 && !result.includes('🛒')) {
      checks.push('❌ FAIL: Missing Buy Now section');
    }

    // Must have the fire emoji header (if there were URLs)
    if (inputHasUrl && !result.includes('🔥')) {
      checks.push('❌ FAIL: Missing deal header');
    }

    if (checks.length === 0) {
      console.log('   ✅ PASSED');
      passed++;
    } else {
      checks.forEach((c) => console.log(`   ${c}`));
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ ERROR: ${err.message}`);
    failed++;
  }

  console.log('');
  console.log('───────────────────────────────────────────────────────────\n');
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${testCases.length} total`);
console.log('═══════════════════════════════════════════════════════════');

process.exit(failed > 0 ? 1 : 0);
