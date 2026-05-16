'use strict';

/**
 * app.js
 *
 * Express application factory.
 * Creates and configures the Express app without starting the HTTP server.
 * This separation enables clean testing (import app without binding to a port).
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const routes = require('./routes');
const requestLogger = require('./middlewares/requestLogger');
const { apiLimiter } = require('./middlewares/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');

const createApp = () => {
  const app = express();

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(helmet());

  // ── CORS ──────────────────────────────────────────────────────────────────
  app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ── Compression ───────────────────────────────────────────────────────────
  app.use(compression());

  // ── Request logging ───────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── Global rate limiter ───────────────────────────────────────────────────
  app.use('/api', apiLimiter);

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use('/api', routes);

  // Convenience aliases at root
  // Health check for uptime monitors (HetrixTools / UptimeRobot)
  const healthController = require('./controllers/healthController');
  app.get('/health', healthController.health);

  // ── 404 ───────────────────────────────────────────────────────────────────
  app.use(notFoundHandler);

  // ── Error handler (must be last) ──────────────────────────────────────────
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
