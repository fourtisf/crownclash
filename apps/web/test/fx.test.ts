/**
 * FX coverage.
 *
 * The sim and the renderer are joined by a string: `SimEvent`. If someone adds an event kind
 * to the sim and forgets `fx.ts`, nothing fails to compile and nothing throws — the effect
 * just silently never appears, which is exactly the kind of regression a port introduces and
 * nobody notices for a month. This suite plays real matches and asserts that every event the
 * sim actually emits produces the visual the prototype produced.
 *
 * Runs in a plain Node environment: `Snd` no-ops without an AudioContext, and nothing in the
 * art slices touches `window` at import time.
 */
import { describe, expect, it } from 'vitest';

import { RIV_B, Sim, aiUpdate, arenaFor, aiDeckIndexFor, aiLevelFor, STARTER_DECK } from '@crown/shared';
import type { SimConfig, SimEvent } from '@crown/shared';
import { Fx } from '../src/fx';

function cfg(seed: string, trophies = 1500): SimConfig {
  const { i } = arenaFor(trophies);
  const levels: Record<string, number> = {};
  for (const id of STARTER_DECK) levels[id] = 1;
  return {
    seed,
    myDeck: STARTER_DECK.slice(),
    myCardLevels: levels,
    myKingLevel: 1,
    aiDeckIndex: aiDeckIndexFor(i),
    aiLevel: aiLevelFor(trophies),
  };
}

/** Play a match with a naive bot, collecting every event kind the sim emitted. */
function playAndCollect(seed: string): { kinds: Set<string>; fx: Fx; events: SimEvent[] } {
  const sim = new Sim(cfg(seed));
  const fx = new Fx();
  const kinds = new Set<string>();
  const all: SimEvent[] = [];
  let next = 0;

  while (!sim.state.over && sim.state.tick < 9000) {
    if (sim.state.tick >= next) {
      for (let i = 0; i < 4; i++) {
        if (sim.playHand(i, 4 + (sim.state.tick % 9), RIV_B + 2)) {
          next = sim.state.tick + 12;
          break;
        }
      }
    }
    const evs = sim.tick(aiUpdate);
    for (const e of evs) {
      kinds.add(e.k);
      all.push(e);
    }
    fx.apply(evs);
    fx.step(1 / 30);
  }
  return { kinds, fx, events: all };
}

describe('fx replays every event the sim emits', () => {
  it('a real match exercises the full event vocabulary without throwing', () => {
    const seen = new Set<string>();
    for (const seed of ['fx-1', 'fx-2', 'fx-3', 'fx-4', 'fx-5', 'fx-6']) {
      const { kinds } = playAndCollect(seed);
      for (const k of kinds) seen.add(k);
    }
    // These are produced by any ordinary match; if one stops appearing, something upstream
    // broke rather than the test being too strict.
    for (const k of ['deploy', 'ring', 'hit', 'melee', 'shoot', 'projHit', 'death', 'end']) {
      expect(seen, `event "${k}" never occurred across six matches`).toContain(k);
    }
  });

  it('handles every declared event kind, including ones a short match may not reach', () => {
    const fx = new Fx();
    const every: SimEvent[] = [
      { k: 'deploy', cid: 'archers', team: 0, x: 9, y: 20, count: 2 },
      { k: 'ring', x: 9, y: 20, team: 0, r: 0.6 },
      { k: 'spellCast', cid: 'volley', team: 0, x: 9, y: 8 },
      { k: 'spellImpact', cid: 'volley', team: 0, x: 9, y: 8, radius: 4 },
      { k: 'spellImpact', cid: 'meteor', team: 0, x: 9, y: 8, radius: 2.6 },
      { k: 'spellImpact', cid: 'jolt', team: 0, x: 9, y: 8, radius: 2.5 },
      { k: 'hit', x: 9, y: 20, amount: 137, byTeam: 0, rad: 0.3 },
      { k: 'melee', x: 9, y: 20 },
      { k: 'splash', x: 9, y: 20, radius: 1.7 },
      { k: 'chain', x: 9, y: 20 },
      { k: 'shoot', kind: 'arrow' },
      { k: 'projHit', x: 9, y: 20, kind: 'fire' },
      { k: 'death', x: 9, y: 20, team: 1, rad: 0.3 },
      { k: 'deathBlast', x: 9, y: 20, radius: 2.2 },
      { k: 'charged', x: 9, y: 20 },
      { k: 'dash', x: 9, y: 20 },
      { k: 'towerDown', x: 3.3, y: 6.6, team: 1, byTeam: 0 },
      { k: 'phase', phase: 'over' },
      { k: 'end', result: 'win', instant: true },
    ];
    expect(() => fx.apply(every)).not.toThrow();
    expect(fx.parts.length).toBeGreaterThan(0);
    expect(fx.floats.length).toBe(1);
    expect(fx.rings.length).toBe(1);
  });

  it('reproduces the prototype particle counts exactly', () => {
    // hurt() → 1 float + 4 sparks (L1761-1763)
    let fx = new Fx();
    fx.apply([{ k: 'hit', x: 5, y: 10, amount: 92, byTeam: 0, rad: 0.3 }]);
    expect(fx.floats).toHaveLength(1);
    expect(fx.floats[0].txt).toBe('-92');
    expect(fx.floats[0].c).toBe('#ffd964');
    expect(fx.parts).toHaveLength(4);

    // enemy damage floats red (L1761)
    fx = new Fx();
    fx.apply([{ k: 'hit', x: 5, y: 10, amount: 40, byTeam: 1, rad: 0.3 }]);
    expect(fx.floats[0].c).toBe('#ff8a8a');

    // killUnit() non-tower → 12 chunks (L1782)
    fx = new Fx();
    fx.apply([{ k: 'death', x: 5, y: 10, team: 0, rad: 0.4 }]);
    expect(fx.parts).toHaveLength(12);

    // tower death → 60 chunks + shake 14 (L1770-1774)
    fx = new Fx();
    fx.apply([{ k: 'towerDown', x: 3.3, y: 23.4, team: 0, byTeam: 1 }]);
    expect(fx.parts).toHaveLength(60);
    expect(fx.shake).toBe(14);
    expect(fx.toast).toBe('YOUR TOWER FELL!');

    fx = new Fx();
    fx.apply([{ k: 'towerDown', x: 3.3, y: 6.6, team: 1, byTeam: 0 }]);
    expect(fx.toast).toBe('TOWER DOWN!');

    // meteor → 34 embers + 1 ring, shake 10 (L1737-1741)
    fx = new Fx();
    fx.apply([{ k: 'spellImpact', cid: 'meteor', team: 0, x: 9, y: 9, radius: 2.6 }]);
    expect(fx.parts.filter((p) => !p.ring)).toHaveLength(34);
    expect(fx.parts.filter((p) => p.ring)).toHaveLength(1);
    expect(fx.shake).toBe(10);

    // jolt → 16 sparks + ring, shake 5, screen flash .35 (L1742-1747)
    fx = new Fx();
    fx.apply([{ k: 'spellImpact', cid: 'jolt', team: 0, x: 9, y: 9, radius: 2.5 }]);
    expect(fx.parts.filter((p) => !p.ring)).toHaveLength(16);
    expect(fx.shake).toBe(5);
    expect(fx.flash).toBeCloseTo(0.35, 6);

    // volley (the "else" branch) → 24 falling arrows + ring (L1749-1752)
    fx = new Fx();
    fx.apply([{ k: 'spellImpact', cid: 'volley', team: 0, x: 9, y: 9, radius: 4 }]);
    expect(fx.parts.filter((p) => p.arrow)).toHaveLength(24);
    expect(fx.parts.filter((p) => p.ring)).toHaveLength(1);
  });

  it('integrates particles with the prototype gravity and drag (L1968)', () => {
    const fx = new Fx();
    fx.parts.push({ x: 0, y: 0, vx: 10, vy: 0, life: 1, max: 1, c: '#fff', sz: 0.1 });
    const dt = 1 / 30;
    fx.step(dt);
    const p = fx.parts[0];
    expect(p.x).toBeCloseTo(10 * dt, 9);
    expect(p.vy).toBeCloseTo(8 * dt, 9);
    expect(p.vx).toBeCloseTo(10 * 0.96, 9);
    // Rings are static: no gravity, no drift.
    const fx2 = new Fx();
    fx2.parts.push({ x: 3, y: 4, vx: 9, vy: 9, life: 1, max: 1, c: '#fff', sz: 1, ring: 1 });
    fx2.step(dt);
    expect(fx2.parts[0].x).toBe(3);
    expect(fx2.parts[0].y).toBe(4);
  });

  it('expires particles, floats and rings, and decays shake and flash', () => {
    const fx = new Fx();
    fx.apply([
      { k: 'hit', x: 1, y: 1, amount: 10, byTeam: 0, rad: 0.3 },
      { k: 'ring', x: 1, y: 1, team: 0, r: 0.5 },
      { k: 'towerDown', x: 1, y: 1, team: 1, byTeam: 0 },
    ]);
    expect(fx.parts.length).toBeGreaterThan(0);
    for (let i = 0; i < 90; i++) fx.step(1 / 30); // 3 seconds
    expect(fx.parts).toHaveLength(0);
    expect(fx.floats).toHaveLength(0);
    expect(fx.rings).toHaveLength(0);
    expect(fx.shake).toBeLessThan(0.001);
    expect(fx.flash).toBe(0);
  });

  it('never mutates simulation state', () => {
    const sim = new Sim(cfg('fx-purity'));
    const fx = new Fx();
    const before = sim.hash();
    for (let i = 0; i < 200; i++) {
      const evs = sim.tick(aiUpdate);
      const snapshot = sim.hash();
      fx.apply(evs);
      fx.step(1 / 30);
      // Applying effects must not move a unit or change a crown count.
      expect(sim.hash()).toBe(snapshot);
    }
    expect(before).toBeTruthy();
  });
});
