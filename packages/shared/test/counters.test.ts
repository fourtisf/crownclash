/**
 * Card matchups.
 *
 * The value of this feature is entirely in being *right*: a hint that tells a new player to
 * answer a Behemoth with Twin Archers is worse than no hint, because they will believe it.
 *
 * So the tests below are not about the arithmetic. They assert the handful of things that must
 * hold no matter how the numbers are tuned — a ground-only unit is never advertised as an
 * answer to a flier, a build-seeker is never advertised as a defender — plus the specific
 * matchups the whole feature exists to teach.
 */
import { describe, expect, it } from 'vitest';

import { CARD, CARDS, advantage, matchups } from '../src/index.js';
import type { Card } from '../src/index.js';

const strongOf = (id: string): string[] => matchups(CARD[id]).strong;
const weakOf = (id: string): string[] => matchups(CARD[id]).weak;

describe('matchup lists', () => {
  it('gives every card at least one piece of advice', () => {
    for (const c of CARDS) {
      const m = matchups(c);
      expect(m.strong.length + m.weak.length, `${c.n} has nothing to say`).toBeGreaterThan(0);
    }
  });

  it('never lists more than three, and never lists the card itself', () => {
    for (const c of CARDS) {
      const m = matchups(c);
      expect(m.strong.length).toBeLessThanOrEqual(3);
      expect(m.weak.length).toBeLessThanOrEqual(3);
      expect(m.strong).not.toContain(c.id);
      expect(m.weak).not.toContain(c.id);
    }
  });

  it('only ever names real cards, never the hidden Behemoth shard', () => {
    const real = new Set(CARDS.map((c) => c.id));
    for (const c of CARDS) {
      for (const id of [...matchups(c).strong, ...matchups(c).weak]) {
        expect(real.has(id), `${c.n} -> ${id}`).toBe(true);
      }
    }
  });

  it('is stable — the same card asked twice gives the same answer', () => {
    expect(matchups(CARD.behemoth)).toEqual(matchups(CARD.behemoth));
  });
});

describe('rules that cannot be violated whatever the balance is', () => {
  const canReach = (a: Card, b: Card): boolean => {
    if (a.t === 'spell') return true;
    const tg = a.tg ?? 'ground';
    if (tg === 'build') return b.t === 'build';
    if (b.fly) return tg === 'both';
    return true;
  };

  it('never suggests a card as the answer to something it physically cannot hit', () => {
    for (const c of CARDS) {
      for (const id of strongOf(c.id)) {
        expect(canReach(c, CARD[id]), `${c.n} cannot hit ${CARD[id].n}`).toBe(true);
      }
      // And the mirror: nothing is ever listed as beating this card unless it can hit it.
      for (const id of weakOf(c.id)) {
        expect(canReach(CARD[id], c), `${CARD[id].n} cannot hit ${c.n}`).toBe(true);
      }
    }
  });

  it('scores a card that cannot touch its opponent as a pure loss of its own elixir', () => {
    // Ironclad is ground-only; Wisps fly. It is not a bad answer, it is not an answer.
    expect(advantage(CARD.ironclad, CARD.wisps)).toBe(-CARD.ironclad.cost);
    // Blademaster has the highest damage in the game and still cannot reach them.
    expect(advantage(CARD.blademaster, CARD.wisps)).toBe(-CARD.blademaster.cost);
  });

  it('never suggests a build-seeker as a defensive answer to a troop', () => {
    for (const id of ['colossus', 'boar', 'behemoth']) {
      expect(CARD[id].tg, `${id} is meant to be a build-seeker`).toBe('build');
      // Turret is the only building in the game, so it is the only thing they may answer.
      expect(strongOf(id).filter((x) => CARD[x].t !== 'build')).toEqual([]);
    }
  });

  it('a spell is never listed as beatable, because nothing can attack one', () => {
    for (const c of CARDS.filter((x) => x.t === 'spell')) {
      expect(weakOf(c.id)).toEqual([]);
    }
    // ...and no troop is ever credited with beating a spell.
    for (const c of CARDS) {
      expect(strongOf(c.id).filter((id) => CARD[id].t === 'spell')).toEqual([]);
    }
  });
});

describe('the matchups the feature exists to teach', () => {
  it('answers the big build-seekers with cheap swarms', () => {
    // The most expensive card in the game loses to the cheapest horde, because it never turns
    // around to fight back. Which of its answers ranks *first* is left alone deliberately —
    // Bone Horde kills it fastest and dies to the blast, Blademaster takes twice as long and
    // walks away, and picking a winner between those two is balance opinion, not arithmetic.
    expect(weakOf('behemoth')).toContain('bones');
    expect(weakOf('colossus')).toContain('bones');
    expect(weakOf('boar')).toContain('sprites');
  });

  it('answers swarms with splash and with spells', () => {
    expect(weakOf('bones')).toContain('volley');
    expect(weakOf('spears')).toContain('jolt');
    // Warden is described on the card as a swarm shredder; it should read that way here too.
    expect(strongOf('warden').length).toBeGreaterThan(0);
    expect(advantage(CARD.warden, CARD.bones)).toBeGreaterThan(0);
  });

  it('answers ground-only heavy hitters with fliers', () => {
    expect(weakOf('blademaster')).toContain('wisps');
    expect(weakOf('lancer')).toContain('wisps');
    expect(weakOf('warden')).toContain('wisps');
  });

  it('lets Sharpshooter out-range the Turret, and nothing else', () => {
    // 6.4 against 5.5. A building cannot step forward, so it never gets a shot back.
    expect(strongOf('sharpshooter')).toContain('turret');
    expect(weakOf('turret')).toContain('sharpshooter');
    // Twin Archers reach 5.4 and Pyromancer 5.4 — both inside the Turret's 5.5, so they trade.
    expect(advantage(CARD.archers, CARD.turret)).toBeLessThan(advantage(CARD.sharpshooter, CARD.turret));
  });

  it('does not call a slow grind an answer', () => {
    // Ironclad does kill a Behemoth one-on-one — in about 37 seconds, by which point the
    // Behemoth has spent 26 of them hitting the tower. Bone Horde does it in six.
    expect(advantage(CARD.bones, CARD.behemoth)).toBeGreaterThan(advantage(CARD.ironclad, CARD.behemoth));
  });

  it('charges a swarm for the Behemoth death blast', () => {
    // 340 damage in 2.2 tiles kills every 95 hp skeleton standing on it. The trade is still
    // excellent, but it costs the horde rather than being free.
    const withBlast = advantage(CARD.bones, CARD.behemoth);
    expect(withBlast).toBeLessThan(CARD.behemoth.cost);
    expect(withBlast).toBeGreaterThan(CARD.behemoth.cost - CARD.bones.cost - 0.01);
  });

  it('credits a spell only when it kills outright', () => {
    // Volley is 250 damage. Wisps have 215 hp and die; Twin Archers have 290 and walk away.
    expect(strongOf('volley')).toContain('wisps');
    expect(strongOf('volley')).not.toContain('archers');
    // Meteor's 620 covers the Archers, so it is their answer where Volley is not.
    expect(strongOf('meteor')).toContain('archers');
  });
});
