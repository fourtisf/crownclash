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
import { SaveConflictError, type Store } from './lib/store.js';
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
      // Fail OPEN when the limiter's own store is unreachable. @fastify/rate-limit defaults
      // this to false, which means a store error propagates as a 500 — and because the ioredis
      // client is deliberately configured `enableOfflineQueue: false`, every command during a
      // reconnect errors instantly. Left at the default, a few seconds of Redis unavailability
      // turns *every* rate-limited route (login, match start, match finish, chests, saves) into
      // a 500 and takes the whole game down.
      //
      // Rate limits are abuse control, not the anti-cheat boundary: results still come from the
      // server's own re-simulation and currency still moves only through validated actions, all
      // of which live in Postgres. Losing the limits for the length of a Redis outage costs
      // abuse resistance; refusing every request costs the service. The redis `error` handler in
      // redis.ts logs the cause, and /api/health reports the live connection state.
      skipOnError: true,
      // `statusCode` is part of the shape @fastify/rate-limit expects; the rest is our
      // `ApiError` so the client sees one error format everywhere.
      errorResponseBuilder: (_req, context): ApiError & { statusCode: number } => ({
        statusCode: 429,
        error: API_ERRORS.rateLimited,
        message: `too many requests; retry in ${Math.ceil(context.ttl / 1000)}s`,
        retryAfter: Math.ceil(context.ttl / 1000),
      }),
    });
  }

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err);
    // A save write that lost its compare-and-set four times running (see `mutateSave`). That is
    // a live conflict on one player's save, not a server fault, and the client can simply retry
    // — so it must not be reported as a 500.
    if (err instanceof SaveConflictError) {
      return reply
        .status(409)
        .send({ error: SERVER_ERRORS.saveConflict, message: 'save changed concurrently; retry' } satisfies ApiError);
    }
    // @fastify/rate-limit *throws* its response body once a custom error handler exists, so
    // without this branch every 429 would be reported to the client as a 500 and no client
    // could back off correctly.
    const limited = err as unknown as Partial<ApiError>;
    if (limited.error === API_ERRORS.rateLimited) {
      return reply
        .status(429)
        .send({ error: API_ERRORS.rateLimited, message: limited.message, retryAfter: limited.retryAfter } satisfies ApiError);
    }
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
    // `redis` above says which implementation was *configured*; this says whether it is
    // actually connected. Without it a Redis that is configured but down looks identical to a
    // healthy one, while rate limiting silently degrades (`skipOnError` above).
    redisStatus: redis.raw ? redis.raw.status : 'memory-fallback',
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
