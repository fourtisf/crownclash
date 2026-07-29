/**
 * Seeded RNG.
 *
 * Everything the simulation randomises must come off one of these streams, because the
 * server re-runs a match from `seed + deployLog` and compares its own result against
 * nothing at all — it simply *is* the result (handoff §3.3). A single stray `Math.random()`
 * inside sim code makes re-simulation diverge and voids honest matches.
 *
 * Presentation randomness (particles, screen shake, damage-float jitter) deliberately does
 * NOT use this stream — see `apps/web/src/fx.ts`.
 */

/** mulberry32 — 32-bit state, uniform, fast, and identical across V8 versions. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash an arbitrary match seed string into a 32-bit integer.
 * Match seeds are stored as strings in Postgres (`Match.seed`), so both ends derive the
 * numeric state the same way.
 */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * A named random stream. The prototype's helpers (`rnd`, `rndi`, `pick`) are reproduced
 * with identical semantics so ported code reads the same.
 */
export class Rng {
  private next: () => number;

  constructor(seed: number | string) {
    this.next = mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed >>> 0);
  }

  /** Raw float in [0,1). Mirrors `Math.random()`. */
  random(): number {
    return this.next();
  }

  /** `rnd(a,b)` — float in [a,b). Verbatim semantics from crown-clash.html L660. */
  rnd(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  /** `rndi(a,b)` — integer in [a,b] inclusive. Verbatim from L661. */
  rndi(a: number, b: number): number {
    return Math.floor(this.rnd(a, b + 1));
  }

  /** `pick(arr)` — uniform element. Verbatim from L662. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * Fisher–Yates, matching the prototype's inline `sh()` at L1452 exactly:
   * `for (i = len-1; i > 0; i--) { j = rndi(0, i); swap }`.
   * Reproducing the loop direction and the inclusive `rndi` matters — a different shuffle
   * gives a different opening hand for the same seed.
   */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.rndi(0, i);
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }
}

/**
 * Cryptographically-unpredictable match seed. Generated server-side only: if the client
 * could choose the seed it could farm favourable AI behaviour and deck shuffles.
 */
export function randomSeed(): string {
  const bytes = new Uint8Array(16);
  // Declared locally rather than by pulling in the DOM or @types/node libs: this package must
  // compile with `"types": []` so it stays honestly platform-neutral. WebCrypto's
  // `getRandomValues` is present on `globalThis` in every browser and in Node >= 19.
  const webcrypto = (globalThis as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
  if (!webcrypto?.getRandomValues) {
    throw new Error('WebCrypto is unavailable; a match seed must not fall back to Math.random()');
  }
  webcrypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
