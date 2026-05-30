'use strict';

const axios = require('axios');
const logger = require('./logger');

const log = logger.forModule('ImageScraper');

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

/**
 * Follows redirects and fetches the HTML content of the page,
 * then parses og:image and twitter:image tags to find the product image URL.
 * Finally downloads the image as a Buffer.
 *
 * @param {string} url
 * @returns {Promise<Buffer|null>}
 */
async function scrapeProductImage(url) {
  if (!url) return null;

  let attempt = 1;
  const maxAttempts = 2;

  while (attempt <= maxAttempts) {
    try {
      const headers = getRandomHeaders();
      log.info(`Scraping product image from URL (Attempt ${attempt}/${maxAttempts})`, { url });

      // 1. Fetch the HTML content
      const response = await axios.get(url, {
        headers,
        timeout: 10000,
        maxRedirects: 5,
      });

      const html = response.data;
      if (typeof html !== 'string') {
        log.warn('Response data is not a string, skipping image scrape', { url });
        return null;
      }

      // Check if blocked by Amazon CAPTCHA
      if (
        html.includes('Robot Check') ||
        html.includes('captcha') ||
        html.includes('api-services-support@amazon.com')
      ) {
        log.warn('Amazon scraping blocked by CAPTCHA page', { url, attempt });
        if (attempt < maxAttempts) {
          attempt++;
          // Pause slightly before retry
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        return null;
      }

      // 2. Extract image URL from meta tags using regex
    let imageUrl = null;

    const ogImageRegexes = [
      /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
      /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i
    ];
    for (const r of ogImageRegexes) {
      const match = html.match(r);
      if (match && match[1]) {
        imageUrl = match[1];
        log.debug('Found og:image URL', { imageUrl });
        break;
      }
    }

    if (!imageUrl) {
      const twitterImageRegexes = [
        /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
        /<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["']/i
      ];
      for (const r of twitterImageRegexes) {
        const match = html.match(r);
        if (match && match[1]) {
          imageUrl = match[1];
          log.debug('Found twitter:image URL', { imageUrl });
          break;
        }
      }
    }

    if (!imageUrl) {
      const linkImageRegex = /<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i;
      const match = html.match(linkImageRegex);
      if (match && match[1]) {
        imageUrl = match[1];
        log.debug('Found link image_src URL', { imageUrl });
      }
    }

    // ─── Amazon specific main product image patterns ────────────────────────
    if (!imageUrl) {
      // 1. Try to find landingImage tag with data-old-hires, src, or data-a-dynamic-image
      const landingImageTagMatch = html.match(/<img[^>]+id=["']landingImage["'][^>]*>/i) ||
                                   html.match(/<img[^>]+data-a-image-name=["']landingImage["'][^>]*>/i);
      if (landingImageTagMatch) {
        const tagHtml = landingImageTagMatch[0];

        // (A) Try parsing data-a-dynamic-image JSON dictionary
        const dynamicImageMatch = tagHtml.match(/data-a-dynamic-image=["']([^"']+)["']/i);
        if (dynamicImageMatch) {
          try {
            const rawJson = dynamicImageMatch[1].replace(/&quot;/g, '"');
            const parsed = JSON.parse(rawJson);
            const urls = Object.keys(parsed);
            if (urls.length > 0) {
              imageUrl = urls[urls.length - 1]; // Pick the largest/last URL
              log.debug('Found Amazon dynamic image URL', { imageUrl });
            }
          } catch (e) {
            // Ignore parse errors
          }
        }

        if (!imageUrl) {
          const hiresMatch = tagHtml.match(/data-old-hires=["']([^"']+)["']/i);
          const srcMatch = tagHtml.match(/src=["']([^"']+)["']/i);
          imageUrl = (hiresMatch && hiresMatch[1]) || (srcMatch && srcMatch[1]);
          if (imageUrl) {
            log.debug('Found Amazon landingImage URL', { imageUrl });
          }
        }
      }
    }

    if (!imageUrl) {
      // 2. Try to parse colorImages block
      const colorImagesMatch = html.match(/["']colorImages["']\s*:\s*([^;]+)/i);
      if (colorImagesMatch) {
        const firstHiRes = colorImagesMatch[1].match(/"hiRes"\s*:\s*"([^"]+)"/i);
        if (firstHiRes && firstHiRes[1]) {
          imageUrl = firstHiRes[1];
          log.debug('Found Amazon colorImages hiRes URL', { imageUrl });
        }
      }
    }

    if (!imageUrl) {
      log.info('No product image URL found in HTML meta tags or Amazon selectors', { url });
      return null;
    }

    // Unescape HTML entities in the URL if any (e.g. &amp;)
    imageUrl = imageUrl.replace(/&amp;/g, '&');

    // Make sure it is an absolute URL
    if (imageUrl.startsWith('//')) {
      imageUrl = 'https:' + imageUrl;
    } else if (imageUrl.startsWith('/')) {
      const parsedUrl = new URL(response.config.url || url);
      imageUrl = parsedUrl.origin + imageUrl;
    }

    log.info('Downloading product image', { imageUrl });

      // 3. Download the image
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': headers['User-Agent'],
        },
        timeout: 8000,
      });

      const buffer = Buffer.from(imageResponse.data, 'binary');
      if (buffer.length > 0) {
        log.info('Product image downloaded successfully', { size: buffer.length });
        return buffer;
      }

      log.warn('Downloaded image buffer is empty', { imageUrl });
      return null;
    } catch (err) {
      log.warn('Failed to scrape product image from URL', { url, error: err.message });
      if (attempt < maxAttempts) {
        attempt++;
        // Pause slightly before retry
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      return null;
    }
  }
  return null;
}

module.exports = { scrapeProductImage };
