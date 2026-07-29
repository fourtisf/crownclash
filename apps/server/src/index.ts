/**
 * The `api` process (PM2 app #1, handoff §3.4).
 *
 * Nothing but bootstrapping lives here: build the app, listen, and die cleanly. Shutdown is
 * explicit because PM2 reloads send SIGINT and a half-written save is the one thing this
 * server must never produce — `app.close()` drains in-flight requests before the store and
 * Redis connections are torn down by the `onClose` hook.
 */
import { buildApp } from './app.js';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'api shutting down');
    app
      .close()
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT, host: env.HOST }, 'api listening');
}

main().catch((err) => {
  logger.fatal({ err }, 'api failed to start');
  process.exit(1);
});
