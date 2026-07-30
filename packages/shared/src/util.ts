/**
 * Pure helpers lifted from crown-clash.html §0 (L655-666).
 *
 * `$`/`$$` stayed behind in the client (`apps/web/src/dom.ts`) — this module must import
 * nothing and touch no globals so it can run inside the server's match re-simulation.
 *
 * `rnd`, `rndi` and `pick` are NOT re-exported as free functions on purpose: in the
 * prototype they read `Math.random()`, and any sim code that reached for them would break
 * determinism. Take them off an `Rng` instance instead.
 */

/** L658 — `clamp(v,a,b)` */
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** L659 — `lerp(a,b,t)` */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** L663 — `dist(a,b)` over anything with x/y */
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** L664 — `fmt(n)`: 1.2M / 12.3K / integer */
export const fmt = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(n | 0);

/** L665 — wall clock in ms. Isolated so tests and the server can inject a clock. */
export const nowMs = (): number => Date.now();

/**
 * L666 — `dayKey(d)`: `YYYY-M-D` in **local** time, no zero padding.
 *
 * Quest resets and the login streak both key off this. Kept byte-identical (including the
 * un-padded month/day) because an existing save's `quests.date` / `login.last` strings must
 * keep comparing equal after the port, or every player's streak resets on launch day.
 */
export const dayKey = (d?: Date): string => {
  const x = d || new Date();
  return x.getFullYear() + '-' + (x.getMonth() + 1) + '-' + x.getDate();
};

/** L2381 — XP required to leave King Level `l`. */
export const xpNeed = (l: number): number => 140 + l * 90;

/**
 * L797 — card stat multiplier. Base **1.10**.
 */
export const statMul = (lv: number): number => Math.pow(1.1, lv - 1);

/**
 * L1459 — tower stat multiplier. Base **1.085**, *not* 1.10.
 *
 * Discrepancy D1 in docs/EXTRACTION-PLAN.md: handoff §2 says towers scale at 1.10 like
 * cards, but `startBattle()` writes `Math.pow(1.085, lv-1)`. The prototype is the spec, and
 * the gap compounds — at King Level 13 a 1.10 base would give a 4,000 HP King Tower
 * 13,795 HP instead of 11,014, a ~25% swing in every late-ladder match.
 */
export const towerMul = (lv: number): number => Math.pow(1.085, lv - 1);

/**
 * L2583 — countdown formatting.
 *
 * The prototype emitted `3j 0m` and `45d`: `j` is Indonesian for *jam* (hour) and `d` for
 * *detik* (second), which read as nonsense in an otherwise English UI. Now `3h 0m` / `45s`.
 * The shape of the output is unchanged, so nothing that measures it needs to move.
 */
export const hms = (ms: number): string => {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m > 0 ? m + 'm' : s + 's';
};
