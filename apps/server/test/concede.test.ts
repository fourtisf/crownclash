/**
 * Give-up path.
 *
 * The rule being pinned: conceding is a *shortcut to losing*, never a shortcut around
 * validation. A player who quits gets the loss they asked for; a player who quits with a
 * tampered log still gets the match voided.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { MatchFinishResponse, MatchStartResponse } from '@crown/shared';
import { guest, json, honestLog, makeRig, type TestRig } from './helpers.js';

let rig: TestRig;
beforeEach(async () => {
  rig = await makeRig();
});
afterEach(async () => {
  await rig.close();
});

async function startMatch(agent: Awaited<ReturnType<typeof guest>>) {
  const s = json<MatchStartResponse>(await agent.post('/api/match/start'));
  return {
    start: s,
    cfg: {
      seed: s.seed,
      myDeck: s.myDeck,
      myCardLevels: s.myCardLevels,
      myKingLevel: s.myKingLevel,
      aiDeckIndex: s.aiDeckIndex,
      aiLevel: s.aiLevel,
    },
  };
}

describe('conceding a match', () => {
  it('is recorded as a loss and costs trophies', async () => {
    const agent = await guest(rig.app, 'device-concede-1');
    // Bank some trophies first, or the floor at 0 hides the deduction.
    const me = json<{ userId: string }>(await agent.get('/api/auth/me'));
    const cur = (await rig.store.getSave(me.userId))!.json;
    await rig.store.putSave(me.userId, { ...cur, trophies: 500 });

    const { start, cfg } = await startMatch(agent);
    const log = honestLog(cfg).slice(0, 3);
    const res = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        deployLog: log,
        conceded: true,
        concededAtTick: 900, // 30 s in
      }),
    );

    expect(res.voided).toBeUndefined();
    expect(res.result).toBe('lose');
    expect(res.rewards.delta).toBeLessThanOrEqual(-18);
    expect(res.rewards.delta).toBeGreaterThanOrEqual(-26);
    expect(res.save.trophies).toBe(500 + res.rewards.delta);
    expect(res.save.losses).toBe(1);
    expect(res.save.wins).toBe(0);
  });

  it('works with an empty log — quitting before playing anything', async () => {
    const agent = await guest(rig.app, 'device-concede-2');
    const { start } = await startMatch(agent);
    const res = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        deployLog: [],
        conceded: true,
        concededAtTick: 60,
      }),
    );
    expect(res.result).toBe('lose');
    expect(res.voided).toBeUndefined();
  });

  it('does NOT let a tampered log through', async () => {
    const agent = await guest(rig.app, 'device-concede-3');
    const { start } = await startMatch(agent);
    const res = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        // A card that is not in the player's deck: still rejected, concession or not.
        deployLog: [{ t: 0, cardId: 'stormtitan', x: 9, y: 20 }],
        conceded: true,
        concededAtTick: 300,
      }),
    );
    expect(res.voided).toBeTruthy();
    expect(res.save.losses).toBe(0);
  });

  it('cannot be used twice on the same match', async () => {
    const agent = await guest(rig.app, 'device-concede-4');
    const { start } = await startMatch(agent);
    const body = { matchId: start.matchId, deployLog: [], conceded: true, concededAtTick: 90 };
    expect((await agent.post('/api/match/finish', body)).statusCode).toBe(200);
    expect((await agent.post('/api/match/finish', body)).statusCode).toBe(409);
  });

  it('ignores an absurd concede tick rather than trusting it', async () => {
    const agent = await guest(rig.app, 'device-concede-5');
    const { start } = await startMatch(agent);
    const res = json<MatchFinishResponse>(
      await agent.post('/api/match/finish', {
        matchId: start.matchId,
        deployLog: [],
        conceded: true,
        concededAtTick: 999_999, // far past regulation + sudden death
      }),
    );
    // Clamped to the match ceiling; still a loss, never a win.
    expect(res.result).toBe('lose');
  });
});

describe('tutorial flag', () => {
  it('starts false and can only be set true', async () => {
    const agent = await guest(rig.app, 'device-tutorial-1');
    const before = json<{ save: { tutorialDone: boolean } }>(await agent.get('/api/save'));
    expect(before.save.tutorialDone).toBe(false);

    const after = json<{ save: { tutorialDone: boolean } }>(
      await agent.post('/api/save/profile', { tutorialDone: true }),
    );
    expect(after.save.tutorialDone).toBe(true);

    // A stale client cannot make a veteran sit through the coach marks again.
    const again = json<{ save: { tutorialDone: boolean } }>(
      await agent.post('/api/save/profile', { tutorialDone: false }),
    );
    expect(again.save.tutorialDone).toBe(true);
  });
});
