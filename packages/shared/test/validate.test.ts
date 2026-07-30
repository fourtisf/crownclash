/**
 * Anti-cheat suite — handoff §8.3: "Validation: tampered logs (elixir overdraft, enemy-half
 * deploy, unknown card) all rejected" and §5's save caps.
 *
 * Two layers are exercised, because a real attacker will probe both:
 *  - `validateDeployLog` rejects structurally impossible logs cheaply, before any CPU is
 *    spent re-simulating.
 *  - the re-simulation itself rejects semantically impossible plays (not enough elixir,
 *    wrong half, card not currently in hand) — the authority.
 */
import { describe, expect, it } from 'vitest';

import { aiUpdate } from '../src/ai.js';
import { CARD, RIV_B, TICK_HZ } from '../src/data.js';
import { runMatch } from '../src/sim.js';
import { defaultState } from '../src/state.js';
import { MIN_DEPLOY_GAP_TICKS, SAVE_CAPS, sanitizeSave, validateDeployLog } from '../src/validate.js';
import { cfgFor, playthrough } from './helpers.js';
import type { DeployLogEntry } from '../src/types.js';

const DECK = defaultState().deck;

describe('deploy log — structural validation', () => {
  it('accepts a log the game itself produced', () => {
    const cfg = cfgFor('valid-log', 600);
    const { log } = playthrough(cfg, 'honest-bot');
    expect(validateDeployLog(log, cfg.myDeck)).toEqual({ ok: true });
  });

  it('rejects an unknown card id', () => {
    const log: DeployLogEntry[] = [{ t: 10, cardId: 'super_dragon_9000', x: 9, y: 20 }];
    expect(validateDeployLog(log, DECK)).toMatchObject({ ok: false, reason: 'unknown-card' });
  });

  it('rejects the hidden behemoth_mini, which exists but is unplayable', () => {
    const log: DeployLogEntry[] = [{ t: 10, cardId: 'behemoth_mini', x: 9, y: 20 }];
    expect(validateDeployLog(log, [...DECK, 'behemoth_mini'])).toMatchObject({
      ok: false,
      reason: 'card-not-playable',
    });
  });

  it('rejects a real card that is not in the player\'s deck', () => {
    expect(CARD.stormtitan).toBeTruthy();
    expect(DECK).not.toContain('stormtitan');
    const log: DeployLogEntry[] = [{ t: 10, cardId: 'stormtitan', x: 9, y: 20 }];
    expect(validateDeployLog(log, DECK)).toMatchObject({ ok: false, reason: 'card-not-in-deck' });
  });

  it('rejects more than one deploy per 300 ms', () => {
    const log: DeployLogEntry[] = [
      { t: 100, cardId: 'archers', x: 9, y: 20 },
      { t: 100 + MIN_DEPLOY_GAP_TICKS - 1, cardId: 'sprites', x: 9, y: 20 },
    ];
    expect(validateDeployLog(log, DECK)).toMatchObject({ ok: false, reason: 'deploy-rate-exceeded' });
    // Exactly 300 ms apart is fine.
    log[1].t = 100 + MIN_DEPLOY_GAP_TICKS;
    expect(validateDeployLog(log, DECK)).toEqual({ ok: true });
    expect(MIN_DEPLOY_GAP_TICKS).toBe(Math.ceil(0.3 * TICK_HZ));
  });

  it('rejects out-of-order, negative, absurd and non-finite ticks/positions', () => {
    expect(validateDeployLog([{ t: 200, cardId: 'archers', x: 9, y: 20 }, { t: 100, cardId: 'sprites', x: 9, y: 20 }], DECK))
      .toMatchObject({ ok: false });
    expect(validateDeployLog([{ t: -1, cardId: 'archers', x: 9, y: 20 }], DECK))
      .toMatchObject({ ok: false, reason: 'tick-out-of-range' });
    expect(validateDeployLog([{ t: 1e9, cardId: 'archers', x: 9, y: 20 }], DECK))
      .toMatchObject({ ok: false, reason: 'tick-out-of-range' });
    expect(validateDeployLog([{ t: 5.5, cardId: 'archers', x: 9, y: 20 }], DECK))
      .toMatchObject({ ok: false, reason: 'tick-out-of-range' });
    expect(validateDeployLog([{ t: 10, cardId: 'archers', x: NaN, y: 20 }], DECK))
      .toMatchObject({ ok: false, reason: 'position-not-finite' });
    expect(validateDeployLog([{ t: 10, cardId: 'archers', x: Infinity, y: 20 }], DECK))
      .toMatchObject({ ok: false, reason: 'position-not-finite' });
  });

  it('rejects non-arrays and oversized logs (cheap DoS guard)', () => {
    expect(validateDeployLog(null, DECK)).toMatchObject({ ok: false, reason: 'log-not-array' });
    expect(validateDeployLog('[]', DECK)).toMatchObject({ ok: false, reason: 'log-not-array' });
    const huge = Array.from({ length: 1000 }, (_, i) => ({ t: i * 10, cardId: 'archers', x: 9, y: 20 }));
    expect(validateDeployLog(huge, DECK)).toMatchObject({ ok: false, reason: 'log-too-long' });
  });
});

describe('deploy log — re-simulation is the authority (§3.3)', () => {
  it('rejects an elixir overdraft', () => {
    // 5 elixir at t=0. Two 3-cost cards on consecutive legal ticks costs 6.
    const cfg = cfgFor('overdraft', 0);
    const hand = ['ironclad', 'archers', 'sprites', 'spears'].filter((c) => cfg.myDeck.includes(c));
    const log: DeployLogEntry[] = [
      { t: 0, cardId: 'ironclad', x: 9, y: RIV_B + 2 },
      { t: MIN_DEPLOY_GAP_TICKS, cardId: 'archers', x: 9, y: RIV_B + 2 },
    ];
    expect(hand.length).toBeGreaterThan(0);
    expect(validateDeployLog(log, cfg.myDeck)).toEqual({ ok: true }); // structurally fine...
    const { illegal } = runMatch(cfg, log, aiUpdate); // ...but unaffordable in the sim
    expect(illegal).not.toBeNull();
  });

  it('rejects a deploy in the enemy half', () => {
    const cfg = cfgFor('enemy-half', 0);
    // Must come from the *opening hand*, or the hand-cycle check rejects it first and we
    // would never reach the position rule we mean to test.
    const opening = runMatch(cfg, [], null, { maxTicks: 1 }).sim.state.hand;
    const cid = opening.find((c) => CARD[c].t !== 'spell' && CARD[c].cost <= 5)!;
    const log: DeployLogEntry[] = [{ t: 0, cardId: cid, x: 9, y: 5 }];
    expect(validateDeployLog(log, cfg.myDeck)).toEqual({ ok: true });
    const { illegal } = runMatch(cfg, log, aiUpdate);
    expect(illegal).toMatchObject({ reason: 'illegal-deploy' });
  });

  it('rejects a deploy on the river', () => {
    const cfg = cfgFor('river', 0);
    const cid = cfg.myDeck.find((c) => CARD[c].t !== 'spell')!;
    const { illegal } = runMatch(cfg, [{ t: 0, cardId: cid, x: 9, y: 15 }], aiUpdate);
    expect(illegal).not.toBeNull();
  });

  it('rejects a card that is in the deck but not in the current 4-card hand', () => {
    const cfg = cfgFor('hand-cycle', 0);
    const { sim } = runMatch(cfg, [], null, { maxTicks: 1 });
    const queued = sim.state.queue[0];
    // `queued` is a legal deck card, just not in hand yet — the hand-cycle check must catch it.
    const { illegal } = runMatch(cfg, [{ t: 0, cardId: queued, x: 9, y: RIV_B + 3 }], aiUpdate);
    expect(illegal).toMatchObject({ reason: 'card-not-in-hand' });
  });

  it('rejects a log whose entries were reordered after the fact', () => {
    const cfg = cfgFor('reorder', 900);
    const { log } = playthrough(cfg, 'reorder-bot');
    expect(log.length).toBeGreaterThan(4);
    const tampered = log.slice();
    // Swap two cards while keeping the timestamps: a plausible-looking forgery.
    const a = { ...tampered[1] };
    const b = { ...tampered[3] };
    tampered[1] = { ...a, cardId: b.cardId };
    tampered[3] = { ...b, cardId: a.cardId };
    if (a.cardId !== b.cardId) {
      const { sim, illegal } = runMatch(cfg, tampered, aiUpdate);
      const original = runMatch(cfg, log, aiUpdate).sim.hash();
      // Either the forgery is refused outright, or it simply produces a different match —
      // and the server reports *its* result, not the client's claim. Both are safe.
      expect(illegal !== null || sim.hash() !== original).toBe(true);
    }
  });

  it('a client claiming victory changes nothing — the server derives the result itself', () => {
    const cfg = cfgFor('claim', 0);
    // Empty log: the player did nothing at all.
    const { sim } = runMatch(cfg, [], aiUpdate);
    expect(['lose', 'draw']).toContain(sim.state.endResult);
  });
});

describe('save sanitization (§5 caps)', () => {
  it('clamps gold, gems and trophies, and flags each change', () => {
    const { save, flags } = sanitizeSave({ ...defaultState(), gold: 9_999_999, gem: 500_000, trophies: 99_999 });
    expect(save.gold).toBe(SAVE_CAPS.gold);
    expect(save.gem).toBe(SAVE_CAPS.gem);
    expect(save.trophies).toBe(SAVE_CAPS.trophies);
    expect(flags.some((f) => f.startsWith('gold:'))).toBe(true);
    expect(flags.some((f) => f.startsWith('gem:'))).toBe(true);
    expect(flags.some((f) => f.startsWith('trophies:'))).toBe(true);
  });

  it('treats a missing music flag as "never asked" rather than "turned off"', () => {
    expect(defaultState().music).toBe(true);
    // Every save written before the setting existed lacks the field. Coercing it the way `sfx`
    // is coerced would launch all of them silent, which reads as a bug rather than a choice.
    const legacy = { ...defaultState() } as Record<string, unknown>;
    delete legacy.music;
    expect(sanitizeSave(legacy).save.music).toBe(true);
    // An explicit false is still honoured.
    expect(sanitizeSave({ ...defaultState(), music: false }).save.music).toBe(false);
    expect(sanitizeSave({ ...defaultState(), music: 'yes' }).save.music).toBe(true);
  });

  it('leaves an honest save untouched and unflagged', () => {
    const s = defaultState();
    s.gold = 3200;
    s.gem = 240;
    s.trophies = 812;
    s.best = 900;
    const { save, flags } = sanitizeSave(s);
    expect(flags).toEqual([]);
    expect(save.gold).toBe(3200);
    expect(save.gem).toBe(240);
    expect(save.trophies).toBe(812);
    expect(save.best).toBe(900);
    expect(save.deck).toEqual(s.deck);
  });

  it('clamps card levels to the rarity cap and drops unknown cards', () => {
    const s = defaultState();
    s.cards.ironclad = { lv: 99, cnt: -50 };
    (s.cards as Record<string, { lv: number; cnt: number }>).not_a_card = { lv: 5, cnt: 5 };
    const { save, flags } = sanitizeSave(s);
    expect(save.cards.ironclad.lv).toBe(13);
    expect(save.cards.ironclad.cnt).toBe(0);
    expect(save.cards.not_a_card).toBeUndefined();
    expect(flags).toContain('unknown-card:not_a_card');
  });

  it('never lets a client assert a wallet or negative currency', () => {
    const { save } = sanitizeSave({
      ...defaultState(),
      wallet: '0xdeadbeef',
      walletKind: 'MetaMask',
      gold: -1000,
      gem: -5,
    });
    expect(save.wallet).toBeNull();
    expect(save.walletKind).toBeNull();
    expect(save.gold).toBe(0);
    expect(save.gem).toBe(0);
  });

  it('repairs an illegal deck and caps the pending-chest queue', () => {
    const s = defaultState();
    s.deck = ['ironclad', 'ironclad', 'nonsense'];
    s.pendingChests = ['golden', 'golden', 'golden', 'golden', 'golden', 'golden'] as never;
    const { save, flags } = sanitizeSave(s);
    expect(save.deck).toHaveLength(8);
    expect(new Set(save.deck).size).toBe(8);
    for (const id of save.deck) expect(save.cards[id]).toBeTruthy();
    expect(save.pendingChests).toHaveLength(4);
    expect(flags.some((f) => f.startsWith('deck-repaired'))).toBe(true);
  });

  it('rejects a back-dated free-chest timer but tolerates a normal one', () => {
    const now = Date.now();
    const { save } = sanitizeSave({ ...defaultState(), freeChestAt: -1 });
    expect(save.freeChestAt).toBe(0);
    const ok = sanitizeSave({ ...defaultState(), freeChestAt: now + 3600_000 });
    expect(ok.save.freeChestAt).toBe(now + 3600_000);
  });

  it('survives total garbage without throwing', () => {
    for (const junk of [null, undefined, 0, 'x', [], { cards: 5, deck: 'no' }]) {
      const { save } = sanitizeSave(junk);
      expect(save.deck).toHaveLength(8);
      expect(save.gold).toBeGreaterThanOrEqual(0);
      expect(Object.keys(save.cards).length).toBeGreaterThan(0);
    }
  });
});
