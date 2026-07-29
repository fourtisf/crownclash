/**
 * Leaderboard — top 100 by trophies, plus the caller's own rank.
 *
 * Two reads, both cheap: the top-100 slice is an index scan on `Save.trophies desc` cached in
 * Redis for `LEADERBOARD_TTL_SEC`, and the caller's rank is a single `COUNT(*) WHERE trophies
 * > mine`. Rank is computed live rather than cached because it is the one number a player
 * checks immediately after a match, and a stale rank reads as a lost win.
 *
 * The cache is also written by the worker on its own cadence, so a cold key never lands on a
 * player's request — the worker refreshed it seconds ago.
 *
 * Unauthenticated callers get the board without a `me` row; the standings are public.
 */
import type { FastifyInstance } from 'fastify';
import type { LeaderboardEntry, LeaderboardResponse } from '@crown/shared';
import { env } from '../lib/env.js';
import { LIMITS, limit } from '../lib/ratelimit.js';
import { RKEY } from '../lib/redis.js';
import type { RedisLike } from '../lib/redis.js';
import type { Store } from '../lib/store.js';

export const LEADERBOARD_SIZE = 100;

interface CachedRow {
  userId: string;
  name: string;
  avatar: string;
  trophies: number;
  best: number;
}

/**
 * Reads the cached top-N, recomputing and re-caching on a miss. Shared with the worker so the
 * refresh path and the request path cannot disagree about the shape of the cached value.
 */
export async function topRows(store: Store, redis: RedisLike, opts: { refresh?: boolean } = {}): Promise<CachedRow[]> {
  if (!opts.refresh) {
    const cached = await redis.get(RKEY.leaderboard).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as CachedRow[];
      } catch {
        // A corrupt cache entry is not worth an error page; fall through and recompute.
      }
    }
  }
  const rows = await store.topSaves(LEADERBOARD_SIZE);
  await redis.setex(RKEY.leaderboard, env.LEADERBOARD_TTL_SEC, JSON.stringify(rows)).catch(() => undefined);
  return rows;
}

export async function leaderboardRoutes(app: FastifyInstance): Promise<void> {
  const store = app.store;

  app.get('/api/leaderboard', { config: limit(LIMITS.read) }, async (req): Promise<LeaderboardResponse> => {
    const rows = await topRows(store, app.redis.client);

    const entries: LeaderboardEntry[] = rows.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      avatar: r.avatar,
      trophies: r.trophies,
      best: r.best,
      ...(req.userId && r.userId === req.userId ? { me: true } : {}),
    }));

    let me: LeaderboardEntry | null = null;
    if (req.userId) {
      const inTop = entries.find((e) => e.me);
      if (inTop) {
        me = inTop;
      } else {
        const row = await store.getSave(req.userId);
        if (row) {
          // Ties share the boundary: everyone on N trophies gets the same rank.
          const above = await store.countAbove(row.trophies);
          me = {
            rank: above + 1,
            name: row.json.name,
            avatar: row.json.avatar,
            trophies: row.trophies,
            best: row.best,
            me: true,
          };
        }
      }
    }

    return { entries, me };
  });
}
