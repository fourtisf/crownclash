/**
 * Background music.
 *
 * The prototype had eleven sound effects and silence between them, which makes the meta
 * screens feel like a settings menu and the arena feel like a spreadsheet. There is no audio
 * file here for the same reason there is no sprite sheet: the whole game is procedural, and a
 * two-megabyte loop would be larger than everything else shipped put together.
 *
 * So it is synthesised, in the same idiom as `Snd` — bare oscillators, no samples — over a
 * four-bar i-VI-III-VII loop in A minor, which is the progression every fantasy ladder game
 * has used since the eighties because it resolves forever without ever quite landing.
 *
 * Two things this must never do:
 *  - **Fight the sound effects.** Music sits on its own gain node well under the cues, and
 *    ducks under the ones that matter (a crown, a tower falling).
 *  - **Run when nobody is listening.** The scheduler stops dead when the tab hides. On a phone
 *    that is the difference between a game and a battery complaint.
 *
 * Scheduling is the standard Web Audio lookahead: a coarse timer wakes up every 25 ms and
 * queues every note that falls in the next 100 ms against the audio clock. `setTimeout` alone
 * is nowhere near accurate enough to sequence with — it drifts audibly within a couple of bars.
 */
import { Snd } from './engine';

/** Chord roots as MIDI notes: Am - F - C - G, one bar each. */
const PROG = [
  { root: 57, third: 3 }, // A minor
  { root: 53, third: 4 }, // F major
  { root: 48, third: 4 }, // C major
  { root: 55, third: 4 }, // G major
] as const;

const BPM = { menu: 84, battle: 132 } as const;
const STEPS_PER_BAR = 16;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.1;

export type Track = 'menu' | 'battle' | null;

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

let track: Track = null;
let enabled = true;
let timer = 0;
let step = 0;
/** Audio-context time the next step is due. Kept on the audio clock, never on `Date.now()`. */
let nextAt = 0;
let master: GainNode | null = null;
/** 0..1 — climbs with the elixir multiplier so double elixir sounds like double elixir. */
let intensity = 0;

function ctx(): AudioContext | null {
  const c = (Snd as unknown as { ctx: AudioContext | null }).ctx;
  return c ?? null;
}

/** One oscillator with an envelope, connected to the music bus rather than the destination. */
function note(freq: number, when: number, dur: number, type: OscillatorType, vol: number): void {
  const c = ctx();
  if (!c || !master) return;
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(master);
    o.start(when);
    o.stop(when + dur + 0.02);
  } catch {
    /* a dead audio context must never take the game with it */
  }
}

/** Filtered noise — the only percussion, and only in battle. */
function perc(when: number, dur: number, vol: number, cutoff: number): void {
  const c = ctx();
  if (!c || !master) return;
  try {
    const n = Math.floor(c.sampleRate * dur);
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
    const src = c.createBufferSource();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    src.buffer = b;
    f.type = 'bandpass';
    f.frequency.value = cutoff;
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(when);
  } catch {
    /* as above */
  }
}

/**
 * One sixteenth-note slot.
 *
 * Menu is a bass note, a slow arpeggio and nothing else — it has to survive being heard for
 * twenty minutes while somebody stares at their card collection. Battle adds the octave-down
 * pulse and the hats, and opens up as `intensity` rises.
 */
function scheduleStep(i: number, when: number): void {
  const bar = Math.floor(i / STEPS_PER_BAR) % PROG.length;
  const s = i % STEPS_PER_BAR;
  const { root, third } = PROG[bar];
  const tones = [0, third, 7, 12];

  if (track === 'menu') {
    if (s === 0) note(midi(root - 12), when, 1.1, 'triangle', 0.09);
    // Arpeggio on the off-eighths, an octave up, quiet enough to sit behind a button press.
    if (s % 4 === 2) note(midi(root + 12 + tones[(s >> 2) % tones.length]), when, 0.5, 'sine', 0.045);
    if (s === 8) note(midi(root - 5), when, 0.7, 'triangle', 0.05);
    return;
  }

  // ---- battle
  const drive = 0.55 + 0.45 * intensity;
  if (s % 8 === 0) note(midi(root - 12), when, 0.34, 'triangle', 0.11 * drive);
  if (s === 6 || s === 14) note(midi(root - 12), when, 0.16, 'triangle', 0.07 * drive);
  // Sixteenth arpeggio, thinning to eighths when nothing is at stake so the loop can breathe.
  const dense = intensity > 0.35 ? 2 : 4;
  if (s % dense === 0) {
    note(midi(root + 12 + tones[(s / dense) % tones.length]), when, 0.13, 'square', 0.032 * drive);
  }
  if (s % 4 === 0) perc(when, 0.05, 0.05 * drive, 320);
  if (s % 4 === 2) perc(when, 0.03, 0.028 * drive, 5200);
  // A lead line only once it matters — this is the cue that the match is in its last minute.
  if (intensity > 0.6 && (s === 4 || s === 12)) {
    note(midi(root + 24 + tones[(s >> 2) % tones.length]), when, 0.22, 'sawtooth', 0.024);
  }
}

function tick(): void {
  const c = ctx();
  if (!c || !track) return;
  const spb = 60 / BPM[track] / 4;
  while (nextAt < c.currentTime + SCHEDULE_AHEAD) {
    // A tab that was hidden long enough leaves `nextAt` far in the past; catching up would
    // dump hundreds of notes at once. Jump the clock forward instead.
    if (nextAt < c.currentTime) nextAt = c.currentTime + 0.02;
    scheduleStep(step, nextAt);
    step++;
    nextAt += spb;
  }
}

function bus(): GainNode | null {
  const c = ctx();
  if (!c) return null;
  if (!master) {
    master = c.createGain();
    master.gain.value = 0;
    master.connect(c.destination);
  }
  return master;
}

function ramp(to: number, seconds: number): void {
  const c = ctx();
  const g = bus();
  if (!c || !g) return;
  g.gain.cancelScheduledValues(c.currentTime);
  g.gain.setValueAtTime(g.gain.value, c.currentTime);
  g.gain.linearRampToValueAtTime(to, c.currentTime + seconds);
}

/** Target level for the current track. Music stays well under the effects on purpose. */
const level = (t: Track): number => (t === 'battle' ? 0.075 : t === 'menu' ? 0.05 : 0);

/**
 * Switch tracks. Safe to call with the track that is already playing — repeated calls from a
 * re-rendering screen must not restart the loop mid-bar.
 */
export function playMusic(next: Track): void {
  if (!enabled) next = null;
  if (next === track) return;
  const c = ctx();
  if (!c && next) return;
  track = next;
  if (!next) {
    ramp(0, 0.4);
    if (timer) window.clearInterval(timer);
    timer = 0;
    return;
  }
  // A new track starts on bar one; resuming the same one would land mid-phrase.
  step = 0;
  nextAt = c!.currentTime + 0.08;
  if (c!.state === 'suspended') void c!.resume().catch(() => undefined);
  ramp(level(next), 0.8);
  if (!timer) timer = window.setInterval(tick, LOOKAHEAD_MS);
}

/**
 * How urgent the battle track should sound, driven by the elixir multiplier: 1x for the first
 * two minutes, 2x for the last minute, 3x in overtime.
 */
export function setMusicIntensity(elixirMult: number): void {
  intensity = Math.min(1, Math.max(0, (elixirMult - 1) / 2));
}

/**
 * Duck for a moment so a crown or a falling tower lands on top of the music instead of in it.
 * The cues are short, so the recovery is what has to be gentle, not the dip.
 */
export function duckMusic(seconds = 1.2): void {
  if (!track) return;
  ramp(level(track) * 0.32, 0.06);
  window.setTimeout(() => ramp(level(track), seconds), 120);
}

/** Mirrors `S.music`. Turning it off stops the scheduler rather than just muting the bus. */
export function setMusicEnabled(on: boolean): void {
  enabled = !!on;
  if (!enabled) {
    const was = track;
    playMusic(null);
    resumeTo = was;
  } else if (resumeTo) {
    const t = resumeTo;
    resumeTo = null;
    playMusic(t);
  }
}

/** What to go back to when music is re-enabled, or the tab becomes visible again. */
let resumeTo: Track = null;

/**
 * Stop while the tab is hidden. Web Audio keeps running in a backgrounded tab on most
 * platforms, so without this a player who switches apps mid-match gets a battery drain and a
 * loop playing over whatever they switched to.
 */
export function initMusic(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (track) {
        resumeTo = track;
        playMusic(null);
      }
    } else if (resumeTo && enabled) {
      const t = resumeTo;
      resumeTo = null;
      playMusic(t);
    }
  });
}
