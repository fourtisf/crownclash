/** Request/instance decorators added by `app.ts`. */
import type { RedisBridge } from './lib/redis.js';
import type { Store } from './lib/store.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the global `resolveSession` hook; null for anonymous requests. */
    userId: string | null;
  }
  interface FastifyInstance {
    store: Store;
    redis: RedisBridge;
  }
}
