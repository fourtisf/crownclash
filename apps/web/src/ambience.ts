/**
 * Living arena: moving water, drifting light, and weather that tells the arenas apart.
 *
 * The backdrop is baked once into an offscreen canvas and blitted every frame, which is the
 * right call for grass, walls and bridges — they never change. But it also meant the river,
 * a wide band across the middle of the screen, was a still photograph for the whole match.
 *
 * Rather than un-bake the backdrop (throwing away the reason it is fast), everything here
 * draws *over* it: a few cheap animated passes confined to the water band, plus per-arena
 * atmosphere. All of it is skipped entirely at `low` quality.
 */
import { AH, AW, RIV_B, RIV_T, arenaFor } from '@crown/shared';
import { profile } from './gfx';

/** Arena-specific weather. Index matches ARENAS. */
type Weather = 'none' | 'snow' | 'ember' | 'leaves' | 'dust' | 'sparkle';

const WEATHER: Weather[] = [
  'leaves',  // Training Camp — drifting leaves
  'leaves',  // Goblin Stadium
  'dust',    // Bone Pit — dry grit
  'snow',    // Frozen Peak
  'ember',   // Ember Forge
  'none',    // Royal Arena — clean and formal
  'sparkle', // Legendary Arena — arcane motes
];

/** A tint laid over the whole arena, so the seven arenas do not all read as "green field". */
const GRADE: (string | null)[] = [
  null,
  null,
  'rgba(120,110,70,0.10)',
  'rgba(150,200,255,0.16)',
  'rgba(255,120,40,0.13)',
  'rgba(90,180,210,0.09)',
  'rgba(150,90,255,0.14)',
];

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  spin: number;
}

let motes: Mote[] = [];
let arenaIndex = 0;
let weather: Weather = 'none';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Called at the start of a match, once the arena is known. */
export function setAmbienceArena(trophies: number): void {
  arenaIndex = arenaFor(trophies).i;
  weather = WEATHER[arenaIndex] ?? 'none';
  motes = [];
  if (!profile().ambience || weather === 'none') return;
  const n = Math.round(26 * profile().particleScale);
  for (let i = 0; i < n; i++) {
    motes.push({
      x: rnd(0, AW),
      y: rnd(0, AH),
      vx: rnd(-0.35, 0.35),
      vy: weather === 'snow' ? rnd(0.35, 0.8) : weather === 'ember' ? rnd(-0.75, -0.25) : rnd(0.1, 0.45),
      r: rnd(0.05, 0.14),
      a: rnd(0.25, 0.7),
      spin: rnd(0, 6.283),
    });
  }
}

/**
 * Water.
 *
 * Three passes, each cheap: a slow vertical shimmer, scrolling crests, and a specular band
 * that tracks the same top-left light the units are lit from. Clipped to the river so none of
 * it can bleed onto the banks.
 */
function drawWater(c: CanvasRenderingContext2D, sc: number, t: number): void {
  const y0 = RIV_T * sc;
  const h = (RIV_B - RIV_T) * sc;
  const w = AW * sc;

  c.save();
  c.beginPath();
  c.rect(0, y0, w, h);
  c.clip();

  // Depth shimmer: the whole band breathes slightly, so still water never looks like a decal.
  c.globalAlpha = 0.10 + 0.05 * Math.sin(t * 0.9);
  c.fillStyle = '#7fd8ff';
  c.fillRect(0, y0, w, h);
  c.globalAlpha = 1;

  // Crests. Two trains at different speeds and wavelengths read as current; one reads as a
  // sine wave, which is worse than nothing.
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const phase = t * (0.55 + i * 0.22) + i * 1.7;
    const yy = y0 + h * (0.18 + i * 0.2);
    c.strokeStyle = `rgba(210,245,255,${0.24 - i * 0.045})`;
    c.lineWidth = Math.max(1.2, (3.2 - i * 0.5) * (sc / 24));
    c.lineCap = 'round';
    c.beginPath();
    for (let x = 0; x <= w; x += 10) {
      const y = yy + Math.sin(x * 0.026 + phase) * (h * 0.075) + Math.sin(x * 0.011 - phase * 0.6) * (h * 0.04);
      if (!x) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }

  // Specular: a broad highlight sliding across, matching the top-left key light.
  const sx = ((t * 0.06) % 1.6 - 0.3) * w;
  const g = c.createLinearGradient(sx, 0, sx + w * 0.45, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.13)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, y0, w, h);
  c.globalCompositeOperation = 'source-over';
  c.restore();
}

/** Slow cloud shadows crossing the field. Sells "outdoors" for almost nothing. */
function drawCloudShadows(c: CanvasRenderingContext2D, sc: number, t: number): void {
  const w = AW * sc;
  const h = AH * sc;
  c.save();
  c.globalAlpha = 0.07;
  c.fillStyle = '#0a1030';
  for (let i = 0; i < 2; i++) {
    const cx = ((t * (7 + i * 4) + i * 900) % (w + 700)) - 350;
    const cy = h * (0.3 + i * 0.35);
    c.beginPath();
    c.ellipse(cx, cy, w * 0.42, h * 0.14, -0.3, 0, 6.283);
    c.fill();
  }
  c.restore();
}

function drawMotes(c: CanvasRenderingContext2D, sc: number, dt: number): void {
  const colors: Record<Weather, string> = {
    none: '#fff',
    snow: '#eaf6ff',
    ember: '#ff9a3a',
    leaves: '#9fdc72',
    dust: '#d8cba0',
    sparkle: '#c9a6ff',
  };
  const col = colors[weather];
  const additive = weather === 'ember' || weather === 'sparkle';
  c.save();
  if (additive) c.globalCompositeOperation = 'lighter';
  for (const m of motes) {
    m.spin += dt * 1.6;
    m.x += (m.vx + Math.sin(m.spin) * 0.25) * dt;
    m.y += m.vy * dt;
    // Wrap rather than respawn: no allocation, and the field never visibly thins out.
    if (m.y > AH + 1) m.y = -1;
    if (m.y < -1) m.y = AH + 1;
    if (m.x > AW + 1) m.x = -1;
    if (m.x < -1) m.x = AW + 1;

    const flicker = weather === 'ember' || weather === 'sparkle' ? 0.6 + 0.4 * Math.sin(m.spin * 3) : 1;
    c.globalAlpha = m.a * flicker;
    c.fillStyle = col;
    c.beginPath();
    c.arc(m.x * sc, m.y * sc, m.r * sc, 0, 6.283);
    c.fill();
  }
  c.globalAlpha = 1;
  c.restore();
}

/**
 * Draw everything atmospheric. Call right after the backdrop is blitted and before units, so
 * troops stand *in* the weather rather than behind it.
 */
export function drawAmbience(c: CanvasRenderingContext2D, sc: number, time: number, dt: number): void {
  const p = profile();
  if (!p.ambience) return;
  drawWater(c, sc, time);
  drawCloudShadows(c, sc, time);
  drawMotes(c, sc, dt);
}

/** Colour grade for the current arena. Drawn last, over everything. */
export function drawGrade(c: CanvasRenderingContext2D, sc: number): void {
  if (!profile().ambience) return;
  const tint = GRADE[arenaIndex];
  if (!tint) return;
  c.save();
  c.globalCompositeOperation = 'overlay';
  c.fillStyle = tint;
  c.fillRect(0, 0, AW * sc, AH * sc);
  c.restore();
}
