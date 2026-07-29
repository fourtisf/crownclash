/**
 * AI opponent — port of crown-clash.html L1979-2034.
 *
 * Transcribed statement-for-statement, including the short-circuits. That matters more than
 * it looks: `wantPush = el>=8 || (el>=6 && Math.random()<A.agg) || …` only draws from the
 * random stream when the first clause is false. Reordering or "simplifying" those conditions
 * changes how many numbers the AI consumes, which desynchronises the server's re-simulation
 * from the client's play-through even though the logic looks equivalent.
 */
import { AW, CARD, RIV_B, RIV_T, SPELL_IDS } from './data.js';
import type { Sim } from './sim.js';
import { clamp, dist, lerp } from './util.js';
import type { Card, Unit } from './types.js';

/** L1981 — first hand slot whose card satisfies `pred`, or -1. */
function aiHandIdx(sim: Sim, pred: (c: Card, i: number) => boolean): number {
  const hand = sim.state.aiHand;
  for (let i = 0; i < hand.length; i++) {
    if (pred(CARD[hand[i]], i)) return i;
  }
  return -1;
}

/** L1991-2034 — one AI decision tick. */
export function aiUpdate(sim: Sim, dt: number): void {
  const B = sim.state;
  const A = B.ai;
  A.timer -= dt;
  if (A.timer > 0) return;
  // Higher skill → thinks more often (1.5 s down to 0.45 s), plus jitter.
  A.timer = lerp(1.5, 0.45, A.skill) + sim.rng.rnd(0, 0.5);

  const el = B.elix[1];
  // Anything of the player's that has crossed into, or near, the AI's half.
  const threats: Unit[] = B.units.filter(
    (u) => u.team === 0 && !u.dead && (u.kind === 'troop' || u.kind === 'build') && u.y < RIV_B + 3.4,
  );

  /* 1. spell a clump */
  if (threats.length >= 3 && sim.rng.random() < A.skill) {
    let bx = 0;
    let by = 0;
    threats.forEach((t) => {
      bx += t.x;
      by += t.y;
    });
    bx /= threats.length;
    by /= threats.length;
    const tight = threats.filter((t) => dist(t, { x: bx, y: by }) < 2.2).length;
    if (tight >= 3) {
      const si = aiHandIdx(sim, (c) => SPELL_IDS.indexOf(c.id) >= 0 && c.cost <= el);
      if (si >= 0 && sim.aiPlay(si, bx, by)) return;
    }
  }

  /* 2. defend */
  if (threats.length) {
    let big = threats[0];
    threats.forEach((t) => {
      if (t.maxHp > big.maxHp) big = t;
    });
    const lane = big.x < AW / 2 ? 1 : -1;
    const di = aiHandIdx(sim, (c) => c.t === 'troop' && c.tg !== 'build' && c.cost <= el && c.cost <= 6);
    if (di >= 0) {
      const x = clamp(big.x + sim.rng.rnd(-0.6, 0.6), 1.5, AW - 1.5);
      const y = clamp(big.y - 2.6, 1.5, RIV_T - 1.0);
      if (sim.aiPlay(di, x, y)) return;
    }
    const bi = aiHandIdx(sim, (c) => c.t === 'build' && c.cost <= el);
    if (bi >= 0 && sim.aiPlay(bi, 9 + lane * 1.6, 9.4)) return;
  }

  /* 3. push */
  const wantPush =
    el >= 8 || (el >= 6 && sim.rng.random() < A.agg) || (el >= 4 && sim.rng.random() < A.agg * 0.4);
  if (wantPush) {
    const lane = sim.rng.random() < 0.5 ? 3.3 : 14.7;
    // `ti` and `wi` share a predicate in the prototype — the second lookup is redundant but
    // it is reached only when the first attempt failed to deploy, so removing it would change
    // which card gets played. Kept.
    const ti = aiHandIdx(sim, (c) => c.tg === 'build' && c.t === 'troop' && c.cost <= el);
    if (ti >= 0 && el >= 6) {
      if (sim.aiPlay(ti, lane, 3.9)) return;
    }
    const wi = aiHandIdx(sim, (c) => c.tg === 'build' && c.t === 'troop' && c.cost <= el);
    if (wi >= 0 && el >= CARD[B.aiHand[wi]].cost + 2) {
      if (sim.aiPlay(wi, lane, RIV_T - 1.4)) return;
    }
    const ai2 = aiHandIdx(sim, (c) => c.t === 'troop' && c.cost <= el);
    if (ai2 >= 0) {
      const supportY = el >= 8 ? 4.6 : RIV_T - 1.5;
      if (sim.aiPlay(ai2, lane + sim.rng.rnd(-1, 1), supportY)) return;
    }
  }

  /* 4. chip the tower when elixir would otherwise cap */
  if (el >= 9) {
    const si = aiHandIdx(sim, (c) => c.t === 'spell' && c.cost <= el);
    if (si >= 0) {
      const tgt = sim.towerAlive(0, 'L') ? { x: 3.3, y: 23.4 } : { x: 14.7, y: 23.4 };
      sim.aiPlay(si, tgt.x, tgt.y);
    }
  }
}
