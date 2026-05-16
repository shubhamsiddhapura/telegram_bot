'use strict';

/**
 * utils/logger.js
 *
 * Structured Winston logger with:
 *  - Console (colorized in dev, JSON in prod)
 *  - Daily-rotating file transport for errors
 *  - Daily-rotating file transport for combined logs
 *  - Child logger factory for per-module context
 */

const path = require('path');
const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');

// Defer config import to avoid circular deps
const getConfig = () => {
  try {
    return require('../config/env');
  } catch {
    return { logging: { level: 'info', dir: './logs' }, isDev: true };
  }
};

const config = getConfig();

const { combine, timestamp, errors, json, colorize, printf, metadata } = format;

// ─── Custom Formats ──────────────────────────────────────────────────────────

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, module: mod, stack, ...meta }) => {
    const prefix = mod ? `[${mod}]` : '';
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} ${level} ${prefix} ${message}${extra}${stack ? `\n${stack}` : ''}`;
  }),
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
  json(),
);

// ─── Transports ──────────────────────────────────────────────────────────────

const logDir = path.resolve(config.logging.dir);

const fileTransportBase = {
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
};

const combinedFileTransport = new transports.DailyRotateFile({
  ...fileTransportBase,
  filename: path.join(logDir, 'combined-%DATE%.log'),
  level: 'info',
});

const errorFileTransport = new transports.DailyRotateFile({
  ...fileTransportBase,
  filename: path.join(logDir, 'error-%DATE%.log'),
  level: 'error',
});

const consoleTransport = new transports.Console({
  format: config.isDev ? devFormat : prodFormat,
});

// ─── Root Logger ─────────────────────────────────────────────────────────────

const logger = createLogger({
  level: config.logging.level,
  format: config.isDev ? devFormat : prodFormat,
  transports: [consoleTransport, combinedFileTransport, errorFileTransport],
  exitOnError: false,
});

// ─── Child Logger Factory ────────────────────────────────────────────────────

/**
 * Returns a child logger with module context attached to every log entry.
 * @param {string} moduleName
 * @returns {winston.Logger}
 */
logger.forModule = (moduleName) => {
  return logger.child({ module: moduleName });
};

module.exports = logger;
