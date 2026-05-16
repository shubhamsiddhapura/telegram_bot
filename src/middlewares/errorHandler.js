'use strict';

/**
 * middlewares/errorHandler.js
 *
 * Centralized Express error-handling middleware.
 *
 * Responsibilities:
 *  - Catch all errors forwarded via next(err)
 *  - Log the error with context
 *  - Return a structured JSON error response
 *  - Avoid leaking stack traces in production
 */

const { HTTP_STATUS } = require('../constants');
const logger = require('../utils/logger');

const log = logger.forModule('ErrorHandler');

/**
 * Express error middleware.
 * Must have exactly 4 parameters for Express to recognise it.
 *
 * @param {Error}           err
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  const status = err.status ?? err.statusCode ?? HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const isOperational = !!err.isOperational;

  log.error('Unhandled Express error', {
    status,
    message: err.message,
    isOperational,
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  const payload = {
    success: false,
    error: {
      message: err.message || 'An unexpected error occurred',
      status,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  };

  return res.status(status).json(payload);
};

/**
 * 404 handler — placed AFTER all routes.
 */
const notFoundHandler = (req, res) => {
  log.warn('Route not found', { path: req.path, method: req.method });
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    error: { message: `Route ${req.method} ${req.path} not found`, status: 404 },
  });
};

module.exports = { errorHandler, notFoundHandler };
