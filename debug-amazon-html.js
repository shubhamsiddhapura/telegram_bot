'use strict';

const axios = require('axios');

const SCRAPER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

const fs = require('fs');
const path = require('path');

async function check() {
  try {
    const htmlPath = path.join(__dirname, 'amazon-browse.html');
    if (!fs.existsSync(htmlPath)) {
      console.log('File does not exist!');
      return;
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    const imgUrls = html.match(/https?:\/\/[\w\-\.]+(?:amazon-adj|media-amazon|ssl-images-amazon)[\w\-\.\/%\?=\&\+~#\!]*?\.(?:jpg|jpeg|png|webp)/gi) || [];
    const uniqueImgUrls = [...new Set(imgUrls)];
    console.log('Total matches:', imgUrls.length);
    console.log('Unique matches:', uniqueImgUrls.length);
    console.log('Unique list of image URLs:');
    uniqueImgUrls.forEach((u, i) => {
      console.log(`${i + 1}: ${u}`);
    });
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

check();
