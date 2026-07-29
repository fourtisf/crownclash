/**
 * Match validation (handoff §5).
 *
 * The claim under test: the server's re-simulation is the only source of a result, and every
 * class of tampered log the brief names is either rejected structurally or voided by the
 * replay. Nothing here asserts on a client-supplied outcome, because the API never accepts one.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  API_ERRORS, CARD, SHOP, defaultState,
  type MatchFinishResponse, type MatchStartResponse, type SaveResponse, type SimConfig,
} from '@crown/shared';
import { Agent, elixirOverdraftLog, firstNonSpell, guest, honestLog, json, makeRig, type TestRig } from './helpers.js';

let rig: TestRig;
let agent: Agent;

beforeEach(async () => {
  rig = await makeRig();
  agent = await guest(rig.app, 'device-match-0001');
});

afterEach(async () => {
  await rig.close();
});

/** Starts a match and rebuilds the exact `SimConfig` the server froze for it. */
async function startMatch(a: Agent = agent): Promise<{ start: MatchStartResponse; cfg: SimConfig }> {
  const res = await a.post('/api/match/start');
  expect(res.statusCode).toBe(200);
  const start = json<MatchStartResponse>(res);
  return {
    start,
    cfg: {
      seed: start.seed,
      myDeck: start.myDeck,
      myCardLevels: start.myCardLevels,
      myKingLevel: start.myKingLevel,
      aiDeckIndex: start.aiDeckIndex,
      aiLevel: start.aiLevel,
    },
  };
}

describe('POST /api/match/start', () => {
  it('issues a server-generated seed and an AI derived from the player’s trophies', async () => {
    const { start } = await startMatch();
    expect(start.seed).toMatch(/^[0-9a-f]{32}$/);
    // A brand-new account sits in arena 0 at 0 trophies.
    expect(start.aiDeckIndex).toBe(0);
    expect(start.aiLevel).toBe(1);
    expect(start.myDeck).toEqual(defaultState().deck);
    expect(start.myKingLevel).toBe(1);
    expect(start.aiTrophies).toBeGreaterThanOrEqual(0);
    expect(start.aiName.length).toBeGreaterThan(0);
  });

  it('never issues the same seed twice', async () => {
    const seeds = new Set<string>();
    for (let i = 0; i < 5; i++) seeds.add((await startMatch()).start.seed);
    expect(seeds.size).toBe(5);
  });
});

describe('POST /api/match/finish — honest logs', () => {
  it('accepts an honest log, computes the result itself, and pays out', async () => {
    const { start, cfg } = await startMatch();
    const log = honestLog(cfg);
    expect(log.length).toBeGreaterThan(5);

    const before = json<SaveResponse>(await agent.get('/api/save')).save;
    const res = await agent.post('/api/match/finish', { matchId: start.matchId, deployLog: log });
    expect(res.statusCode).toBe(200);
    const body = json<MatchFinishResponse>(res);

    expect(body.voided).toBeUndefined();
    expect(['win', 'lose', 'draw']).toContain(body.result);
    expect(body.crowns).toHaveLength(2);

    // Rewards are applied server-side and the returned save is authoritative.
    expect(body.rewards.result).toBe(body.result);
    expect(body.save.gold).toBeGreaterThan(before.gold);
    expect(body.save.trophies).toBe(body.rewards.trophiesAfter);
    if (body.result === 'win') {
      expect(body.rewards.delta).toBeGreaterThanOrEqual(28);
      expect(body.rewards.delta).toBeLessThanOrEqual(33);
      expect(body.save.wins).toBe(1);
    } else if (body.result === 'lose') {
      expect(body.rewards.delta).toBeLessThanOrEqual(-18);
      expect(body.save.losses).toBe(1);
    }

    // The save the client would fetch next matches what finish returned.
    const after = json<SaveResponse>(await agent.get('/api/save')).save;
    expect(after.trophies).toBe(body.save.trophies);
    expect(after.gold).toBe(body.save.gold);
  });

  it('records the audit trail: validated, a result hash, and the log', async () => {
    const { start, cfg } = await startMatch();
    await agent.post('/api/match/finish', { matchId: start.matchId, deployLog: honestLog(cfg) });

    const row = await rig.store.getMatch(start.matchId);
    expect(row?.validated).toBe(true);
    expect(row?.voidReason).toBeNull();
    expect(row?.resultHash).toMatch(/^[0-9a-f]{8}$/);
    expect(row?.rewardSeed).toBeTruthy();
    // The reward roll must not be derivable from the match seed.
    expect(row?.rewardSeed).not.toBe(row?.seed);
    expect(row?.finishedAt).toBeInstanceOf(Date);
  });

  it('accepts an empty log — a player who deploys nothing still gets a real result', async () => {
    const { start } = await startMatch();
    const res = await agent.post('/api/match/finish', { matchId: start.matchId, deployLog: [] });
    expect(res.statusCode).toBe(200);
    const body = json<MatchFinishResponse>(res);
    expect(body.voided).toBeUndefined();
    // Doing nothing against an AI that plays is a loss, not a draw.
    expect(body.result).toBe('lose');
  });

  it('ignores the client’s levels: the config frozen at start is what replays', async () => {
    const { start, cfg } = await startMatch();
    const log = honestLog(cfg);

    // Buy enough to upgrade a deck card between start and finish.
    await rig.store.putSave(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      (await rig.store.userByDeviceId('device-match-0001'))!.id,
      { ...json<SaveResponse>(await agent.get('/api/save')).save, cards: { ...defaultState().cards, ironclad: { lv: 9, cnt: 0 } } },
    );

    const res = await agent.post('/api/match/finish', { matchId: start.matchId, deployLog: log });
    expect(res.statusCode).toBe(200);
    const row = await rig.store.getMatch(start.matchId);
    // Stored config still says level 1 — the mid-match upgrade cannot reach the replay.
    expect(row?.config.myCardLevels.ironclad).toBe(1);
    expect(json<MatchFinishResponse>(res).voided).toBeUndefined();
  });
});

describe('POST /api/match/finish — tampered logs', () => {
  it('voids an elixir overdraft', async () => {
    const { start, cfg } = await startMatch();
    const res = await agent.post('/api/match/finish', {
      matchId: start.matchId,
      deployLog: elixirOverdraftLog(cfg),
    });
    expect(res.statusCode).toBe(200);
    const body = json<MatchFinishResponse>(res);
    expect(body.voided?.reason).toBe('sim:illegal-deploy');
    expect(body.rewards.delta).toBe(0);
    expect(body.rewards.gold).toBe(0);
    expect(body.save.trophies).toBe(0);

    const row = await rig.store.getMatch(start.matchId);
    expect(row?.validated).toBe(false);
    expect(row?.voidReason).toBe('sim:illegal-deploy');
  });

  it('voids a deploy in the enemy half', async () => {
    const { start, cfg } = await startMatch();
    const log = honestLog(cfg);
    const i = firstNonSpell(log);
    expect(i).toBeGreaterThanOrEqual(0);
    // y = 5 is deep in the AI's half. Spells are exempt from the half rule, troops are not.
    log[i] = { ...log[i], y: 5 };

    const body = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', { matchId: start.matchId, deployLog: log }),
    );
    expect(body.voided?.reason).toBe('sim:illegal-deploy');
    expect(body.save.trophies).toBe(0);
  });

  it('voids a deploy on the river bank inside the 1.1-tile buffer', async () => {
    const { start, cfg } = await startMatch();
    const log = honestLog(cfg);
    const i = firstNonSpell(log);
    // 16.5 is past the river (RIV_B = 15.85) but inside the buffer the prototype enforces
    // (`y >= RIV_B + 1.1` = 16.95). Discrepancy D2 — the spec's 15.85 would accept this.
    log[i] = { ...log[i], y: 16.5 };
    const body = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', { matchId: start.matchId, deployLog: log }),
    );
    expect(body.voided?.reason).toBe('sim:illegal-deploy');
  });

  it('rejects an unknown card before any simulation runs', async () => {
    const { start } = await startMatch();
    const body = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        deployLog: [{ t: 10, cardId: 'excalibur', x: 9, y: 20 }],
      }),
    );
    expect(body.voided?.reason).toBe('log:unknown-card');
  });

  it('rejects a real card that is not in the player’s deck', async () => {
    const { start, cfg } = await startMatch();
    const outsider = Object.keys(CARD).find((id) => id !== 'behemoth_mini' && cfg.myDeck.indexOf(id) < 0)!;
    const body = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        deployLog: [{ t: 10, cardId: outsider, x: 9, y: 20 }],
      }),
    );
    expect(body.voided?.reason).toBe('log:card-not-in-deck');
  });

  it('rejects the hidden behemoth_mini, which is spawn-only', async () => {
    const { start } = await startMatch();
    const body = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        deployLog: [{ t: 10, cardId: 'behemoth_mini', x: 9, y: 20 }],
      }),
    );
    expect(body.voided?.reason).toBe('log:card-not-playable');
  });

  it('rejects more than one deploy per 300 ms', async () => {
    const { start, cfg } = await startMatch();
    const body = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        deployLog: [
          { t: 0, cardId: cfg.myDeck[0], x: 9, y: 20 },
          { t: 1, cardId: cfg.myDeck[1], x: 9, y: 20 },
        ],
      }),
    );
    expect(body.voided?.reason).toBe('log:deploy-rate-exceeded');
  });

  it('rejects an out-of-order log', async () => {
    const { start, cfg } = await startMatch();
    const body = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        deployLog: [
          { t: 100, cardId: cfg.myDeck[0], x: 9, y: 20 },
          { t: 10, cardId: cfg.myDeck[1], x: 9, y: 20 },
        ],
      }),
    );
    expect(body.voided?.reason).toBe('log:log-out-of-order');
  });
});

describe('POST /api/match/finish — replay and ownership', () => {
  it('refuses a second submission of the same match', async () => {
    const { start, cfg } = await startMatch();
    const log = honestLog(cfg);

    const first = await agent.post('/api/match/finish', { matchId: start.matchId, deployLog: log });
    expect(first.statusCode).toBe(200);
    const paid = json<MatchFinishResponse>(first).save;

    const second = await agent.post('/api/match/finish', { matchId: start.matchId, deployLog: log });
    expect(second.statusCode).toBe(409);
    expect(json<{ error: string }>(second).error).toBe(API_ERRORS.matchAlreadyFinished);

    // The replay paid nothing.
    const after = json<SaveResponse>(await agent.get('/api/save')).save;
    expect(after.trophies).toBe(paid.trophies);
    expect(after.gold).toBe(paid.gold);
  });

  it('pays exactly once when the same match is submitted concurrently', async () => {
    const { start, cfg } = await startMatch();
    const log = honestLog(cfg);
    // `claimMatch` is a conditional write, so only one of these can reach the payout.
    const results = await Promise.all([
      agent.post('/api/match/finish', { matchId: start.matchId, deployLog: log }),
      agent.post('/api/match/finish', { matchId: start.matchId, deployLog: log }),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
  });

  it('hides another player’s match behind a 404', async () => {
    const { start } = await startMatch();
    const other = await guest(rig.app, 'device-match-0002');
    const res = await other.post('/api/match/finish', { matchId: start.matchId, deployLog: [] });
    expect(res.statusCode).toBe(404);
    expect(json<{ error: string }>(res).error).toBe(API_ERRORS.matchNotFound);
    // And the victim's match is still open.
    expect((await rig.store.getMatch(start.matchId))?.finishedAt).toBeNull();
  });

  it('requires a session', async () => {
    const anon = new Agent(rig.app);
    expect((await anon.post('/api/match/start')).statusCode).toBe(401);
    expect((await anon.post('/api/match/finish', { matchId: 'x', deployLog: [] })).statusCode).toBe(401);
  });
});

describe('trophy-derived matchmaking', () => {
  it('scales the AI deck and level with the player’s arena', async () => {
    const user = (await rig.store.userByDeviceId('device-match-0001'))!;
    await rig.store.putSave(user.id, { ...defaultState(), trophies: 2700, best: 2700, lvl: 6 });

    const { start } = await startMatch();
    // 2600 = Royal Arena (index 5); AI_DECKS has 6 entries so the index clamps there too.
    expect(start.aiDeckIndex).toBe(5);
    // L1440 — clamp(1 + floor(2700/240), 1, 13) = 12.
    expect(start.aiLevel).toBe(12);
    expect(start.myKingLevel).toBe(6);
  });
});

describe('shop indices stay in range', () => {
  it('rejects an index past the end of SHOP', async () => {
    const res = await agent.post('/api/shop/buy', { index: SHOP.length });
    expect(res.statusCode).toBe(400);
  });
});
