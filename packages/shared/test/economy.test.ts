/**
 * Economy suite. These numbers are what players see in the shop's published drop rates
 * (handoff §7 requires they stay published and honest), and what the server pays out.
 */
import { describe, expect, it } from 'vitest';

import { CARDS, CHESTS, LOGIN_REWARDS, RARITY } from '../src/data.js';
import {
  MAX_PENDING_CHESTS, addXp, applyMatchRewards, bumpQuest, claimLogin, claimQuest, grantChest,
  pickRarity, rollChest, rollQuests, upgradeCard,
} from '../src/economy.js';
import { Rng } from '../src/rng.js';
import { defaultState } from '../src/state.js';
import { dayKey, xpNeed } from '../src/util.js';
import type { ChestKey } from '../src/types.js';

const ALL_CHESTS: ChestKey[] = ['wooden', 'silver', 'golden', 'magical', 'legend'];

describe('chest rolls', () => {
  it('always deals exactly the advertised number of cards', () => {
    for (const kind of ALL_CHESTS) {
      for (let n = 0; n < 400; n++) {
        const res = rollChest(new Rng(`${kind}-${n}`), kind);
        const total = res.cards.reduce((a, c) => a + c.n, 0);
        expect(total, `${kind} run ${n}`).toBe(CHESTS[kind].cards);
        expect(res.cards.every((c) => c.n > 0)).toBe(true);
      }
    }
  });

  it('keeps gold and gems inside the published ranges', () => {
    for (const kind of ALL_CHESTS) {
      const k = CHESTS[kind];
      for (let n = 0; n < 300; n++) {
        const res = rollChest(new Rng(`money-${kind}-${n}`), kind);
        expect(res.gold).toBeGreaterThanOrEqual(k.gold[0]);
        expect(res.gold).toBeLessThanOrEqual(k.gold[1]);
        expect(res.gem).toBeGreaterThanOrEqual(k.gem[0]);
        expect(res.gem).toBeLessThanOrEqual(k.gem[1]);
      }
    }
  });

  it('honours every rarity guarantee', () => {
    for (const [kind, want] of [['golden', 'rare'], ['magical', 'epic'], ['legend', 'legendary']] as const) {
      for (let n = 0; n < 300; n++) {
        const res = rollChest(new Rng(`guar-${kind}-${n}`), kind);
        expect(res.cards.some((c) => c.rar === want), `${kind} run ${n} missed its ${want}`).toBe(true);
      }
    }
  });

  it('never drops the hidden behemoth_mini', () => {
    for (const kind of ALL_CHESTS) {
      for (let n = 0; n < 200; n++) {
        const res = rollChest(new Rng(`hidden-${kind}-${n}`), kind);
        expect(res.cards.some((c) => c.id === 'behemoth_mini')).toBe(false);
        for (const c of res.cards) expect(CARDS.some((x) => x.id === c.id)).toBe(true);
      }
    }
  });

  it('is reproducible from its seed — the server can re-issue the same chest', () => {
    const a = rollChest(new Rng('chest-seed-42'), 'magical');
    const b = rollChest(new Rng('chest-seed-42'), 'magical');
    expect(a).toEqual(b);
    const c = rollChest(new Rng('chest-seed-43'), 'magical');
    expect(JSON.stringify(a) === JSON.stringify(c)).toBe(false);
  });

  it('rarity distribution tracks the published odds', () => {
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const N = 200_000;
    const rng = new Rng('odds');
    for (let i = 0; i < N; i++) counts[pickRarity(rng)]++;
    for (const k of ['common', 'rare', 'epic', 'legendary'] as const) {
      expect(counts[k] / N, `${k} rate`).toBeCloseTo(RARITY[k].odds, 2);
    }
  });

  it('grantChest credits the save and marks first-time cards', () => {
    const s = defaultState();
    const before = s.gold;
    const res = rollChest(new Rng('grant'), 'golden');
    grantChest(s, res);
    expect(s.gold).toBe(before + res.gold);
    expect(s.stats.chests).toBe(1);
    for (const c of res.cards) expect(s.cards[c.id].cnt).toBeGreaterThanOrEqual(c.n);
    // Anything the starter account didn't own must be flagged new exactly once.
    const starter = Object.keys(defaultState().cards);
    for (const c of res.cards) {
      if (!starter.includes(c.id)) expect(c.isNew).toBe(true);
    }
  });
});

describe('quests', () => {
  it('draws 3 distinct quests and quantises the damage goal to 500s', () => {
    for (let n = 0; n < 200; n++) {
      const s = defaultState();
      rollQuests(new Rng(`q-${n}`), s, '2026-1-1');
      expect(s.quests.list).toHaveLength(3);
      expect(new Set(s.quests.list.map((q) => q.id)).size).toBe(3);
      expect(s.quests.date).toBe('2026-1-1');
      for (const q of s.quests.list) {
        expect(q.prog).toBe(0);
        expect(q.claimed).toBe(false);
        expect(q.goal).toBeGreaterThan(0);
        if (q.id === 'dmg') {
          expect(q.goal % 500).toBe(0);
          expect(q.goal).toBeGreaterThanOrEqual(2500);
          expect(q.goal).toBeLessThanOrEqual(6000);
        }
      }
    }
  });

  it('progress never exceeds the goal, and claiming pays exactly once', () => {
    const s = defaultState();
    rollQuests(new Rng('claim'), s, dayKey());
    const q = s.quests.list[0];
    bumpQuest(s, q.id, q.goal * 5);
    expect(q.prog).toBe(q.goal);
    const gold = s.gold;
    const paid = claimQuest(s, 0);
    expect(paid).toEqual(q.rw);
    expect(s.gold).toBe(gold + q.rw.gold);
    expect(claimQuest(s, 0)).toBeNull();
    expect(s.gold).toBe(gold + q.rw.gold);
  });

  it('an unfinished quest cannot be claimed', () => {
    const s = defaultState();
    rollQuests(new Rng('unfinished'), s, dayKey());
    expect(claimQuest(s, 0)).toBeNull();
  });
});

describe('login rewards', () => {
  it('advances the 7-day cycle and pays the listed reward', () => {
    const s = defaultState();
    let now = new Date('2026-03-01T09:00:00Z').getTime();
    for (let day = 0; day < 7; day++) {
      const expected = LOGIN_REWARDS[day];
      const gold = s.gold;
      const gem = s.gem;
      const out = claimLogin(s, now)!;
      expect(out.reward).toEqual(expected);
      expect(s.gold).toBe(gold + (expected.gold ?? 0));
      expect(s.gem).toBe(gem + (expected.gem ?? 0));
      expect(out.chest).toBe(expected.chest ?? null);
      now += 864e5;
    }
    expect(s.login.day).toBe(0); // wrapped
    expect(s.login.streak).toBe(7);
  });

  it('cannot be claimed twice in one day', () => {
    const s = defaultState();
    const now = Date.now();
    expect(claimLogin(s, now)).not.toBeNull();
    expect(claimLogin(s, now)).toBeNull();
  });

  it('resets the streak after a missed day but keeps advancing the cycle', () => {
    const s = defaultState();
    const t0 = new Date('2026-03-01T09:00:00Z').getTime();
    claimLogin(s, t0);
    expect(s.login.streak).toBe(1);
    claimLogin(s, t0 + 864e5);
    expect(s.login.streak).toBe(2);
    claimLogin(s, t0 + 3 * 864e5); // skipped a day
    expect(s.login.streak).toBe(1);
    expect(s.login.day).toBe(3);
  });
});

describe('progression', () => {
  it('addXp levels up on the xpNeed curve and carries the remainder', () => {
    const s = defaultState();
    expect(s.lvl).toBe(1);
    const need1 = xpNeed(1);
    expect(addXp(s, need1 - 1)).toBe(0);
    expect(s.lvl).toBe(1);
    expect(addXp(s, 1)).toBe(1);
    expect(s.lvl).toBe(2);
    expect(s.xp).toBe(0);
    const gained = addXp(s, 100_000);
    expect(gained).toBeGreaterThan(5);
    expect(s.xp).toBeLessThan(xpNeed(s.lvl));
  });

  it('upgradeCard spends gold + duplicates, and refuses when short', () => {
    const s = defaultState();
    const rar = RARITY.common;
    s.gold = rar.upCost[1];
    s.cards.ironclad = { lv: 1, cnt: rar.upCards[1] };
    const out = upgradeCard(s, 'ironclad')!;
    expect(out.level).toBe(2);
    expect(s.gold).toBe(0);
    expect(s.cards.ironclad.cnt).toBe(0);
    expect(upgradeCard(s, 'ironclad')).toBeNull(); // no gold, no dupes
    expect(upgradeCard(s, 'stormtitan')).toBeNull(); // not owned
  });

  it('refuses to upgrade past level 13', () => {
    const s = defaultState();
    s.gold = 10_000_000;
    s.cards.ironclad = { lv: 13, cnt: 100_000 };
    expect(upgradeCard(s, 'ironclad')).toBeNull();
  });
});

describe('match rewards', () => {
  it('a win gives +28..33 trophies, a loss -18..-26, a draw 0', () => {
    for (let n = 0; n < 500; n++) {
      const win = applyMatchRewards(new Rng(`w${n}`), defaultState(), 'win', { depl: 0, dmg: 0, crown: 0, elix: 0 });
      expect(win.delta).toBeGreaterThanOrEqual(28);
      expect(win.delta).toBeLessThanOrEqual(33);
      const lose = applyMatchRewards(new Rng(`l${n}`), defaultState(), 'lose', { depl: 0, dmg: 0, crown: 0, elix: 0 });
      expect(lose.delta).toBeGreaterThanOrEqual(-26);
      expect(lose.delta).toBeLessThanOrEqual(-18);
      const draw = applyMatchRewards(new Rng(`d${n}`), defaultState(), 'draw', { depl: 0, dmg: 0, crown: 0, elix: 0 });
      expect(draw.delta).toBe(0);
    }
  });

  it('trophies floor at 0 and best only ever rises', () => {
    const s = defaultState();
    s.trophies = 5;
    s.best = 900;
    applyMatchRewards(new Rng('floor'), s, 'lose', { depl: 0, dmg: 0, crown: 0, elix: 0 });
    expect(s.trophies).toBe(0);
    expect(s.best).toBe(900);
  });

  it('win chests follow 10% golden / 35% silver / 55% wooden', () => {
    const counts: Record<string, number> = { golden: 0, silver: 0, wooden: 0 };
    const N = 40_000;
    for (let n = 0; n < N; n++) {
      const s = defaultState();
      const r = applyMatchRewards(new Rng(`chest${n}`), s, 'win', { depl: 0, dmg: 0, crown: 0, elix: 0 });
      counts[r.chest!]++;
    }
    expect(counts.golden / N).toBeCloseTo(0.1, 2);
    expect(counts.silver / N).toBeCloseTo(0.35, 2);
    expect(counts.wooden / N).toBeCloseTo(0.55, 2);
  });

  it('drops the win chest entirely when the queue is already full at 4', () => {
    const s = defaultState();
    s.pendingChests = ['wooden', 'wooden', 'wooden', 'wooden'];
    const r = applyMatchRewards(new Rng('full'), s, 'win', { depl: 0, dmg: 0, crown: 0, elix: 0 });
    expect(r.chest).toBeNull();
    expect(s.pendingChests).toHaveLength(MAX_PENDING_CHESTS);
  });

  it('feeds match stats into quests and career totals', () => {
    const s = defaultState();
    rollQuests(new Rng('stats'), s, dayKey());
    applyMatchRewards(new Rng('stats2'), s, 'win', { depl: 12, dmg: 3400, crown: 2, elix: 40 });
    expect(s.stats.depl).toBe(12);
    expect(s.stats.dmg).toBe(3400);
    expect(s.stats.crown).toBe(2);
    expect(s.stats.elix).toBe(40);
    expect(s.wins).toBe(1);
  });

  it('is reproducible from its seed', () => {
    const a = applyMatchRewards(new Rng('rep'), defaultState(), 'win', { depl: 1, dmg: 2, crown: 3, elix: 4 });
    const b = applyMatchRewards(new Rng('rep'), defaultState(), 'win', { depl: 1, dmg: 2, crown: 3, elix: 4 });
    expect(a).toEqual(b);
  });
});
