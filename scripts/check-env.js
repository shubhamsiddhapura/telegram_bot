require('dotenv').config();

const requiredKeys = [
  'TELEGRAM_API_ID',
  'TELEGRAM_API_HASH',
  'TELEGRAM_STRING_SESSION',
  'EARNKARO_API_TOKEN',
  'WHATSAPP_TARGET_GROUP'
];

console.log('--- Environment Check ---');
const availableKeys = Object.keys(process.env).filter(k => !k.startsWith('npm_') && !k.startsWith('NODE_'));
console.log(`Available Keys: ${availableKeys.join(', ')}`);

const missing = [];
requiredKeys.forEach(key => {
  const val = process.env[key];
  if (!val || val.trim() === '' || val.trim() === '""' || val.trim() === "''") {
    missing.push(key);
  }
});

if (missing.length > 0) {
  console.error(`ERROR: The following required variables are MISSING or EMPTY: ${missing.join(', ')}`);
  console.error('Please add them in your Railway/Render dashboard.');
  process.exit(1); // Stop the build
} else {
  console.log('✅ All required variables found!');
  process.exit(0);
}
