/**
 * E2E server bootstrap.
 *
 * Starts the real Fastify app with the in-memory store instead of Postgres. Every route,
 * every validator and the whole re-simulation path are the production ones — only the
 * persistence adapter differs, which is exactly the seam apps/server/src/lib/store.ts exists
 * to provide.
 *
 * Pointing the E2E suite at a real database would mean it needs one provisioned in CI, and a
 * suite that cannot run catches nothing. Database-backed behaviour (migrations, indexes,
 * concurrent claims) is covered by apps/server/test against the Prisma store.
 *
 * Run with: node --import tsx test/e2e/server.ts
 */
import { buildApp } from '../../../server/src/app.js';
import { MemoryStore } from '../../../server/src/lib/store-memory.js';

const port = Number(process.env.PORT || 8080);
const app = await buildApp({ store: new MemoryStore() });

const shutdown = (): void => {
  app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host: '127.0.0.1' });
// Playwright waits on the port, but printing makes a failed boot obvious in CI logs.
console.log(`e2e api listening on http://127.0.0.1:${port} (in-memory store)`);
