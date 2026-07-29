/**
 * Three defects that only appear when requests overlap or infrastructure wobbles, and which
 * the rest of the suite cannot see because `MemoryStore` answers synchronously.
 *
 *  1. **Reserved device namespace.** `/api/auth/guest` authenticates on the device id alone.
 *     A wallet-first account's device id must therefore be both unguessable and unusable at
 *     that endpoint, or a public wallet address becomes a login credential.
 *  2. **Lost updates.** Every save write is a read-modify-write of one JSON document. Two in
 *     flight at once used to mean the second silently erased the first — including erasing a
 *     match payout the player had just been told they had won.
 *  3. **Rate limiting when Redis is unreachable.** The limiter must degrade, not take the API
 *     down with it.
 *
 * `SlowStore` is what makes 2 reproducible: it awaits a real timer on every call, which is what
 * a database does and what creates the window between a route's read and its write. Against the
 * bare `MemoryStore` these races cannot be observed at all.
 */
import { describe, expect, it, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type {
  AuthResponse, MatchFinishResponse, MatchStartResponse, SaveResponse, SaveState, SimConfig, WalletLinkResponse,
  WalletNonceResponse,
} from '@crown/shared';
import { buildApp } from '../src/app.js';
import { MemoryRedis, type RedisBridge } from '../src/lib/redis.js';
import { MemoryStore } from '../src/lib/store-memory.js';
import type {
  LeaderboardRow, MatchCompleteInput, MatchCreateInput, MatchRow, NonceRow, SavePutMeta, SaveRow, Store, UserRow,
} from '../src/lib/store.js';
import { Agent, guest, honestLog, json, memoryRedis } from './helpers.js';

let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

/**
 * A `Store` that yields to the event loop on every operation, with writes markedly slower than
 * reads.
 *
 * Not an artificial handicap, and the asymmetry is the whole point. `MemoryStore` resolves in
 * the same microtask, so two concurrent requests through it run to completion one after the
 * other and no interleaving is possible — the races below are simply invisible. Making a write
 * take longer than a read is what reliably produces the interesting order (*both* requests read,
 * then both write) instead of leaving it to whichever handler happens to have fewer awaits.
 */
const READ_MS = 1;
const WRITE_MS = 25;

class SlowStore implements Store {
  constructor(readonly inner: MemoryStore) {}

  private gap(ms: number = READ_MS): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async userById(id: string): Promise<UserRow | null> {
    await this.gap();
    return this.inner.userById(id);
  }
  async userByDeviceId(deviceId: string): Promise<UserRow | null> {
    await this.gap();
    return this.inner.userByDeviceId(deviceId);
  }
  async userByWallet(wallet: string): Promise<UserRow | null> {
    await this.gap();
    return this.inner.userByWallet(wallet);
  }
  async createUser(input: { deviceId: string; save: SaveState }): Promise<UserRow> {
    await this.gap();
    return this.inner.createUser(input);
  }
  async setWallet(
    userId: string,
    patch: { wallet: string | null; walletKind: string | null; airdropEligible: boolean },
  ): Promise<UserRow> {
    await this.gap();
    return this.inner.setWallet(userId, patch);
  }
  async touchUser(userId: string, at: Date): Promise<void> {
    await this.gap();
    return this.inner.touchUser(userId, at);
  }
  async getSave(userId: string): Promise<SaveRow | null> {
    await this.gap();
    return this.inner.getSave(userId);
  }
  async putSave(userId: string, save: SaveState, meta?: SavePutMeta): Promise<SaveRow> {
    await this.gap();
    return this.inner.putSave(userId, save, meta);
  }
  async createNonce(row: NonceRow): Promise<void> {
    await this.gap();
    return this.inner.createNonce(row);
  }
  async consumeNonce(nonce: string, now: Date): Promise<NonceRow | null> {
    await this.gap();
    return this.inner.consumeNonce(nonce, now);
  }
  async purgeNonces(before: Date): Promise<number> {
    await this.gap();
    return this.inner.purgeNonces(before);
  }
  async createMatch(input: MatchCreateInput): Promise<MatchRow> {
    await this.gap();
    return this.inner.createMatch(input);
  }
  async getMatch(id: string): Promise<MatchRow | null> {
    await this.gap();
    return this.inner.getMatch(id);
  }
  async claimMatch(id: string, at: Date): Promise<boolean> {
    await this.gap();
    return this.inner.claimMatch(id, at);
  }
  async completeMatch(id: string, patch: MatchCompleteInput): Promise<void> {
    await this.gap();
    return this.inner.completeMatch(id, patch);
  }
  async expireMatches(before: Date, at: Date): Promise<number> {
    await this.gap();
    return this.inner.expireMatches(before, at);
  }
  async topSaves(limit: number): Promise<LeaderboardRow[]> {
    await this.gap();
    return this.inner.topSaves(limit);
  }
  async countAbove(trophies: number): Promise<number> {
    await this.gap();
    return this.inner.countAbove(trophies);
  }
  async close(): Promise<void> {
    return this.inner.close();
  }
}

async function slowApp(): Promise<{ app: FastifyInstance; store: MemoryStore }> {
  const inner = new MemoryStore();
  app = await buildApp({ store: new SlowStore(inner), redis: memoryRedis(), rateLimit: false, websocket: false });
  await app.ready();
  return { app, store: inner };
}

class SolanaWallet {
  readonly keypair = nacl.sign.keyPair();
  readonly address = bs58.encode(this.keypair.publicKey);

  sign(message: string): string {
    return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), this.keypair.secretKey));
  }
}

async function link(agent: Agent, wallet: SolanaWallet): Promise<WalletLinkResponse> {
  const c = json<WalletNonceResponse>(
    await agent.post('/api/auth/wallet/nonce', { address: wallet.address, kind: 'solana' }),
  );
  const res = await agent.post('/api/auth/wallet/link', {
    address: wallet.address, kind: 'solana', signature: wallet.sign(c.message), message: c.message,
  });
  expect(res.statusCode).toBe(200);
  return json<WalletLinkResponse>(res);
}

/* ------------------------------------------------------ 1. reserved namespace */

describe('POST /api/auth/guest — reserved device namespace', () => {
  it('will not hand out a session for a wallet account’s device id', async () => {
    const { app: a, store } = await slowApp();

    // A wallet-first player: no cookie ever existed, the account is created by the signature.
    const owner = new Agent(a);
    const wallet = new SolanaWallet();
    await link(owner, wallet);
    const victim = json<AuthResponse>(await owner.get('/api/auth/me'));
    const cur = (await store.getSave(victim.userId))!.json;
    await store.putSave(victim.userId, { ...cur, trophies: 3000, gold: 40000 });

    // The address is public. The device id derived from it must not be.
    const attacker = new Agent(a);
    for (const guess of [
      `wallet:solana:${wallet.address}`,
      `WALLET:solana:${wallet.address}`,
      ` wallet:solana:${wallet.address}`,
    ]) {
      const res = await attacker.post('/api/auth/guest', { deviceId: guess });
      expect(res.statusCode).toBe(400);
    }
    expect(attacker.hasSession).toBe(false);

    // And the real device id is not the address in any form — it is HMAC'd with AUTH_SECRET.
    const row = (await store.userById(victim.userId))!;
    expect(row.deviceId).not.toContain(wallet.address);
  });

  it('still accepts an ordinary client-generated device id', async () => {
    const { app: a } = await slowApp();
    const res = await new Agent(a).post('/api/auth/guest', { deviceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
    expect(res.statusCode).toBe(200);
  });
});

/* ---------------------------------------------------------- 2. lost updates */

describe('overlapping save writes', () => {
  it('does not let a profile write erase a match payout', async () => {
    const { app: a, store } = await slowApp();
    const agent = await guest(a, 'device-race-match01');
    const userId = json<AuthResponse>(await agent.get('/api/auth/me')).userId;

    const start = json<MatchStartResponse>(await agent.post('/api/match/start'));
    const cfg: SimConfig = {
      seed: start.seed, myDeck: start.myDeck, myCardLevels: start.myCardLevels,
      myKingLevel: start.myKingLevel, aiDeckIndex: start.aiDeckIndex, aiLevel: start.aiLevel,
    };
    const log = honestLog(cfg);

    const before = (await store.getSave(userId))!.json;
    // A legal deck the player already owns, differing from the current one — exactly what the
    // deck editor posts, and what a player might tap while the result screen is still settling.
    const spare = Object.keys(before.cards).find((id) => before.deck.indexOf(id) < 0)!;
    const newDeck = [spare, ...before.deck.slice(1)];

    const [finishRes, profileRes] = await Promise.all([
      agent.post('/api/match/finish', { matchId: start.matchId, deployLog: log }),
      agent.post('/api/save/profile', { deck: newDeck }),
    ]);
    expect(finishRes.statusCode).toBe(200);
    expect(profileRes.statusCode).toBe(200);
    const finish = json<MatchFinishResponse>(finishRes);
    expect(finish.voided).toBeUndefined();

    // Whichever write landed second, the stored save must carry BOTH effects.
    const after = (await store.getSave(userId))!.json;
    expect(after.deck).toEqual(newDeck);
    expect(after.trophies).toBe(finish.rewards.trophiesAfter);
    expect(after.gold).toBe(before.gold + finish.rewards.gold);
    expect(after.wins + after.losses).toBe(1);
  });

  it('pays the wallet bonus once even when a save write is in flight across the link', async () => {
    const { app: a, store } = await slowApp();
    const agent = await guest(a, 'device-race-wallet1');
    const userId = json<AuthResponse>(await agent.get('/api/auth/me')).userId;
    const gemsBefore = (await store.getSave(userId))!.json.gem;
    const wallet = new SolanaWallet();

    const c = json<WalletNonceResponse>(
      await agent.post('/api/auth/wallet/nonce', { address: wallet.address, kind: 'solana' }),
    );
    const [linkRes, profileRes] = await Promise.all([
      agent.post('/api/auth/wallet/link', {
        address: wallet.address, kind: 'solana', signature: wallet.sign(c.message), message: c.message,
      }),
      agent.post('/api/save/profile', { name: 'Racer' }),
    ]);
    expect(linkRes.statusCode).toBe(200);
    expect(profileRes.statusCode).toBe(200);
    expect(json<WalletLinkResponse>(linkRes).bonusGranted).toBe(true);

    // The flag is the only thing preventing a second payout, and it lives inside the document
    // the profile write also rewrites. If that write clobbered it, the relink below pays again.
    const raced = (await store.getSave(userId))!.json;
    expect(raced.walletBonus).toBe(true);
    expect(raced.name).toBe('Racer');
    expect(raced.gem).toBe(gemsBefore + 100);

    await agent.post('/api/auth/wallet/unlink');
    expect((await link(agent, wallet)).bonusGranted).toBe(false);
    expect((await store.getSave(userId))!.json.gem).toBe(gemsBefore + 100);
  });

  it('keeps both of two overlapping economy writes', async () => {
    const { app: a, store } = await slowApp();
    const agent = await guest(a, 'device-race-econ001');
    const userId = json<AuthResponse>(await agent.get('/api/auth/me')).userId;

    const seed = (await store.getSave(userId))!.json;
    seed.quests.list[0].prog = seed.quests.list[0].goal;
    seed.quests.list[0].claimed = false;
    seed.gold = 10_000;
    seed.cards[seed.deck[0]] = { lv: 1, cnt: 100 };
    await store.putSave(userId, seed);

    const [quest, upgrade] = await Promise.all([
      agent.post('/api/quest/claim', { index: 0 }),
      agent.post('/api/cards/upgrade', { cardId: seed.deck[0] }),
    ]);
    expect(quest.statusCode).toBe(200);
    expect(upgrade.statusCode).toBe(200);

    const after = (await store.getSave(userId))!.json;
    expect(after.quests.list[0].claimed).toBe(true);
    expect(after.cards[seed.deck[0]].lv).toBe(2);
  });

  it('refuses a second concurrent migration instead of importing twice', async () => {
    const { app: a, store } = await slowApp();
    const agent = await guest(a, 'device-race-migrat1');
    const userId = json<AuthResponse>(await agent.get('/api/auth/me')).userId;
    const payload = { save: { gold: 9000, gem: 400, trophies: 700, best: 700 } };

    const results = await Promise.all([
      agent.post('/api/save/migrate', payload),
      agent.post('/api/save/migrate', payload),
    ]);
    // One import; the other loses either the `migrated` check or the compare-and-set.
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(1);

    const row = (await store.getSave(userId))!;
    expect(row.migrated).toBe(true);
    expect(row.json.gold).toBe(9000);
  });

  it('a voided match returns the save it actually stored', async () => {
    const { app: a, store } = await slowApp();
    const agent = await guest(a, 'device-race-void001');
    const userId = json<AuthResponse>(await agent.get('/api/auth/me')).userId;

    const start = json<MatchStartResponse>(await agent.post('/api/match/start'));
    const body = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        // Two deploys one tick apart — rejected structurally, before any simulation.
        deployLog: [
          { t: 0, cardId: start.myDeck[0], x: 9, y: 20 },
          { t: 1, cardId: start.myDeck[1], x: 9, y: 20 },
        ],
      }),
    );
    expect(body.voided?.reason).toBe('log:deploy-rate-exceeded');

    // The quest set in the response must be the one on disk: `loadSave` rolls quests as a side
    // effect, and returning a roll that was never persisted makes the next GET disagree.
    const stored = (await store.getSave(userId))!.json;
    expect(body.save.quests).toEqual(stored.quests);
    expect(body.save.trophies).toBe(stored.trophies);
  });
});

/* --------------------------------------------------- 3. rate limiter vs redis */

/** ioredis with the connection down and `enableOfflineQueue: false` — every command throws. */
function brokenRedis(): RedisBridge {
  const raw = {
    status: 'reconnecting',
    defineCommand: () => undefined,
    rateLimit: (_key: unknown, _ttl: unknown, _max: unknown, cb: (err: Error) => void) =>
      cb(new Error('Stream isn’t writeable and enableOfflineQueue options is false')),
  } as unknown as RedisBridge['raw'];
  return { client: new MemoryRedis(), raw, isFallback: false, close: async () => undefined };
}

describe('rate limiting when redis is unreachable', () => {
  it('serves the request rather than 500ing the whole API', async () => {
    app = await buildApp({
      store: new MemoryStore(), redis: brokenRedis(), rateLimit: true, websocket: false,
    });
    await app.ready();
    const agent = new Agent(app);

    // Every gameplay route carries a rate-limit config, so a store error that propagated would
    // take out login, match start, match finish, chests and saves together.
    expect((await agent.post('/api/auth/guest', { deviceId: 'device-redis-down01' })).statusCode).toBe(200);
    expect((await agent.get('/api/save')).statusCode).toBe(200);
    expect((await agent.post('/api/match/start')).statusCode).toBe(200);
  });

  it('reports the live connection state on /api/health', async () => {
    app = await buildApp({
      store: new MemoryStore(), redis: brokenRedis(), rateLimit: true, websocket: false,
    });
    await app.ready();
    const body = json<{ redis: string; redisStatus: string }>(await new Agent(app).get('/api/health'));
    // "configured" and "connected" are different questions; a monitor needs the second one.
    expect(body.redis).toBe('redis');
    expect(body.redisStatus).toBe('reconnecting');
  });
});
