'use strict';

/**
 * middlewares/requestLogger.js
 *
 * Logs every HTTP request with method, path, status, and duration.
 */

const logger = require('../utils/logger');

const log = logger.forModule('HTTP');

const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400 ? 'warn'
      : 'info';

    log[level](`${req.method} ${req.originalUrl} ${res.statusCode} — ${duration}ms`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  });

  next();
};

module.exports = requestLogger;
