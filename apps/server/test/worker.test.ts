/**
 * The worker process.
 *
 * Its most important job is the one that should never fire: the audit re-simulation compares
 * a second replay against the hash the API recorded, so a sim that stops being deterministic
 * is caught by a machine instead of by players losing honest matches. Both branches are
 * exercised here — a clean match audits silently, a tampered stored hash raises the flag.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { MatchStartResponse, SimConfig } from '@crown/shared';
import { RKEY } from '../src/lib/redis.js';
import { Worker } from '../src/worker.js';
import { Agent, guest, honestLog, json, makeRig, type TestRig } from './helpers.js';

let rig: TestRig;
let agent: Agent;
let worker: Worker;

beforeEach(async () => {
  rig = await makeRig();
  agent = await guest(rig.app, 'device-worker-0001');
  // Constructed, never `start()`ed: the tests drive `once()` so there is no background timer
  // racing the assertions.
  worker = new Worker({ store: rig.store, redis: rig.redis });
});

afterEach(async () => {
  worker.stop();
  await rig.close();
});

async function playMatch(): Promise<string> {
  const start = json<MatchStartResponse>(await agent.post('/api/match/start'));
  const cfg: SimConfig = {
    seed: start.seed,
    myDeck: start.myDeck,
    myCardLevels: start.myCardLevels,
    myKingLevel: start.myKingLevel,
    aiDeckIndex: start.aiDeckIndex,
    aiLevel: start.aiLevel,
  };
  await agent.post('/api/match/finish', { matchId: start.matchId, deployLog: honestLog(cfg) });
  return start.matchId;
}

describe('audit re-simulation', () => {
  it('replays a finished match and agrees with the API', async () => {
    const matchId = await playMatch();
    // The API enqueued the job when it validated the match.
    expect(await rig.redis.client.xlen(RKEY.resimStream)).toBe(1);

    const report = await worker.once();
    expect(report.audited).toBe(1);
    expect(report.mismatches).toBe(0);

    const row = await rig.store.getMatch(matchId);
    expect(row?.validated).toBe(true);
    expect(row?.voidReason).toBeNull();
  });

  it('flags a match whose stored hash no longer reproduces', async () => {
    const matchId = await playMatch();
    // Stand in for "the sim changed underneath us" by corrupting the recorded hash.
    await rig.store.completeMatch(matchId, { resultHash: 'deadbeef' });
    await rig.redis.client.del(RKEY.resimStream);
    await rig.redis.client.xadd(RKEY.resimStream, { matchId, hash: 'deadbeef' });

    const report = await worker.once();
    expect(report.mismatches).toBe(1);
    expect((await rig.store.getMatch(matchId))?.voidReason).toBe('audit:hash-mismatch');
  });

  it('does not re-audit an acknowledged job', async () => {
    await playMatch();
    expect((await worker.once()).audited).toBe(1);
    expect((await worker.once()).audited).toBe(0);
  });
});

describe('reaping', () => {
  it('voids matches that were started and never submitted, and they cannot be cashed in later', async () => {
    const abandoned = json<MatchStartResponse>(await agent.post('/api/match/start')).matchId;

    // Inside MATCH_EXPIRY_MINUTES the worker leaves it alone.
    expect((await worker.once()).expiredMatches).toBe(0);
    expect((await rig.store.getMatch(abandoned))?.finishedAt).toBeNull();

    // The reaping query itself. Aging the row is not possible through the interface, so the
    // cutoff is moved instead — same predicate, same result.
    expect(await rig.store.expireMatches(new Date(Date.now() + 1_000), new Date())).toBe(1);
    const row = await rig.store.getMatch(abandoned);
    expect(row?.finishedAt).not.toBeNull();
    expect(row?.voidReason).toBe('expired');

    // The point of reaping: a stale match cannot be banked and submitted against a stronger
    // account later.
    const res = await agent.post('/api/match/finish', { matchId: abandoned, deployLog: [] });
    expect(res.statusCode).toBe(409);
  });

  it('deletes expired wallet nonces', async () => {
    await rig.store.createNonce({
      nonce: 'expired-nonce-0000000000000000',
      address: 'addr',
      kind: 'solana',
      message: 'x',
      expiresAt: new Date(Date.now() - 60_000),
      usedAt: null,
    });
    await rig.store.createNonce({
      nonce: 'live-nonce-000000000000000000',
      address: 'addr',
      kind: 'solana',
      message: 'x',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });

    expect((await worker.once()).purgedNonces).toBe(1);
    expect(await rig.store.consumeNonce('live-nonce-000000000000000000', new Date())).not.toBeNull();
  });
});

describe('leaderboard snapshot', () => {
  it('warms the cache so no player request pays for the scan', async () => {
    await rig.redis.client.del(RKEY.leaderboard);
    const report = await worker.once();
    expect(report.leaderboardRows).toBeGreaterThan(0);
    expect(await rig.redis.client.get(RKEY.leaderboard)).toBeTruthy();
  });
});
