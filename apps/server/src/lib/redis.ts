/**
 * Redis access, with a working in-memory fallback.
 *
 * Redis is used for three things: the leaderboard cache, the rate-limit store, and the
 * worker's job stream / Phase-2 matchmaking sorted set. None of those are correctness-
 * critical for a single API process, so when `REDIS_URL` is unset the server transparently
 * runs an in-process implementation of the same handful of commands and logs that it did.
 * `pnpm dev` then works on a laptop with nothing installed but Postgres.
 *
 * The fallback is honest about its limits — it is per-process, so it is fine for one dev
 * machine and wrong for two PM2 instances. Production sets `REDIS_URL`.
 *
 * Only the commands the server actually issues are wrapped. A narrow surface is what makes
 * two implementations tractable; anything wider would drift.
 */
import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

export interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<number>;

  /* sorted sets — Phase 2 matchmaking (ws.ts) */
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrangebyscore(key: string, min: number, max: number): Promise<string[]>;
  zcard(key: string): Promise<number>;

  /* streams — the worker's job queue */
  xadd(stream: string, fields: Record<string, string>): Promise<string>;
  xgroupCreate(stream: string, group: string): Promise<void>;
  xreadgroup(stream: string, group: string, consumer: string, count: number, blockMs: number): Promise<StreamEntry[]>;
  xack(stream: string, group: string, ...ids: string[]): Promise<number>;
  xlen(stream: string): Promise<number>;
}

export interface RedisBridge {
  client: RedisLike;
  /**
   * The live ioredis instance, or null on the fallback. `@fastify/rate-limit` wants the real
   * driver — it issues Lua, which the fallback deliberately does not pretend to support.
   */
  raw: Redis | null;
  isFallback: boolean;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ real redis */

class IoRedisClient implements RedisLike {
  constructor(private readonly r: Redis) {}

  get(key: string): Promise<string | null> {
    return this.r.get(key);
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.r.setex(key, ttlSeconds, value);
  }

  del(...keys: string[]): Promise<number> {
    return keys.length ? this.r.del(...keys) : Promise.resolve(0);
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.r.zadd(key, score, member);
  }

  zrem(key: string, ...members: string[]): Promise<number> {
    return members.length ? this.r.zrem(key, ...members) : Promise.resolve(0);
  }

  zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    return this.r.zrangebyscore(key, min, max);
  }

  zcard(key: string): Promise<number> {
    return this.r.zcard(key);
  }

  async xadd(stream: string, fields: Record<string, string>): Promise<string> {
    const flat: string[] = [];
    for (const [k, v] of Object.entries(fields)) flat.push(k, v);
    const id = await this.r.xadd(stream, '*', ...flat);
    return id ?? '';
  }

  async xgroupCreate(stream: string, group: string): Promise<void> {
    try {
      // MKSTREAM so the worker can start before the API has ever enqueued anything.
      await this.r.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    } catch (err) {
      // BUSYGROUP simply means a previous boot already created it.
      if (!String((err as Error).message).includes('BUSYGROUP')) throw err;
    }
  }

  async xreadgroup(
    stream: string,
    group: string,
    consumer: string,
    count: number,
    blockMs: number,
  ): Promise<StreamEntry[]> {
    const res = (await this.r.xreadgroup(
      'GROUP', group, consumer, 'COUNT', String(count), 'BLOCK', String(blockMs), 'STREAMS', stream, '>',
    )) as [string, [string, string[]][]][] | null;
    if (!res) return [];
    const out: StreamEntry[] = [];
    for (const [, entries] of res) {
      for (const [id, flat] of entries) {
        const fields: Record<string, string> = {};
        for (let i = 0; i + 1 < flat.length; i += 2) fields[flat[i]] = flat[i + 1];
        out.push({ id, fields });
      }
    }
    return out;
  }

  xack(stream: string, group: string, ...ids: string[]): Promise<number> {
    return ids.length ? this.r.xack(stream, group, ...ids) : Promise.resolve(0);
  }

  xlen(stream: string): Promise<number> {
    return this.r.xlen(stream);
  }
}

/* --------------------------------------------------------------- memory fallback */

interface MemStream {
  entries: StreamEntry[];
  seq: number;
  groups: Map<string, { cursor: number; pending: Set<string> }>;
}

export class MemoryRedis implements RedisLike {
  private kv = new Map<string, { value: string; expiresAt: number }>();
  private zsets = new Map<string, Map<string, number>>();
  private streams = new Map<string, MemStream>();

  private live(key: string): { value: string; expiresAt: number } | null {
    const rec = this.kv.get(key);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      this.kv.delete(key);
      return null;
    }
    return rec;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.kv.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      // Redis DEL is type-agnostic, so the fallback has to sweep all three namespaces or a
      // test that clears a stream would silently leave it populated.
      if (this.kv.delete(k) || this.zsets.delete(k) || this.streams.delete(k)) n++;
    }
    return n;
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    let z = this.zsets.get(key);
    if (!z) this.zsets.set(key, (z = new Map()));
    z.set(member, score);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    let n = 0;
    for (const m of members) if (z.delete(m)) n++;
    return n;
  }

  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    const z = this.zsets.get(key);
    if (!z) return [];
    return [...z.entries()]
      .filter(([, s]) => s >= min && s <= max)
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
      .map(([m]) => m);
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  private stream(name: string): MemStream {
    let s = this.streams.get(name);
    if (!s) this.streams.set(name, (s = { entries: [], seq: 0, groups: new Map() }));
    return s;
  }

  async xadd(stream: string, fields: Record<string, string>): Promise<string> {
    const s = this.stream(stream);
    const id = `${Date.now()}-${s.seq++}`;
    s.entries.push({ id, fields });
    // Unbounded growth in a long-lived dev process is a leak, not a feature. Redis proper is
    // capped by ops policy; here we keep the last 10k and drop the tail.
    if (s.entries.length > 10_000) {
      const dropped = s.entries.length - 10_000;
      s.entries.splice(0, dropped);
      for (const g of s.groups.values()) g.cursor = Math.max(0, g.cursor - dropped);
    }
    return id;
  }

  async xgroupCreate(stream: string, group: string): Promise<void> {
    const s = this.stream(stream);
    if (!s.groups.has(group)) s.groups.set(group, { cursor: 0, pending: new Set() });
  }

  /**
   * `blockMs` is ignored: the fallback has no other process to wait on, and the worker
   * already paces itself between ticks. Returning immediately keeps the dev loop responsive.
   */
  async xreadgroup(
    stream: string,
    group: string,
    _consumer: string,
    count: number,
    _blockMs = 0,
  ): Promise<StreamEntry[]> {
    const s = this.stream(stream);
    let g = s.groups.get(group);
    if (!g) s.groups.set(group, (g = { cursor: 0, pending: new Set() }));
    const out = s.entries.slice(g.cursor, g.cursor + count);
    g.cursor += out.length;
    for (const e of out) g.pending.add(e.id);
    return out;
  }

  async xack(stream: string, group: string, ...ids: string[]): Promise<number> {
    const g = this.streams.get(stream)?.groups.get(group);
    if (!g) return 0;
    let n = 0;
    for (const id of ids) if (g.pending.delete(id)) n++;
    return n;
  }

  async xlen(stream: string): Promise<number> {
    return this.streams.get(stream)?.entries.length ?? 0;
  }
}

/* ------------------------------------------------------------------- factory */

export function createRedis(url: string | undefined = env.REDIS_URL): RedisBridge {
  if (!url) {
    if (env.NODE_ENV === 'production') {
      logger.warn('REDIS_URL is unset in production — falling back to per-process memory. Rate limits and the leaderboard cache will not be shared between PM2 instances.');
    } else {
      logger.info('REDIS_URL unset — using the in-memory Redis fallback');
    }
    const client = new MemoryRedis();
    return { client, raw: null, isFallback: true, close: async () => undefined };
  }

  const raw = new Redis(url, {
    // Fail a command rather than queue it forever when the connection is down: a stalled
    // leaderboard read must not hold an HTTP request open.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  raw.on('error', (err) => logger.error({ err: err.message }, 'redis error'));
  raw.on('connect', () => logger.info('redis connected'));

  return {
    client: new IoRedisClient(raw),
    raw,
    isFallback: false,
    close: async () => {
      await raw.quit().catch(() => undefined);
    },
  };
}

/* --------------------------------------------------------------------- keys */

export const RKEY = {
  leaderboard: 'cc:lb:top100',
  /** Stream of finished matches awaiting the worker's audit re-simulation. */
  resimStream: 'cc:stream:resim',
  resimGroup: 'cc:group:resim',
  /** Phase 2: sorted set of queued players, scored by trophies. */
  matchmaking: 'cc:mm:queue',
} as const;
