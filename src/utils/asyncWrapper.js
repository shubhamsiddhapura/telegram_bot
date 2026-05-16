'use strict';

/**
 * utils/asyncWrapper.js
 *
 * Utility functions:
 *  - asyncHandler  : wraps Express route handlers to forward async errors
 *  - withRetry     : generic retry wrapper with exponential backoff
 *  - sleep         : promisified setTimeout
 */

const logger = require('./logger');
const { RETRY_DELAYS_MS } = require('../constants');

// ─── Express async wrapper ───────────────────────────────────────────────────

/**
 * Wraps an async Express route handler so unhandled rejections are
 * automatically forwarded to Express's next(err) error pipeline.
 *
 * @param {Function} fn  async (req, res, next) => {}
 * @returns {Function}
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ─── Sleep ───────────────────────────────────────────────────────────────────

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Retry wrapper ───────────────────────────────────────────────────────────

/**
 * Executes an async function with automatic retries on failure.
 *
 * @param {Function} fn              — async function to execute
 * @param {object}   opts
 * @param {number}   opts.maxRetries — max attempts (default 3)
 * @param {number[]} opts.delays     — array of delays between retries in ms
 * @param {string}   opts.label      — human-readable label for logging
 * @param {Function} opts.shouldRetry — predicate(err) => bool; defaults to always true
 * @returns {Promise<*>}
 */
const withRetry = async (
  fn,
  {
    maxRetries = 3,
    delays = RETRY_DELAYS_MS,
    label = 'operation',
    shouldRetry = () => true,
  } = {},
) => {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!shouldRetry(err) || attempt === maxRetries) {
        logger.error(`[withRetry] ${label} failed after ${attempt} attempt(s)`, {
          error: err.message,
        });
        throw err;
      }

      const delay = delays[attempt - 1] ?? delays[delays.length - 1];
      logger.warn(`[withRetry] ${label} attempt ${attempt} failed; retrying in ${delay}ms`, {
        error: err.message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
};

module.exports = { asyncHandler, withRetry, sleep };
