'use strict';

/**
 * utils/categoryClassifier.js
 *
 * Checks text or product pages for women's, girls', beauty, fashion,
 * and lifestyle keywords using case-insensitive word-boundary matching.
 */

const axios = require('axios');
const logger = require('./logger');

const log = logger.forModule('CategoryClassifier');

// User-Agent rotation list (similar to imageScraper.js to avoid blocking)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

function getRandomHeaders() {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
}

// Complete list of keywords compiled from requirements
const BEAUTY_LIFESTYLE_KEYWORDS = [
  // Fashion & Clothing
  'women', 'woman', 'ladies', 'lady', 'girls', 'girl', 'female', 'fashion',
  'clothing', 'apparel', 'outfit', 'wear', 'western wear', 'ethnic wear',
  'casual wear', 'party wear', 'formal wear', 'office wear', 'festive wear',
  'designer wear', 'luxury wear',

  // Ethnic Wear
  'saree', 'sari', 'lehenga', 'chaniya choli', 'kurti', 'kurta set',
  'salwar suit', 'salwar kameez', 'anarkali', 'dupatta', 'palazzo',
  'sharara', 'gharara', 'ethnic gown', 'ethnic dress',

  // Western Wear
  'dress', 'midi dress', 'maxi dress', 'bodycon dress', 'gown', 'top',
  'crop top', 'shirt', 'tshirt', 't-shirt', 'tank top', 'camisole',
  'jumpsuit', 'romper', 'co-ord set', 'coord set', 'skirt', 'mini skirt',
  'pencil skirt', 'jeans', 'jeggings', 'trousers', 'pants', 'shorts',
  'blazer', 'jacket', 'shrug',

  // Innerwear
  'bra', 'sports bra', 'bralette', 'lingerie', 'panty', 'panties',
  'shapewear', 'camisole', 'sleepwear', 'nightwear', 'night suit', 'nightdress',

  // Footwear
  'heels', 'sandals', 'slippers', 'flats', 'wedges', 'stilettos', 'pumps',
  'loafers', 'sneakers', 'shoes', 'boots', 'footwear',

  // Bags & Accessories
  'handbag', 'purse', 'wallet', 'sling bag', 'tote bag', 'shoulder bag',
  'clutch', 'backpack', 'jewellery', 'jewelry', 'necklace', 'pendant',
  'earrings', 'studs', 'jhumka', 'bracelet', 'bangle', 'anklet', 'ring',
  'watch', 'sunglasses', 'hairband', 'scrunchie', 'hair clip',

  // Beauty & Makeup
  'makeup', 'cosmetic', 'cosmetics', 'beauty', 'lipstick', 'lip balm',
  'lip gloss', 'lip liner', 'foundation', 'concealer', 'compact', 'powder',
  'blush', 'highlighter', 'contour', 'kajal', 'eyeliner', 'mascara',
  'eyeshadow', 'eyebrow pencil', 'primer', 'setting spray', 'makeup remover',

  // Skincare
  'skincare', 'skin care', 'face wash', 'cleanser', 'toner', 'serum',
  'moisturizer', 'sunscreen', 'face cream', 'night cream', 'day cream',
  'under eye cream', 'face mask', 'sheet mask', 'scrub', 'exfoliator',
  'facial kit', 'anti ageing', 'anti aging', 'acne care', 'pimple care',

  // Hair Care
  'hair care', 'shampoo', 'conditioner', 'hair oil', 'hair serum', 'hair mask',
  'hair spa', 'hair color', 'hair dye', 'hair straightener', 'curler', 'hair dryer',

  // Personal Care
  'personal care', 'hygiene', 'sanitary pads', 'menstrual cup', 'intimate wash',
  'body wash', 'shower gel', 'body lotion', 'body butter', 'deodorant',
  'perfume', 'fragrance', 'mist',

  // Beauty Devices
  'epilator', 'facial trimmer', 'eyebrow trimmer', 'hair remover',
  'facial steamer', 'beauty device', 'skincare device',

  // Maternity & Women's Health
  'maternity', 'pregnancy', 'nursing bra', 'feeding gown', 'feeding dress',
  'postpartum', 'baby bump support',

  // Lifestyle
  'women lifestyle', 'beauty essentials', 'self care', 'self-care', 'wellness',
  'grooming', 'feminine care'
];

// Helper to escape special regex characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles keywords into RegExp objects with word boundary checks.
 * We pre-compile regexes to maximize matching speed.
 */
const compiledRegexes = BEAUTY_LIFESTYLE_KEYWORDS.map(keyword => {
  // Use word boundaries. Since hyphens/spaces are non-word chars,
  // we carefully handle boundaries to avoid regex matching bugs.
  const escaped = escapeRegExp(keyword);
  
  // Custom boundary check: keyword should not be embedded inside larger letters
  // e.g. "wear" in "software" should fail, but "western wear" in "best western wear" should match.
  // We use lookaround-like structures to be extremely robust.
  return new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}(?:$|[^a-zA-Z0-9_])`, 'i');
});

/**
 * Checks if a string contains any of the target keywords.
 * @param {string} text
 * @returns {string|null} The matching keyword if found, otherwise null
 */
function findMatchingKeyword(text) {
  if (!text || typeof text !== 'string') return null;
  
  for (let i = 0; i < compiledRegexes.length; i++) {
    if (compiledRegexes[i].test(text)) {
      return BEAUTY_LIFESTYLE_KEYWORDS[i];
    }
  }
  return null;
}

/**
 * Strips HTML tags, comments, script blocks, and style blocks to leave only plain text.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  
  // Remove script and style elements and their content
  let text = html.replace(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi, '');
  
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  
  // Remove other HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Unescape standard HTML entities
  text = text.replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'");
             
  // Replace multiple spaces/newlines with a single space
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Fetches the HTML content of the product URL, strips HTML tags, and checks for keywords.
 * @param {string} url
 * @returns {Promise<{isMatch: boolean, keyword: string|null}>}
 */
async function checkProductPage(url) {
  try {
    const headers = getRandomHeaders();
    log.info(`Checking product page for beauty/lifestyle keywords`, { url });
    
    const response = await axios.get(url, {
      headers,
      timeout: 5000,
      maxRedirects: 3
    });
    
    const html = response.data;
    if (typeof html !== 'string') return { isMatch: false, keyword: null };
    
    // Check if CAPTCHA page
    if (html.includes('Robot Check') || html.includes('captcha')) {
      log.warn(`Blocked by CAPTCHA when scanning product page; skipping HTML checks`, { url });
      return { isMatch: false, keyword: null };
    }
    
    const cleanText = stripHtml(html);
    const matched = findMatchingKeyword(cleanText);
    
    if (matched) {
      log.info(`Keyword match found in product page HTML content!`, { url, matched });
      return { isMatch: true, keyword: matched };
    }
  } catch (err) {
    log.warn(`Failed to fetch product page HTML for categorization`, { url, error: err.message });
  }
  
  return { isMatch: false, keyword: null };
}

/**
 * Decides whether a deal should be routed to WowDeals Beauty & Lifestyle group.
 * Checks the text content first (fast-path), then falls back to product page scanning.
 * 
 * @param {object} params
 * @param {string} params.text
 * @param {string[]} params.urls
 * @returns {Promise<{shouldRoute: boolean, matchedKeyword: string|null, source: 'text'|'html'|null}>}
 */
async function shouldRouteToBeautyLifestyle({ text, urls }) {
  // 1. Check local text first (fast-path)
  const textMatch = findMatchingKeyword(text);
  if (textMatch) {
    log.info(`Category Match: Found keyword "${textMatch}" in deal text content. Routing to Beauty & Lifestyle.`);
    return { shouldRoute: true, matchedKeyword: textMatch, source: 'text' };
  }
  
  // 2. If no text match and we have URLs, scrape the first URL to check product page details
  if (urls && urls.length > 0) {
    const { isMatch, keyword } = await checkProductPage(urls[0]);
    if (isMatch) {
      return { shouldRoute: true, matchedKeyword: keyword, source: 'html' };
    }
  }
  
  return { shouldRoute: false, matchedKeyword: null, source: null };
}

module.exports = {
  BEAUTY_LIFESTYLE_KEYWORDS,
  findMatchingKeyword,
  stripHtml,
  shouldRouteToBeautyLifestyle
};
