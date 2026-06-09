'use strict';

/**
 * scripts/message.js
 * 
 * Runs the bot backend server (nodemon) in active message forwarding mode,
 * setting START_BOT=true.
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🤖 Starting Telegram Affiliate Bot forwarding service...\n');

const projectRoot = path.resolve(__dirname, '..');

// Spawn Backend Process with START_BOT=true env variable
const botProcess = spawn('npx', ['nodemon', 'src/server.js'], {
  stdio: 'inherit',
  shell: true,
  cwd: projectRoot,
  env: {
    ...process.env,
    START_BOT: 'true'
  }
});

// Coordinate graceful shutdowns
const shutdown = () => {
  console.log('\n🛑 Stopping bot forwarding service...');
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', botProcess.pid, '/f', '/t'], { stdio: 'ignore' });
    } else {
      botProcess.kill('SIGINT');
    }
  } catch (err) {
    // Ignore cleanup errors
  }
  setTimeout(() => {
    process.exit(0);
  }, 1000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

botProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`❌ Bot forwarding service exited with code ${code}`);
  }
  shutdown();
});
