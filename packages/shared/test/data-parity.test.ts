/**
 * The drift test the handoff demands (§1: "Write a test that regex-extracts the constants
 * from the HTML and diffs them against data.ts so drift is impossible"; §9: "Diff test
 * proving data.ts matches the HTML constants passes").
 *
 * Approach: pull each constant's source text straight out of reference/crown-clash.html,
 * evaluate it in an isolated scope with only the dependencies it needs, and deep-equal the
 * result against what data.ts exports. No hand-maintained expectation lists — the prototype
 * is the expectation. Change a number in data.ts and this fails; change one in the HTML and
 * it also fails, which is what you want, because the HTML is the spec.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  AH, AI_DECKS, AI_DECKS_PER_TIER, AI_NAMES, AI_TIERS, ARENAS, AW, BRIDGE, CARD, CARDS, CHESTS,
  LOGIN_REWARDS, QUEST_POOL,
  RARITY, RIV_B, RIV_T, SHOP, SPD, TOWER_DEF, TOWER_POS, BEHEMOTH_MINI, arenaFor,
} from '../src/data.js';
import { defaultState, STARTER_CARDS } from '../src/state.js';
import { statMul, towerMul, xpNeed } from '../src/util.js';

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'reference', 'crown-clash.html'),
  'utf8',
);

/**
 * Grab `const <name> = <literal>;` from the prototype and evaluate it.
 * `deps` supplies whatever the literal references (e.g. `SPD` inside `CARDS`).
 */
function evalConst(name: string, deps: Record<string, unknown> = {}): unknown {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*`, 'g');
  const m = re.exec(HTML);
  if (!m) throw new Error(`could not locate "const ${name}" in crown-clash.html`);
  const start = m.index + m[0].length;

  // Walk forward balancing brackets so we capture exactly the literal, quotes-aware.
  let depth = 0;
  let i = start;
  let inStr: string | null = null;
  for (; i < HTML.length; i++) {
    const ch = HTML[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) break;
    if (depth === 0 && ch === '\n') {
      // A top-level newline right after a balanced literal ends the declaration.
      const rest = HTML.slice(start, i).trim();
      if (rest && !rest.endsWith(',') && depth === 0 && /[}\]0-9'"]$/.test(rest)) break;
    }
  }
  const src = HTML.slice(start, i);
  const keys = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `"use strict"; return (${src});`);
  return fn(...keys.map((k) => deps[k]));
}

/** Strip `undefined`-valued keys so optional TS fields compare equal to absent JS ones. */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

describe('data.ts is verbatim from crown-clash.html', () => {
  it('RARITY — odds and every upgrade table entry', () => {
    const html = evalConst('RARITY') as typeof RARITY;
    expect(clean(RARITY)).toEqual(clean(html));
    // Belt and braces: the published drop rates must sum to 1.
    const sum = (['common', 'rare', 'epic', 'legendary'] as const).reduce((a, k) => a + RARITY[k].odds, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('SPD', () => {
    expect(clean(SPD)).toEqual(clean(evalConst('SPD')));
  });

  it('CARDS — all 21, every stat', () => {
    const html = evalConst('CARDS', { SPD }) as typeof CARDS;
    expect(html).toHaveLength(21);
    expect(CARDS).toHaveLength(21);
    expect(clean(CARDS)).toEqual(clean(html));
  });

  it('CARDS — per-card field-by-field diff (readable failure)', () => {
    const html = evalConst('CARDS', { SPD }) as typeof CARDS;
    for (let i = 0; i < html.length; i++) {
      expect({ i, card: clean(CARDS[i]) }).toEqual({ i, card: clean(html[i]) });
    }
  });

  it('behemoth_mini — the hidden 22nd card', () => {
    const line = /CARD\.behemoth_mini\s*=\s*/.exec(HTML);
    expect(line).toBeTruthy();
    const start = line!.index + line![0].length;
    const end = HTML.indexOf('\n\nconst AI_DECKS', start);
    const src = HTML.slice(start, end).trim().replace(/;$/, '');
    // eslint-disable-next-line no-new-func
    const html = new Function('SPD', `"use strict"; return (${src});`)(SPD);
    expect(clean(BEHEMOTH_MINI)).toEqual(clean(html));
    expect(CARD.behemoth_mini).toBeTruthy();
    // ...and it must never be reachable through the playable list.
    expect(CARDS.some((c) => c.id === 'behemoth_mini')).toBe(false);
  });

  it('ARENAS — thresholds and palettes', () => {
    expect(clean(ARENAS)).toEqual(clean(evalConst('ARENAS')));
    expect(ARENAS.map((a) => a.t)).toEqual([0, 300, 700, 1200, 1800, 2600, 3600]);
    // D6: the array order really does put Frozen Peak at 1200.
    expect(ARENAS[3].n).toBe('Frozen Peak');
  });

  it('CHESTS — counts, gold/gem ranges and guarantees', () => {
    expect(clean(CHESTS)).toEqual(clean(evalConst('CHESTS')));
    expect(CHESTS.golden.guar).toBe('rare');
    expect(CHESTS.magical.guar).toBe('epic');
    expect(CHESTS.legend.guar).toBe('legendary');
  });

  it('QUEST_POOL', () => {
    expect(clean(QUEST_POOL)).toEqual(clean(evalConst('QUEST_POOL')));
  });

  it('LOGIN_REWARDS — the 7-day cycle', () => {
    expect(clean(LOGIN_REWARDS)).toEqual(clean(evalConst('LOGIN_REWARDS')));
    expect(LOGIN_REWARDS).toHaveLength(7);
  });

  it('SHOP prices', () => {
    expect(clean(SHOP)).toEqual(clean(evalConst('SHOP')));
  });

  it('TOWER_DEF and TOWER_POS', () => {
    expect(clean(TOWER_DEF)).toEqual(clean(evalConst('TOWER_DEF')));
    expect(clean(TOWER_POS)).toEqual(clean(evalConst('TOWER_POS')));
  });

  /**
   * AI_DECKS is the one constant in this file allowed to *grow* past the prototype (D11 in
   * docs/EXTRACTION-PLAN.md).
   *
   * The prototype's six decks are still here, unchanged, and this test proves it. But six
   * decks picked by a pure function of arena index meant a player met the same eight cards
   * every match for an entire arena, so six more were added and the choice is now randomised
   * within a tier band. Nothing about any *card* changed — these are new hands dealt from the
   * same 21 — so the balance the parity suite exists to protect is untouched.
   */
  it('AI_DECKS keeps every prototype deck, and everything added is playable', () => {
    const original = clean(evalConst('AI_DECKS')) as string[][];
    const mine = clean(AI_DECKS) as string[][];
    const key = (d: string[]): string => d.join('|');
    const present = new Set(mine.map(key));
    for (const deck of original) {
      expect(present.has(key(deck)), `prototype deck dropped: ${key(deck)}`).toBe(true);
    }
    expect(mine.length).toBeGreaterThanOrEqual(original.length);
    expect(clean(AI_NAMES)).toEqual(clean(evalConst('AI_NAMES')));

    // Every deck, old or new, must be playable: 8 distinct real cards.
    for (const deck of AI_DECKS) {
      expect(deck).toHaveLength(8);
      expect(new Set(deck).size, `duplicate card in ${key(deck)}`).toBe(8);
      for (const id of deck) expect(CARD[id], `AI deck references unknown card ${id}`).toBeTruthy();
    }
    // Tiers have to divide evenly or `aiDeckIndexFor`'s banding silently skips decks.
    expect(AI_DECKS.length % AI_DECKS_PER_TIER).toBe(0);
    expect(AI_TIERS).toBe(AI_DECKS.length / AI_DECKS_PER_TIER);
  });

  it('arena geometry scalars', () => {
    const line = /const AW=(\S+?), AH=(\S+?), RIV_T=(\S+?), RIV_B=(\S+?), BRIDGE=\[(.+?)\];/.exec(HTML);
    expect(line).toBeTruthy();
    expect(AW).toBe(Number(line![1]));
    expect(AH).toBe(Number(line![2]));
    expect(RIV_T).toBe(Number(line![3]));
    expect(RIV_B).toBe(Number(line![4]));
    expect(BRIDGE).toEqual(line![5].split(',').map(Number));
  });

  it('defaultState matches the prototype (1200 gold, 120 gems, 12 cards, 8-card deck)', () => {
    const s = defaultState();
    expect(s.gold).toBe(1200);
    expect(s.gem).toBe(120);
    expect(Object.keys(s.cards)).toHaveLength(12);
    expect(s.deck).toHaveLength(8);
    // The starter list is copied out of L791 rather than restated.
    const m = /\[([^\]]+)\]\s*\n\s*\.forEach\(id=>\s*st\.cards\[id\]=\{lv:1,cnt:0\}\)/.exec(HTML);
    expect(m).toBeTruthy();
    const ids = m![1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
    expect(STARTER_CARDS).toEqual(ids);
    const deckM = /deck:\[([^\]]+)\]/.exec(HTML);
    expect(s.deck).toEqual(deckM![1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')));
  });

  it('level scaling — cards 1.10, towers 1.085 (discrepancy D1)', () => {
    expect(/function statMul\(lv\)\{\s*return Math\.pow\(1\.10,\s*lv-1\);\s*\}/.test(HTML)).toBe(true);
    expect(/const m=Math\.pow\(1\.085,\s*lv-1\);/.test(HTML)).toBe(true);
    expect(statMul(1)).toBe(1);
    expect(statMul(13)).toBeCloseTo(Math.pow(1.1, 12), 12);
    expect(towerMul(13)).toBeCloseTo(Math.pow(1.085, 12), 12);
    // If these ever became the same function, a level-13 King Tower would gain ~25% HP.
    expect(towerMul(13)).not.toBeCloseTo(statMul(13), 3);
  });

  it('xpNeed matches L2381', () => {
    const m = /function xpNeed\(l\)\{ return (.+?); \}/.exec(HTML);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-new-func
    const fn = new Function('l', `return ${m![1]};`) as (l: number) => number;
    for (let l = 1; l <= 30; l++) expect(xpNeed(l)).toBe(fn(l));
  });

  it('arenaFor picks the same arena as the prototype for every trophy count', () => {
    for (let t = 0; t <= 5000; t += 7) {
      const { i } = arenaFor(t);
      let expected = 0;
      ARENAS.forEach((x, k) => {
        if (t >= x.t) expected = k;
      });
      expect(i).toBe(expected);
    }
  });
});
