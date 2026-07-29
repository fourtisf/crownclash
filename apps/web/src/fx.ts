/**
 * Effects layer — turns `SimEvent`s back into the prototype's particles, damage floats,
 * spawn rings, screen shake and sound.
 *
 * This is the other half of the split described in docs/EXTRACTION-PLAN.md §2: the sim is
 * deterministic and headless, so everything cosmetic that used to live inside `hurt()`,
 * `killUnit()` and `applySpell()` had to move somewhere. It moved here, burst-for-burst —
 * every count, colour, lifetime and velocity below is copied from the line noted beside it.
 *
 * The randomness here is deliberately NOT the sim's seeded stream. Particle jitter has no
 * effect on the outcome, and drawing from the sim's RNG would make the visuals part of the
 * match hash — a dropped frame could then void a match.
 */
import { CARD, clamp } from '@crown/shared';
import type { SimEvent } from '@crown/shared';
import { Snd } from './engine';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; c: string; sz: number;
  ring?: number; arrow?: number;
}
export interface Float { x: number; y: number; txt: string; c: string; t: number; dur: number }
export interface Ring { x: number; y: number; t: number; dur: number; team: 0 | 1; r: number }

/** Mutable FX state. Lives on the client only; the server never allocates any of it. */
export class Fx {
  parts: Particle[] = [];
  floats: Float[] = [];
  rings: Ring[] = [];
  shake = 0;
  flash = 0;
  /** Latest banner text, consumed by the battle screen's toast. */
  toast: string | null = null;

  clear(): void {
    this.parts.length = 0;
    this.floats.length = 0;
    this.rings.length = 0;
    this.shake = 0;
    this.flash = 0;
    this.toast = null;
  }

  /** L1967-1976 — verbatim integration: gravity 8, drag .96, shake decays as .001^dt. */
  step(dt: number): void {
    for (const p of this.parts) {
      p.life -= dt;
      if (!p.ring) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 8 * dt;
        p.vx *= 0.96;
      }
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < f.dur);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.dur);
    this.shake *= Math.pow(0.001, dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5);
  }

  apply(events: SimEvent[]): void {
    for (const e of events) this.one(e);
  }

  private one(e: SimEvent): void {
    switch (e.k) {
      /* ---------------------------------------------------------------- L1761-1763 */
      case 'hit': {
        // The event carries the float anchor (u.y - rad - .4); the sparks used u.y - rad*.6.
        const uy = e.y + e.rad + 0.4;
        this.floats.push({
          x: e.x, y: e.y, txt: '-' + Math.round(e.amount),
          c: e.byTeam === 0 ? '#ffd964' : '#ff8a8a', t: 0, dur: 0.75,
        });
        for (let i = 0; i < 4; i++) {
          const a = rnd(0, 6.3);
          this.parts.push({
            x: e.x, y: uy - e.rad * 0.6,
            vx: Math.cos(a) * rnd(1, 3), vy: Math.sin(a) * rnd(1, 3) - 1,
            life: 0.28, max: 0.28, c: '#ffd9a0', sz: 0.05,
          });
        }
        break;
      }

      /* ---------------------------------------------------------------- L1781-1783 */
      case 'death': {
        Snd.play(160, 0.16, 'sawtooth', 0.05, 70);
        for (let i = 0; i < 12; i++) {
          const a = rnd(0, 6.3);
          const v = rnd(1, 4);
          this.parts.push({
            x: e.x, y: e.y - e.rad * 0.7,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5,
            life: rnd(0.3, 0.6), max: 0.6, c: e.team === 0 ? '#7fb0ff' : '#ff9a9a', sz: rnd(0.05, 0.13),
          });
        }
        break;
      }

      /* ---------------------------------------------------------------- L1770-1774 */
      case 'towerDown': {
        this.shake = 14;
        Snd.boom();
        Snd.crown();
        this.toast = e.team === 1 ? 'TOWER DOWN!' : 'YOUR TOWER FELL!';
        for (let i = 0; i < 60; i++) {
          const a = rnd(0, 6.3);
          const v = rnd(1, 9);
          this.parts.push({
            x: e.x, y: e.y - 0.6,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2,
            life: rnd(0.4, 1.1), max: 1.1,
            c: pick(['#c6cfe0', '#8b93a8', '#ffd76a', '#ff8a2a']), sz: rnd(0.06, 0.2),
          });
        }
        break;
      }

      /* ---------------------------------------------------------------- L1786-1787 */
      case 'deathBlast':
        this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.4, max: 0.4, c: '#ffb04a', sz: e.radius, ring: 1 });
        this.shake = Math.max(this.shake, 8);
        Snd.boom();
        break;

      /* -------------------------------------------------------------------- L1917 */
      case 'splash':
        this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.25, max: 0.25, c: '#ffb04a', sz: e.radius, ring: 1 });
        break;

      /* -------------------------------------------------------------------- L1924 */
      case 'chain':
        this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.18, max: 0.18, c: '#8fe8ff', sz: 0.4, ring: 1 });
        break;

      /* -------------------------------------------------------------------- L1869 */
      case 'charged':
        this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.3, max: 0.3, c: '#ffd964', sz: 0.9, ring: 1 });
        break;

      /* -------------------------------------------------------------- L1885-1886 */
      case 'dash':
        this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.25, max: 0.25, c: '#3ff0e0', sz: 0.7, ring: 1 });
        Snd.play(900, 0.12, 'sawtooth', 0.05, 200);
        break;

      /* L1871+1927 — melee lands: slash whoosh plus the generic hit blip. */
      case 'melee':
        Snd.slash();
        Snd.hit();
        break;

      /* -------------------------------------------------------------- L1933-1935 */
      case 'shoot':
        if (e.kind === 'bullet') Snd.play(700, 0.06, 'square', 0.04, 200);
        else if (e.kind === 'fire') Snd.play(300, 0.12, 'sawtooth', 0.04, 120);
        else Snd.play(500, 0.05, 'triangle', 0.03, 300);
        break;

      /* -------------------------------------------------------------- L1949-1951 */
      case 'projHit': {
        for (let i = 0; i < 5; i++) {
          const a = rnd(0, 6.3);
          this.parts.push({
            x: e.x, y: e.y, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2, life: 0.2, max: 0.2,
            c: e.kind === 'fire' ? '#ff9a3a' : e.kind === 'lightning' ? '#8fe8ff' : '#e8eeff', sz: 0.05,
          });
        }
        Snd.hit();
        break;
      }

      /* ------------------------------------------------------------- L1696, L1712 */
      case 'ring':
        this.rings.push({ x: e.x, y: e.y, t: 0, dur: 1.0, team: e.team, r: e.r });
        break;

      /* -------------------------------------------------------------------- L1714 */
      case 'deploy':
        Snd.deploy();
        break;

      /* -------------------------------------------------------------------- L1720 */
      case 'spellCast':
        Snd.play(300, 0.2, 'sawtooth', 0.06, 900);
        break;

      /* -------------------------------------------------------------- L1737-1753 */
      case 'spellImpact': {
        const card = CARD[e.cid];
        const radius = e.radius || card?.radius || 1;
        if (e.cid === 'meteor') {
          this.shake = Math.max(this.shake, 10);
          Snd.boom();
          for (let i = 0; i < 34; i++) {
            const a = rnd(0, 6.3);
            const v = rnd(1.5, 7);
            this.parts.push({
              x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
              life: rnd(0.3, 0.7), max: 0.7, c: pick(['#ffd76a', '#ff8a2a', '#ff4a1a']), sz: rnd(0.06, 0.16),
            });
          }
          this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.45, max: 0.45, c: '#ffb04a', sz: radius, ring: 1 });
        } else if (e.cid === 'jolt') {
          this.shake = Math.max(this.shake, 5);
          Snd.play(1400, 0.12, 'square', 0.07, 300);
          for (let i = 0; i < 16; i++) {
            const a = rnd(0, 6.3);
            const v = rnd(1, 4);
            this.parts.push({
              x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
              life: rnd(0.15, 0.35), max: 0.35, c: '#a8f0ff', sz: rnd(0.05, 0.1),
            });
          }
          this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.3, max: 0.3, c: '#a8f0ff', sz: radius, ring: 1 });
          this.flash = 0.35;
        } else {
          Snd.noise(0.2, 0.08);
          for (let i = 0; i < 24; i++) {
            const a = rnd(0, 6.3);
            const d2 = rnd(0, radius);
            this.parts.push({
              x: e.x + Math.cos(a) * d2, y: e.y + Math.sin(a) * d2,
              vx: 0, vy: rnd(4, 9), life: 0.28, max: 0.28, c: '#dfe9ff', sz: 0.05, arrow: 1,
            });
          }
          this.parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.4, max: 0.4, c: '#9fd0ff', sz: radius, ring: 1 });
        }
        break;
      }

      /* -------------------------------------------------------------------- L2040 */
      case 'phase':
        this.toast = 'SUDDEN DEATH!';
        Snd.crown();
        break;

      /* -------------------------------------------------------------- L2050-2051 */
      case 'end':
        this.toast = e.result === 'win' ? 'VICTORY!' : e.result === 'lose' ? 'DEFEAT' : 'DRAW';
        if (e.result === 'win') Snd.win();
        else if (e.result === 'lose') Snd.lose();
        break;
    }
  }

  /** Screen-flash opacity for `#bFlash` — L1976. */
  flashOpacity(): number {
    return clamp(this.flash, 0, 1) * 0.5;
  }
}
