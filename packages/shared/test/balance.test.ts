/**
 * Difficulty curve.
 *
 * The prototype set the opponent's card level to `1 + floor(trophies / 240)` — **linear** in
 * trophies. Upgrades cost roughly double per level, which makes a player's power
 * **logarithmic** in what they earn. Curves shaped like that diverge, and they diverged badly:
 * by Royal Arena the AI held a 2.66x stat advantage and by Legendary Arena 3.80x. The ladder
 * was not hard past Ember Forge, it was shut.
 *
 * The fix was to anchor `aiLevelFor` to measured player progression. This test is what stops
 * that anchoring from quietly rotting: it re-derives the player's real curve by *playing the
 * economy* — the same `applyMatchRewards`, `rollChest`, `grantChest` and `upgradeCard` the
 * server runs — and fails if any arena drifts outside the band it was tuned for.
 *
 * So it is not a test of `aiLevelFor` in isolation. It is a test of `aiLevelFor` **against the
 * economy**, which means changing a chest's contents, an upgrade cost or a trophy payout can
 * fail it. That is the point: those are exactly the edits that silently break difficulty, and
 * there is no other alarm anywhere that would go off.
 */
import { describe, expect, it } from 'vitest';

import {
  AI_DECKS,
  AI_DECKS_PER_TIER,
  AI_TIERS,
  ARENAS,
  CARD,
  MAX_CARD_LEVEL,
  RARITY,
  Rng,
  aiDeckIndexFor,
  aiLevelFor,
  applyMatchRewards,
  checkQuests,
  claimLogin,
  claimQuest,
  dayKey,
  defaultState,
  grantChest,
  questsReady,
  rollChest,
  statMul,
  upgradeCard,
} from '../src/index.js';
import type { SaveState } from '../src/index.js';

/**
 * Play the economy to `target` trophies and report the deck level the player has on arrival.
 *
 * Deliberately generous at every choice: a 55% win rate, 25 matches a day, six free chests
 * claimed daily, every quest and login reward taken, and gold always spent on the cheapest
 * available upgrade (which maximises levels per gold). Whatever this returns is therefore an
 * *upper bound* on a real player. If the AI outpaces this, it outpaces everybody.
 */
function playTo(target: number, seed = 20260730): number {
  const rng = new Rng(seed);
  const s = defaultState();
  const startMs = Date.UTC(2026, 0, 1);

  for (let day = 1; day <= 400; day++) {
    const now = startMs + day * 864e5;
    checkQuests(rng, s, dayKey(new Date(now)));
    const login = claimLogin(s, now);
    if (login?.chest) grantChest(s, rollChest(rng, login.chest));

    for (let i = 0; i < 25; i++) {
      const win = rng.random() < 0.55;
      applyMatchRewards(rng, s, win ? 'win' : 'lose', { depl: 14, dmg: 2400, crown: win ? 2 : 1, elix: 60 });
      // Opened as they arrive: the pending queue caps at 4 and silently drops the overflow, so
      // a player who lets it fill earns strictly less than this.
      for (const c of s.pendingChests.splice(0)) grantChest(s, rollChest(rng, c));
    }
    for (let i = 0; i < 6; i++) grantChest(s, rollChest(rng, 'wooden'));

    while (questsReady(s)) {
      let claimed = false;
      for (let i = 0; i < s.quests.list.length; i++) {
        const q = s.quests.list[i];
        if (!q.claimed && q.prog >= q.goal && claimQuest(s, i)) claimed = true;
      }
      if (!claimed) break;
    }
    spendEverything(s);
    if (s.trophies >= target) break;
  }
  const levels = s.deck.map((cid) => s.cards[cid]?.lv ?? 1);
  return levels.reduce((a, b) => a + b, 0) / levels.length;
}

function spendEverything(s: SaveState): void {
  for (;;) {
    let best: string | null = null;
    let bestCost = Infinity;
    for (const cid of s.deck) {
      const st = s.cards[cid];
      if (!st || st.lv >= MAX_CARD_LEVEL) continue;
      const rar = RARITY[CARD[cid].r];
      const need = rar.upCards[st.lv] ?? Infinity;
      const cost = rar.upCost[st.lv] ?? Infinity;
      if (st.cnt >= need && s.gold >= cost && cost < bestCost) {
        best = cid;
        bestCost = cost;
      }
    }
    if (!best) return;
    upgradeCard(s, best);
  }
}

/** Both HP and damage scale by `statMul`, so combat power moves with the square of the ratio. */
const advantage = (aiLevel: number, playerLevel: number): number =>
  (statMul(aiLevel) / statMul(playerLevel)) ** 2;

describe('the opponent never outgrows the player', () => {
  /**
   * The band the curve was tuned to.
   *
   * Below 1.0 the opponent is behind the player, which is intended for the first two arenas —
   * a new account should win most of its early matches. Above that it climbs, but never past
   * 1.6x, which is roughly "you must play well" rather than "you must have spent money".
   */
  const BANDS: { trophies: number; min: number; max: number }[] = [
    { trophies: 300, min: 0.6, max: 1.0 },
    { trophies: 700, min: 0.6, max: 1.05 },
    { trophies: 1200, min: 0.75, max: 1.2 },
    { trophies: 1800, min: 0.85, max: 1.35 },
    { trophies: 2600, min: 0.9, max: 1.5 },
    { trophies: 3600, min: 0.9, max: 1.6 },
  ];

  for (const band of BANDS) {
    it(`is fair at ${band.trophies} trophies`, () => {
      const player = playTo(band.trophies);
      const adv = advantage(aiLevelFor(band.trophies), player);
      expect(
        adv,
        `at ${band.trophies}🏆 the player has deck level ${player.toFixed(2)}, the AI has ` +
          `${aiLevelFor(band.trophies)} — a ${adv.toFixed(2)}x stat advantage`,
      ).toBeGreaterThan(band.min);
      expect(adv).toBeLessThan(band.max);
    });
  }

  it('is not sensitive to which run of the economy you happen to get', () => {
    // Three different seeds through the same model. If the curve only survives one lucky
    // chest sequence it is not calibrated, it is fitted.
    for (const seed of [1, 777, 20260730]) {
      const player = playTo(2600, seed);
      expect(advantage(aiLevelFor(2600), player), `seed ${seed}`).toBeLessThan(1.5);
    }
  });
});

describe('the level curve itself', () => {
  it('never goes backwards as the player climbs', () => {
    let prev = 0;
    for (let t = 0; t <= 5000; t += 25) {
      const lv = aiLevelFor(t);
      expect(lv, `level fell at ${t} trophies`).toBeGreaterThanOrEqual(prev);
      prev = lv;
    }
  });

  it('starts at level 1 and never exceeds the card cap', () => {
    expect(aiLevelFor(0)).toBe(1);
    expect(aiLevelFor(-500)).toBe(1);
    expect(aiLevelFor(999_999)).toBeLessThanOrEqual(MAX_CARD_LEVEL);
  });

  it('has no cliffs — one step of trophies never jumps more than one level', () => {
    // A jump of 2+ at some threshold means a player crossing it loses matches they were
    // winning a moment earlier, for no reason they can see.
    for (let t = 0; t <= 5000; t += 1) {
      expect(aiLevelFor(t + 1) - aiLevelFor(t), `cliff at ${t}`).toBeLessThanOrEqual(1);
    }
  });

  it('is gentler than the prototype everywhere it mattered', () => {
    const old = (t: number): number => Math.min(13, Math.max(1, 1 + Math.floor(t / 240)));
    for (const t of [1200, 1800, 2600, 3600]) {
      expect(aiLevelFor(t), `at ${t} trophies`).toBeLessThan(old(t));
    }
  });
});

describe('opponent variety', () => {
  it('offers more than one deck at every arena past the first', () => {
    for (let arena = 1; arena < ARENAS.length; arena++) {
      const rng = new Rng(4242 + arena);
      const seen = new Set<number>();
      for (let i = 0; i < 200; i++) seen.add(aiDeckIndexFor(arena, rng));
      expect(seen.size, `arena ${arena} only ever offers ${seen.size} deck(s)`).toBeGreaterThan(1);
    }
  });

  it('never offers a deck from a tier above the player’s arena', () => {
    for (let arena = 0; arena < ARENAS.length; arena++) {
      const rng = new Rng(99 + arena);
      const tier = Math.min(arena, AI_TIERS - 1);
      const highest = tier * AI_DECKS_PER_TIER + (AI_DECKS_PER_TIER - 1);
      for (let i = 0; i < 200; i++) {
        expect(aiDeckIndexFor(arena, rng), `arena ${arena}`).toBeLessThanOrEqual(highest);
      }
    }
  });

  it('always returns a real deck, for any arena index', () => {
    const rng = new Rng(7);
    for (let arena = -3; arena < 20; arena++) {
      for (let i = 0; i < 50; i++) {
        const idx = aiDeckIndexFor(arena, rng);
        expect(AI_DECKS[idx], `arena ${arena} gave index ${idx}`).toBeTruthy();
      }
    }
  });

  it('is deterministic without an rng, so fixtures and re-simulation stay reproducible', () => {
    for (let arena = 0; arena < ARENAS.length; arena++) {
      expect(aiDeckIndexFor(arena)).toBe(aiDeckIndexFor(arena));
    }
  });
});
