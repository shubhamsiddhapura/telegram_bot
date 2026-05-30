'use strict';

/**
 * test-image-scraping.js
 *
 * Standalone test script to verify product image scraping from various e-commerce links.
 * Checks redirects, HTML fetching, meta-tag parsing, and image download.
 *
 * Run: node test-image-scraping.js
 */

const { scrapeProductImage } = require('./src/utils/imageScraper');

const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan   = (s) => `\x1b[36m${s}\x1b[0m`;
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;

async function testUrl(label, url) {
  console.log('\n' + '='.repeat(60));
  console.log(bold(cyan(`Testing: ${label}`)));
  console.log(`URL: ${url}`);
  console.log('='.repeat(60));

  const startTime = Date.now();
  const buffer = await scrapeProductImage(url);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  if (buffer && buffer.length > 0) {
    console.log(green(`✅ SUCCESS (Took ${duration}s)`));
    console.log(`   Image buffer size: ${buffer.length} bytes`);
  } else {
    console.log(red(`❌ FAILED (Took ${duration}s)`));
    console.log('   No image could be scraped / downloaded.');
  }
}

async function run() {
  console.log(bold(yellow('=== Starting Standalone Product Image Scraper Test ===')));

  // Test Case 1: Real Flipkart Product Link (EarnKaro Flow candidate)
  await testUrl(
    'Flipkart Product Link',
    'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4'
  );

  // Test Case 2: Real Amazon Product Link (ExtraPe Flow candidate)
  await testUrl(
    'Amazon Product Link',
    'https://www.amazon.in/dp/B0CHX1W1XY'
  );

  // Test Case 2b: Shortened Amazon Link (amzn.to)
  await testUrl(
    'Shortened Amazon Link (amzn.to)',
    'https://amzn.to/3PMwIIe'
  );

  // Test Case 2c: ExtraPe Converted Link (amzn-to.co)
  await testUrl(
    'ExtraPe Converted Link (amzn-to.co)',
    'https://amzn-to.co/dLFfn4'
  );

  // Test Case 3: Shortened redirect URL (e.g. Myntra/Flipkart shortener)
  // Let's use a known working redirect if possible, otherwise skip or check behavior
  await testUrl(
    'Shortened Flipkart link (redirect)',
    'https://fkrt.co/MXm1um'
  );

  console.log('\n' + bold(yellow('=== Scraper Test Finished ===')));
}

run().catch(err => {
  console.error(red(`\nFATAL: Scraper test crashed: ${err.message}`));
  console.error(err.stack);
});
