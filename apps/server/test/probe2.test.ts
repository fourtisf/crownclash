import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuthResponse, SaveState } from '@crown/shared';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/lib/store-memory.js';
import { MemoryRedis, type RedisBridge } from '../src/lib/redis.js';
import type { SavePutMeta, SaveRow, Store } from '../src/lib/store.js';
import { Agent, guest, json } from './helpers.js';

/** Redis that behaves exactly like ioredis with the connection down. */
function brokenRedis(): RedisBridge {
  const boom = () => {
    throw new Error('Stream isn’t writeable and enableOfflineQueue options is false');
  };
  const raw = {
    // @fastify/rate-limit's RedisStore calls `redis.rateLimit(...)` after defineCommand.
    defineCommand: () => undefined,
    rateLimit: (_k: unknown, _t: unknown, _m: unknown, cb: (e: Error) => void) =>
      cb(new Error('Stream isn’t writeable and enableOfflineQueue options is false')),
    call: boom,
  } as unknown as RedisBridge['raw'];
  return { client: new MemoryRedis(), raw, isFallback: false, close: async () => undefined };
}

describe('PROBE: rate limits with redis down', () => {
  it('reports what happens on a rate-limited route', async () => {
    const store = new MemoryStore();
    const app: FastifyInstance = await buildApp({
      store, redis: brokenRedis(), rateLimit: true, websocket: false,
    });
    await app.ready();
    const agent = new Agent(app);
    const res = await agent.post('/api/auth/guest', { deviceId: 'device-redisdown' });
    console.log('redis-down guest status', res.statusCode, res.body.slice(0, 160));
    await app.close();
  });
});

/** Store that yields to the event loop on every call — what a real database does. */
class SlowStore implements Store {
  constructor(private readonly inner: MemoryStore) {}
  private async gap(): Promise<void> {
    await new Promise((r) => setTimeout(r, 1));
  }
  async userById(id: string) { await this.gap(); return this.inner.userById(id); }
  async userByDeviceId(d: string) { await this.gap(); return this.inner.userByDeviceId(d); }
  async userByWallet(w: string) { await this.gap(); return this.inner.userByWallet(w); }
  async createUser(i: { deviceId: string; save: SaveState }) { await this.gap(); return this.inner.createUser(i); }
  async setWallet(id: string, p: { wallet: string | null; walletKind: string | null; airdropEligible: boolean }) {
    await this.gap(); return this.inner.setWallet(id, p);
  }
  async touchUser() { await this.gap(); }
  async getSave(id: string) { await this.gap(); return this.inner.getSave(id); }
  async putSave(id: string, s: SaveState, m?: SavePutMeta): Promise<SaveRow> { await this.gap(); return this.inner.putSave(id, s, m); }
  async createNonce(r: Parameters<MemoryStore['createNonce']>[0]) { await this.gap(); return this.inner.createNonce(r); }
  async consumeNonce(n: string, d: Date) { await this.gap(); return this.inner.consumeNonce(n, d); }
  async purgeNonces(d: Date) { await this.gap(); return this.inner.purgeNonces(d); }
  async createMatch(i: Parameters<MemoryStore['createMatch']>[0]) { await this.gap(); return this.inner.createMatch(i); }
  async getMatch(id: string) { await this.gap(); return this.inner.getMatch(id); }
  async claimMatch(id: string, at: Date) { await this.gap(); return this.inner.claimMatch(id, at); }
  async completeMatch(id: string, p: Parameters<MemoryStore['completeMatch']>[1]) { await this.gap(); return this.inner.completeMatch(id, p); }
  async expireMatches(b: Date, a: Date) { await this.gap(); return this.inner.expireMatches(b, a); }
  async topSaves(n: number) { await this.gap(); return this.inner.topSaves(n); }
  async countAbove(t: number) { await this.gap(); return this.inner.countAbove(t); }
  async close() { return this.inner.close(); }
}

describe('PROBE: lost update with realistic store latency', () => {
  it('two concurrent economy writes', async () => {
    const inner = new MemoryStore();
    const store = new SlowStore(inner);
    const app = await buildApp({ store, redis: { client: new MemoryRedis(), raw: null, isFallback: true, close: async () => undefined }, rateLimit: false, websocket: false });
    await app.ready();

    const agent = await guest(app, 'device-lost-update');
    const userId = json<AuthResponse>(await agent.get('/api/auth/me')).userId;
    const s = (await inner.getSave(userId))!.json;
    s.quests.list[0].prog = s.quests.list[0].goal;
    s.quests.list[0].claimed = false;
    s.gold = 10000;
    s.cards[s.deck[0]] = { lv: 1, cnt: 100 };
    await inner.putSave(userId, s);

    const [q, u] = await Promise.all([
      agent.post('/api/quest/claim', { index: 0 }),
      agent.post('/api/cards/upgrade', { cardId: s.deck[0] }),
    ]);
    const after = (await inner.getSave(userId))!.json;
    console.log(
      'quest', q.statusCode, 'upgrade', u.statusCode,
      '| claimed:', after.quests.list[0].claimed,
      '| lv:', after.cards[s.deck[0]].lv,
      '| gold:', after.gold,
    );
    // Honest outcome: claimed=true AND lv=2.
    expect(after.quests.list[0].claimed && after.cards[s.deck[0]].lv === 2).toBe(true);
    await app.close();
  });
});
