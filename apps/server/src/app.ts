/**
 * Fastify assembly.
 *
 * `buildApp` takes its `Store` and Redis bridge as options so the test suite can hand it
 * in-memory implementations and exercise the real HTTP stack — routes, hooks, cookies, error
 * mapping — with no Postgres and no Redis anywhere. Production passes nothing and gets the
 * Prisma store plus a real connection.
 *
 * Hook order matters and is not accidental:
 *   @fastify/cookie (parses)  →  resolveSession (sets request.userId)  →  rate limit (keys on it)
 * Registering the limiter before the session hook would key every authenticated request by IP,
 * which is exactly the failure mode §5's per-user limits exist to avoid.
 */
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { API_ERRORS, type ApiError } from '@crown/shared';
import { resolveSession } from './lib/auth.js';
import { env } from './lib/env.js';
import { HttpError, SERVER_ERRORS, sendError } from './lib/errors.js';
import { loggerOptions } from './lib/logger.js';
import { createRedis, type RedisBridge } from './lib/redis.js';
import { PrismaStore } from './lib/store-prisma.js';
import type { Store } from './lib/store.js';
import { authRoutes } from './routes/auth.js';
import { economyRoutes } from './routes/economy.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { matchRoutes } from './routes/match.js';
import { saveRoutes } from './routes/save.js';
import { registerWs } from './ws.js';

export interface BuildAppOptions {
  store?: Store;
  redis?: RedisBridge;
  /** Defaults to `RATE_LIMIT_ENABLED`. Tests turn it off so they can hammer one endpoint. */
  rateLimit?: boolean;
  /** Defaults to true. Tests skip the websocket upgrade handler. */
  websocket?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const store = opts.store ?? new PrismaStore();
  const redis = opts.redis ?? createRedis();
  const withRateLimit = opts.rateLimit ?? env.RATE_LIMIT_ENABLED;

  const app = Fastify({
    logger: loggerOptions,
    // Behind nginx/Cloudflare the socket address is the proxy; the rate limiter needs the
    // real client IP for anonymous requests.
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT_BYTES,
  });

  app.decorate('store', store);
  app.decorate('redis', redis);
  app.decorateRequest('userId', null);

  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    // The session lives in a cookie, so every request is credentialed and the allow-list must
    // be exact — `*` is illegal with credentials and browsers enforce it.
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  app.addHook('onRequest', resolveSession);

  if (withRateLimit) {
    await app.register(rateLimit, {
      // Opt-in per route: a blanket limit would throttle the leaderboard and the health check
      // alongside the expensive endpoints.
      global: false,
      // Shared across PM2 instances when Redis is real; per-process otherwise (see redis.ts).
      redis: redis.raw ?? undefined,
      keyGenerator: (req: FastifyRequest) => req.userId ?? req.ip,
      errorResponseBuilder: (_req, context): ApiError => ({
        error: API_ERRORS.rateLimited,
        message: `too many requests; retry in ${Math.ceil(context.ttl / 1000)}s`,
        retryAfter: Math.ceil(context.ttl / 1000),
      }),
    });
  }

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err);
    // Fastify's own 4xx (body too large, malformed JSON, unsupported media type).
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 400 && status < 500) {
      return reply.status(status).send({ error: SERVER_ERRORS.badRequest, message: err.message } satisfies ApiError);
    }
    req.log.error({ err }, 'unhandled route error');
    return reply.status(500).send({ error: SERVER_ERRORS.internal, message: 'internal error' } satisfies ApiError);
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(404).send({ error: 'not_found', message: `${req.method} ${req.url}` } satisfies ApiError);
  });

  app.get('/api/health', async () => ({
    ok: true,
    env: env.NODE_ENV,
    redis: redis.isFallback ? 'memory' : 'redis',
    uptime: Math.round(process.uptime()),
  }));

  await app.register(authRoutes);
  await app.register(saveRoutes);
  await app.register(matchRoutes);
  await app.register(economyRoutes);
  await app.register(leaderboardRoutes);

  if (opts.websocket ?? true) await registerWs(app);

  if (env.STATIC_DIR) {
    await app.register(fastifyStatic, { root: env.STATIC_DIR, prefix: '/' });
  }

  app.addHook('onClose', async () => {
    await store.close().catch(() => undefined);
    await redis.close().catch(() => undefined);
  });

  return app;
}
