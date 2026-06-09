'use strict';

/**
 * scripts/dev.js
 * 
 * Runs the bot backend server (nodemon) and the admin dashboard (next dev)
 * concurrently in a single terminal session.
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Bot Backend and Admin Dashboard concurrently...\n');

const projectRoot = path.resolve(__dirname, '..');

// 1. Spawn Backend Process
const backendProcess = spawn('npx', ['nodemon', 'src/server.js'], {
  stdio: 'inherit',
  shell: true,
  cwd: projectRoot,
});

// 2. Spawn Frontend Process
const frontendProcess = spawn('npm', ['run', 'dev', '--prefix', 'dashboard'], {
  stdio: 'inherit',
  shell: true,
  cwd: projectRoot,
});

// Coordinate graceful shutdowns
const shutdown = () => {
  console.log('\n🛑 Stopping all services...');
  
  try {
    if (process.platform === 'win32') {
      // On Windows, child processes spawned with shell: true may create process trees.
      // Killing the parent might leave orphaned node/nodemon tasks.
      // We can use taskkill to cleanly close them down.
      spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t'], { stdio: 'ignore' });
      spawn('taskkill', ['/pid', frontendProcess.pid, '/f', '/t'], { stdio: 'ignore' });
    } else {
      backendProcess.kill('SIGINT');
      frontendProcess.kill('SIGINT');
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

// If either process exits, shut down the other
backendProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`❌ Backend process exited with code ${code}`);
  }
  shutdown();
});

frontendProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`❌ Frontend process exited with code ${code}`);
  }
  shutdown();
});
