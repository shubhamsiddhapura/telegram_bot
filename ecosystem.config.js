// ecosystem.config.js — PM2 process manager configuration
// Run: pm2 start ecosystem.config.js
// Monitor: pm2 monit
// Logs: pm2 logs telegram-affiliate-bot

module.exports = {
  apps: [
    {
      name: 'telegram-affiliate-bot',
      script: './src/server.js',
      instances: 1,           // Single instance — Telegram client is stateful
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,

      // Restart policy
      autorestart: true,
      restart_delay: 5000,     // Wait 5s before restarting
      max_restarts: 10,
      min_uptime: '30s',

      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 15000,
      shutdown_with_message: true,
    },
  ],
};
