'use strict';

/**
 * src/utils/common.js
 * 
 * Shared utility functions.
 */

/**
 * Promise-based sleep/delay.
 * @param {number} ms 
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  sleep,
};
