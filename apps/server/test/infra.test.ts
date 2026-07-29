/**
 * Infrastructure: rate limits (§5), the Redis fallback, and the Phase-2 matchmaking window.
 *
 * The rate-limit tests build their own app with limiting switched on — the rest of the suite
 * runs with it off so that hammering one endpoint in a test is not itself the thing under
 * test. The property that matters here is the *keying*: §5's limits are per user, and an
 * implementation that keyed on IP would lock out every player behind one carrier NAT while
 * these tests still passed.
 */
import { describe, expect, it, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { API_ERRORS } from '@crown/shared';
import { buildApp } from '../src/app.js';
import { MemoryRedis, RKEY } from '../src/lib/redis.js';
import { MemoryStore } from '../src/lib/store-memory.js';
import { MM_WINDOW_MAX, MM_WINDOW_MIN, matchWindow } from '../src/ws.js';
import { Agent, guest, json, memoryRedis } from './helpers.js';

let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

async function limitedApp(): Promise<FastifyInstance> {
  app = await buildApp({ store: new MemoryStore(), redis: memoryRedis(), rateLimit: true, websocket: false });
  await app.ready();
  return app;
}

describe('rate limits', () => {
  it('allows one match start per 10 seconds and reports retryAfter', async () => {
    const a = await limitedApp();
    const agent = await guest(a, 'device-rl-000001');

    expect((await agent.post('/api/match/start')).statusCode).toBe(200);

    const blocked = await agent.post('/api/match/start');
    expect(blocked.statusCode).toBe(429);
    const body = json<{ error: string; retryAfter: number }>(blocked);
    expect(body.error).toBe(API_ERRORS.rateLimited);
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(10);
  });

  it('keys per user, not per IP — one player’s burst must not block another', async () => {
    const a = await limitedApp();
    const first = await guest(a, 'device-rl-000002');
    const second = await guest(a, 'device-rl-000003');

    expect((await first.post('/api/match/start')).statusCode).toBe(200);
    expect((await first.post('/api/match/start')).statusCode).toBe(429);
    // Same source address, different session: unaffected.
    expect((await second.post('/api/match/start')).statusCode).toBe(200);
  });

  it('limits chest opens to one per 2 seconds', async () => {
    const a = await limitedApp();
    const agent = await guest(a, 'device-rl-000004');
    // The first call fails on the free-chest timer, not the limiter, but it still consumes
    // the budget — which is the point: a rejected call must not be free to retry.
    await agent.post('/api/chest/open', { source: 'free' });
    expect((await agent.post('/api/chest/open', { source: 'free' })).statusCode).toBe(429);
  });

  it('leaves reads generous enough to be usable', async () => {
    const a = await limitedApp();
    const agent = await guest(a, 'device-rl-000005');
    for (let i = 0; i < 10; i++) expect((await agent.get('/api/save')).statusCode).toBe(200);
  });
});

describe('redis fallback', () => {
  it('implements the key/value, sorted-set and stream commands the server issues', async () => {
    const r = new MemoryRedis();

    await r.setex('k', 60, 'v');
    expect(await r.get('k')).toBe('v');
    expect(await r.get('missing')).toBeNull();

    await r.setex('gone', -1, 'v');
    expect(await r.get('gone')).toBeNull(); // expired on read

    await r.zadd('z', 100, 'a');
    await r.zadd('z', 250, 'b');
    await r.zadd('z', 400, 'c');
    expect(await r.zrangebyscore('z', 90, 260)).toEqual(['a', 'b']);
    expect(await r.zcard('z')).toBe(3);
    expect(await r.zrem('z', 'a')).toBe(1);
    expect(await r.zcard('z')).toBe(2);

    await r.xgroupCreate('s', 'g');
    await r.xadd('s', { one: '1' });
    await r.xadd('s', { two: '2' });
    expect(await r.xlen('s')).toBe(2);

    const batch = await r.xreadgroup('s', 'g', 'c1', 10, 0);
    expect(batch.map((e) => e.fields)).toEqual([{ one: '1' }, { two: '2' }]);
    // A consumer group does not redeliver what it has already handed out.
    expect(await r.xreadgroup('s', 'g', 'c1', 10, 0)).toEqual([]);
    expect(await r.xack('s', 'g', batch[0].id)).toBe(1);

    // DEL is type-agnostic in Redis, and so is the fallback.
    expect(await r.del('k', 'z', 's')).toBe(3);
    expect(await r.xlen('s')).toBe(0);
  });

  it('exposes a null raw driver so the rate limiter falls back to its local store', () => {
    const bridge = memoryRedis();
    expect(bridge.raw).toBeNull();
    expect(bridge.isFallback).toBe(true);
  });

  it('namespaces every key under cc:', () => {
    for (const key of Object.values(RKEY)) expect(key.startsWith('cc:')).toBe(true);
  });
});

describe('Phase 2 matchmaking window', () => {
  it('widens ±50 → ±200 linearly over 10 seconds', () => {
    expect(matchWindow(0)).toBe(MM_WINDOW_MIN);
    expect(matchWindow(5_000)).toBe(125);
    expect(matchWindow(10_000)).toBe(MM_WINDOW_MAX);
    // Clamped, not extrapolated — a player waiting 60s does not match the whole ladder.
    expect(matchWindow(60_000)).toBe(MM_WINDOW_MAX);
    expect(matchWindow(-1)).toBe(MM_WINDOW_MIN);
  });
});

describe('Phase 2 websocket scaffold', () => {
  it('registers /ws without disturbing the HTTP API', async () => {
    // The requirement for the scaffold is that it compiles and does not destabilise the api
    // process, so this asserts exactly that: the upgrade route exists, ordinary routes still
    // answer, and shutdown stops the matchmaking interval cleanly.
    app = await buildApp({ store: new MemoryStore(), redis: memoryRedis(), rateLimit: false, websocket: true });
    await app.ready();

    expect(app.hasRoute({ method: 'GET', url: '/ws' })).toBe(true);
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);

    await app.close();
    app = null;
  });
});

describe('error shape', () => {
  it('renders unknown routes and unauthorised calls as ApiError', async () => {
    const a = await limitedApp();
    const anon = new Agent(a);

    const missing = await anon.get('/api/nope');
    expect(missing.statusCode).toBe(404);
    expect(json<{ error: string }>(missing).error).toBe('not_found');

    const unauth = await anon.get('/api/save');
    expect(unauth.statusCode).toBe(401);
    expect(json<{ error: string }>(unauth).error).toBe(API_ERRORS.unauthorized);
  });
});
