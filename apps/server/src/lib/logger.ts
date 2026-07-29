/**
 * Pino logger, shared by the api and worker processes.
 *
 * Structured JSON in every environment — PM2 captures stdout and the VPS ships it onward, so
 * pretty-printing would only make the logs harder to grep. Redaction is not cosmetic: a
 * signature or a session cookie in a log line is a credential at rest.
 */
import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      'signature',
      'body.signature',
      '*.signature',
    ],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
