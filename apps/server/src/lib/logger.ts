/**
 * Pino configuration, shared by the api and worker processes.
 *
 * Structured JSON in every environment — PM2 captures stdout and the VPS ships it onward, so
 * pretty-printing would only make the logs harder to grep. Redaction is not cosmetic: a
 * signature or a session cookie in a log line is a credential at rest.
 *
 * The *options* are exported rather than the instance for Fastify's benefit — passing a
 * pre-built pino instance via `loggerInstance` re-generics `FastifyInstance` over pino's
 * `Logger` type and every plugin's declaration merging then fails to line up. Handing Fastify
 * the options lets it build its own child logger with identical behaviour.
 */
import pino, { type LoggerOptions } from 'pino';
import { env } from './env.js';

export const loggerOptions: LoggerOptions = {
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
};

/** Standalone logger for code outside a request (worker, bootstrap, redis driver). */
export const logger = pino(loggerOptions);

export type Logger = typeof logger;
