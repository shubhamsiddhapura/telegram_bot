'use strict';

/**
 * middlewares/rateLimiter.js
 *
 * Express rate-limiting middleware.
 * Applied globally or per-route as needed.
 */

const rateLimit = require('express-rate-limit');
const { HTTP_STATUS } = require('../constants');

/**
 * General API rate limiter: 100 requests per 15 minutes per IP.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Too many requests — please try again later.',
      status: HTTP_STATUS.TOO_MANY_REQUESTS,
    },
  },
});

/**
 * Strict limiter for webhook endpoints: 30 req / 15 min.
 */
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: 'Too many webhook calls.', status: HTTP_STATUS.TOO_MANY_REQUESTS },
  },
});

module.exports = { apiLimiter, webhookLimiter };
