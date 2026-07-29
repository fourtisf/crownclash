/**
 * Modern effects layer.
 *
 * The prototype drew every spark as an opaque `fillRect` square and never once used
 * `globalCompositeOperation`, so fire, lightning and explosions all landed as flat shapes
 * stacked on the background instead of light being *added* to it. That single omission is
 * what made the game read as flat. This module fixes it in three parts:
 *
 *  1. **Soft sprites.** Particles are pre-baked radial-gradient discs on a tiny offscreen
 *     canvas, tinted and scaled at draw time. Baking once and blitting is far cheaper than
 *     building a gradient per particle per frame — at 60 fps with 200 particles that would be
 *     12,000 gradient allocations a second.
 *  2. **Additive blending.** Everything emissive draws with `lighter`, so overlapping embers
 *     brighten toward white the way real light does.
 *  3. **Bloom.** Emissive content also goes to a half/quarter-res buffer which is blurred and
 *     composited back additively. Downscaling *is* the blur — bilinear filtering during the
 *     upscale does the work a real Gaussian would, for a fraction of the cost.
 *
 * Everything scales with the player's quality preset, and `low` skips the offscreen buffers
 * entirely rather than merely doing less work on them.
 */
import type { Quality } from '@crown/shared';

export interface QualityProfile {
  /** Run the bloom pass at all. */
  bloom: boolean;
  /** Bloom buffer scale relative to the arena canvas. Smaller = blurrier and cheaper. */
  bloomScale: number;
  /** How hard bloom is composited back. */
  bloomStrength: number;
  /** Multiplier on how many particles effects emit. */
  particleScale: number;
  /** Soft round sprites instead of the prototype's squares. */
  softParticles: boolean;
  /** Unit count above which expensive per-unit shadows switch off (the prototype's Art.hq). */
  hqUnitLimit: number;
  /** Freeze frames on heavy impacts. */
  hitStop: boolean;
  /** Animated water, drifting cloud shadows, arena weather. */
  ambience: boolean;
}

const PROFILES: Record<Quality, QualityProfile> = {
  // No offscreen buffers at all. Still additive — that costs nothing and is most of the look.
  low: {
    bloom: false, bloomScale: 0, bloomStrength: 0, particleScale: 0.45,
    softParticles: true, hqUnitLimit: 14, hitStop: false, ambience: false,
  },
  med: {
    bloom: true, bloomScale: 0.25, bloomStrength: 0.55, particleScale: 0.75,
    softParticles: true, hqUnitLimit: 24, hitStop: true, ambience: true,
  },
  high: {
    bloom: true, bloomScale: 0.4, bloomStrength: 0.85, particleScale: 1,
    softParticles: true, hqUnitLimit: 34, hitStop: true, ambience: true,
  },
};

let quality: Quality = 'high';
export function setQuality(q: Quality): void {
  quality = q === 'low' || q === 'med' ? q : 'high';
}
export function getQuality(): Quality {
  return quality;
}
export function profile(): QualityProfile {
  return PROFILES[quality];
}

/* --------------------------------------------------------------- soft sprites */

/**
 * A white radial disc, baked once. Tinting happens at draw time via a per-sprite tinted copy,
 * cached by colour — there are only a dozen or so effect colours in the whole game.
 */
const SPRITE_PX = 64;
let discBase: HTMLCanvasElement | null = null;
const tinted = new Map<string, HTMLCanvasElement>();

function baseDisc(): HTMLCanvasElement {
  if (discBase) return discBase;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SPRITE_PX;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(SPRITE_PX / 2, SPRITE_PX / 2, 0, SPRITE_PX / 2, SPRITE_PX / 2, SPRITE_PX / 2);
  // A hot core that falls off fast, then a long soft skirt — the profile that reads as "glow"
  // rather than "circle". A linear ramp looks like a flat dot no matter how it is blended.
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.32)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  discBase = cv;
  return cv;
}

/** Tinted copy of the disc, cached. `source-in` keeps the disc's alpha and swaps the colour. */
export function glowSprite(color: string): HTMLCanvasElement {
  const hit = tinted.get(color);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SPRITE_PX;
  const c = cv.getContext('2d')!;
  c.drawImage(baseDisc(), 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = color;
  c.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  tinted.set(color, cv);
  return cv;
}

/** Draw a soft additive blob in canvas pixels. */
export function blob(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  if (r <= 0 || alpha <= 0) return;
  c.globalAlpha = alpha;
  c.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  c.globalAlpha = 1;
}

/* -------------------------------------------------------------------- bloom */

/**
 * Emissive buffer.
 *
 * Anything that should glow is drawn here as well as to the main canvas. At the end of the
 * frame it is blurred (by virtue of being small) and composited back with `lighter`.
 */
let emissive: HTMLCanvasElement | null = null;
let emissiveCtx: CanvasRenderingContext2D | null = null;
let emW = 0;
let emH = 0;

/**
 * Prepare the emissive buffer for a frame at the given canvas size.
 * Returns the context to draw glow into, or null when bloom is off.
 */
export function beginEmissive(w: number, h: number): CanvasRenderingContext2D | null {
  const p = profile();
  if (!p.bloom || w < 8 || h < 8) return null;
  const tw = Math.max(8, Math.round(w * p.bloomScale));
  const th = Math.max(8, Math.round(h * p.bloomScale));
  if (!emissive) {
    emissive = document.createElement('canvas');
    emissiveCtx = emissive.getContext('2d');
  }
  if (!emissiveCtx) return null;
  if (emissive.width !== tw || emissive.height !== th) {
    emissive.width = tw;
    emissive.height = th;
  }
  emW = w;
  emH = h;
  emissiveCtx.setTransform(1, 0, 0, 1, 0, 0);
  emissiveCtx.clearRect(0, 0, tw, th);
  // Scale so callers can draw in main-canvas coordinates and forget the buffer is smaller.
  emissiveCtx.scale(tw / w, th / h);
  emissiveCtx.globalCompositeOperation = 'lighter';
  return emissiveCtx;
}

/** Composite the accumulated glow back over the frame. */
export function endEmissive(c: CanvasRenderingContext2D): void {
  const p = profile();
  if (!p.bloom || !emissive || emW === 0) return;
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = p.bloomStrength;
  c.imageSmoothingEnabled = true;
  // Two passes at different scales: a tight halo and a wide atmospheric one. Cheaper and
  // softer than a single larger blur, and the wide pass is what makes gold read as *hot*.
  c.drawImage(emissive, 0, 0, emW, emH);
  c.globalAlpha = p.bloomStrength * 0.45;
  c.drawImage(emissive, -emW * 0.02, -emH * 0.02, emW * 1.04, emH * 1.04);
  c.restore();
}

/* ------------------------------------------------------------------ hit stop */

let stopUntil = 0;

/**
 * Freeze the picture briefly on a heavy impact.
 *
 * Only rendering pauses — the simulation is driven by an accumulator, so the ticks still
 * happen and the deploy log the server replays is unaffected. This is the cheapest way to
 * make a hit feel like it landed.
 */
export function hitStop(ms: number): void {
  if (!profile().hitStop) return;
  stopUntil = Math.max(stopUntil, performance.now() + ms);
}

export function hitStopActive(now: number): boolean {
  return now < stopUntil;
}

export function resetHitStop(): void {
  stopUntil = 0;
}
