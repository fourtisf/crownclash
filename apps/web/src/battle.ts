/**
 * Battle screen — the client half of crown-clash.html §6.
 *
 * The gameplay itself is gone from here: it lives in `@crown/shared`'s `Sim`, which the
 * server runs too. What remains is everything the server has no use for — canvas sizing,
 * the hand, the elixir bar, pointer input, the render loop, and recording the deploy log
 * that the server will re-simulate (handoff §3.3).
 *
 * Two changes from the prototype's loop, both forced by making the sim re-runnable:
 *
 *  - **Fixed step.** The prototype advanced by `min(.05, elapsed)` per frame, which can never
 *    be reproduced. Here an accumulator drives `sim.tick()` at exactly 30 Hz regardless of
 *    display refresh, so a 144 Hz phone and the server compute identical matches.
 *  - **Interpolation.** Because ticks are now 33 ms apart, positions are interpolated toward
 *    the next tick before drawing, so motion stays as smooth as the prototype's per-frame
 *    integration looked.
 */
import {
  AH, AW, CARD, DT, Sim, aiUpdate, clamp,
} from '@crown/shared';
import type { DeployLogEntry, MatchStartResponse, Unit } from '@crown/shared';
import { $, must } from './dom';
import { Art, Snd, bindRenderer, buildArenaBG, fitCanvas, render, renderPortrait, setArenaTrophies } from './engine';
import type { RenderFacade } from './engine';
import { Fx } from './fx';
import { S } from './api/store';
import { setToast } from './ui/toast';

/** The live battle, or null when we are not in one. Mirrors the prototype's `B` global. */
export let B: BattleView | null = null;

/**
 * The prototype's `B` object, reconstituted: shared sim state spread alongside the
 * client-only FX and view fields. `render()` is a verbatim slice that reads exactly these
 * property names, which is why the shape is preserved rather than tidied.
 */
interface BattleView extends RenderFacade {
  sim: Sim;
  fx: Fx;
  matchId: string;
  deployLog: DeployLogEntry[];
  handNodes: HTMLElement[];
  elixSegs: HTMLElement[];
  lastE: number;
  lastM: number;
  dragging: boolean;
  submitted: boolean;
  /* mirrored each frame from sim.state so the verbatim renderer can read them */
  crowns: [number, number];
  elix: [number, number];
  mult: number;
  t: number;
  phase: string;
}

let aCv: HTMLCanvasElement | null = null;
let aCtx: CanvasRenderingContext2D | null = null;
let rafId = 0;
let lastT = 0;
let acc = 0;
let lastSec = -1;
let inputBound = false;

/** Scratch buffers for interpolation — reused so the render loop allocates nothing. */
const scratchX: number[] = [];
const scratchY: number[] = [];

export interface BattleCallbacks {
  /** Called once the match ends, with the log the server must re-simulate. */
  onFinish(matchId: string, deployLog: DeployLogEntry[]): void;
  /** Screen switch, so battle.ts does not need to know about the tab system. */
  go(screen: string): void;
}

let cb: BattleCallbacks | null = null;

export function initBattle(callbacks: BattleCallbacks): void {
  cb = callbacks;
  bindBattleInput();
}

/* ------------------------------------------------------------------ lifecycle */

/**
 * L1437-1475 — start a match.
 *
 * Everything that decides the outcome comes from `start`: the server picked the seed, the AI
 * deck and levels, and echoed our own deck and card levels back. Simulating with anything
 * else would guarantee the re-sim disagrees and the match is voided.
 */
export function startBattle(start: MatchStartResponse): void {
  Snd.init();
  if (Snd.ctx && Snd.ctx.state === 'suspended') void Snd.ctx.resume();

  const sim = new Sim({
    seed: start.seed,
    myDeck: start.myDeck,
    myCardLevels: start.myCardLevels,
    myKingLevel: start.myKingLevel,
    aiDeckIndex: start.aiDeckIndex,
    aiLevel: start.aiLevel,
  });

  const fx = new Fx();
  B = {
    sim, fx,
    matchId: start.matchId,
    deployLog: [],
    handNodes: [],
    elixSegs: [],
    lastE: -1,
    lastM: -1,
    dragging: false,
    submitted: false,
    sc: 12,
    time: 0,
    over: false,
    selected: -1,
    ghost: null,
    shake: 0,
    hand: sim.state.hand,
    units: sim.state.units,
    projs: sim.state.projs,
    spells: sim.state.spells,
    parts: fx.parts,
    floats: fx.floats,
    rings: fx.rings,
    crowns: sim.state.crowns,
    elix: sim.state.elix,
    mult: 1,
    t: sim.state.t,
    phase: 'normal',
  };

  must('#bMyName').textContent = S.name;
  must('#bEnemyName').textContent = start.aiName;

  setArenaTrophies(S.trophies);
  buildArenaBG();
  setToast('');
  cb?.go('battle');

  renderHand();
  updateCrowns();
  buildElix();
  updateElixUI();

  // L1472-1473 — the arena canvas is sized after the hand renders, then re-checked on the
  // next two frames and again at 260 ms. Mobile browsers report a stale wrapper height until
  // the keyboard/URL bar settles, and a wrong `sc` makes every tap land on the wrong tile.
  sizeArena();
  requestAnimationFrame(() => {
    sizeArena();
    requestAnimationFrame(() => sizeArena());
  });
  setTimeout(() => {
    if (B) sizeArena();
  }, 260);

  lastT = performance.now();
  acc = 0;
  lastSec = -1;
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

export function stopBattle(): void {
  cancelAnimationFrame(rafId);
  rafId = 0;
  B = null;
}

/** L1653-1662 — fit the arena to its wrapper, retrying while the layout is still settling. */
export function sizeArena(retry = 0): void {
  const wrap = $('#arenaWrap');
  if (!wrap || !B) return;
  const W = wrap.clientWidth || wrap.getBoundingClientRect().width;
  const H = wrap.clientHeight || wrap.getBoundingClientRect().height;
  if (W < 10 || H < 10) {
    if (retry < 40) requestAnimationFrame(() => sizeArena(retry + 1));
    return;
  }
  const sc = Math.min(W / AW, H / AH);
  B.sc = sc;
  aCv = $<HTMLCanvasElement>('#arena');
  if (!aCv) return;
  aCtx = fitCanvas(aCv, AW * sc, AH * sc);
  aCv.style.width = AW * sc + 'px';
  aCv.style.height = AH * sc + 'px';
  bindRenderer(B, aCtx);
}

/* ---------------------------------------------------------------------- hand */

/** L2269-2287 */
function renderHand(): void {
  if (!B) return;
  const row = must('#handRow');
  row.querySelectorAll('.hcard[data-i]').forEach((n) => n.remove());
  for (let i = 0; i < 4; i++) {
    const cid = B.sim.state.hand[i];
    const card = CARD[cid];
    const d = document.createElement('div');
    d.className = 'hcard';
    d.dataset.i = String(i);
    const cv = document.createElement('canvas');
    d.appendChild(cv);
    const cost = document.createElement('span');
    cost.className = 'cost';
    cost.textContent = String(card.cost);
    d.appendChild(cost);
    const veil = document.createElement('div');
    veil.className = 'veil';
    d.appendChild(veil);
    row.appendChild(d);
    requestAnimationFrame(() => renderPortrait(cv, cid, d.clientWidth - 4));
  }
  B.handNodes = Array.from(row.querySelectorAll<HTMLElement>('.hcard[data-i]'));

  const nx = must('#nextCard');
  nx.innerHTML = '';
  const ncid = B.sim.state.queue[0];
  const ncard = CARD[ncid];
  const ncv = document.createElement('canvas');
  nx.appendChild(ncv);
  const nc = document.createElement('span');
  nc.className = 'cost';
  nc.textContent = String(ncard.cost);
  nx.appendChild(nc);
  requestAnimationFrame(() => renderPortrait(ncv, ncid, nx.clientWidth - 4));
}

/**
 * L2288-2296 — play a card, and record it.
 *
 * The tick is captured *before* `playHand`, because `runMatch` on the server applies each
 * entry while `state.tick` equals the recorded value and only then steps. Recording the
 * post-play tick would shift every deploy one step later on re-simulation and void the match.
 */
function playHand(i: number, x: number, y: number): boolean {
  if (!B) return false;
  const tick = B.sim.state.tick;
  const cid = B.sim.state.hand[i];
  if (!B.sim.playHand(i, x, y)) return false;
  B.deployLog.push({ t: tick, cardId: cid, x, y });
  B.fx.apply(B.sim.drainEvents());
  B.selected = -1;
  B.ghost = null;
  renderHand();
  return true;
}

/* --------------------------------------------------------------------- input */

/** L2299-2304 */
function arenaPt(ev: PointerEvent | MouseEvent): { x: number; y: number } | null {
  if (!aCv || !B) return null;
  const r = aCv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / B.sc, y: (ev.clientY - r.top) / B.sc };
}

/**
 * L2305-2345.
 *
 * Bound exactly once at init. The prototype called `bindBattleInput()` from `init()` too, but
 * every handler had to null-guard `B` because they outlive any single match — those guards
 * are preserved.
 */
function bindBattleInput(): void {
  if (inputBound) return;
  inputBound = true;

  const row = must('#handRow');
  const wrap = must('#arenaWrap');

  row.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement | null;
    const card = target && typeof target.closest === 'function' ? target.closest<HTMLElement>('.hcard[data-i]') : null;
    if (!card || !B || B.over) return;
    const i = Number(card.dataset.i);
    const cd = CARD[B.sim.state.hand[i]];
    if (B.sim.state.elix[0] < cd.cost) {
      Snd.play(180, 0.1, 'square', 0.05);
      return;
    }
    B.selected = B.selected === i ? -1 : i;
    B.dragging = true;
    B.handNodes.forEach((n) => n.classList.toggle('picked', Number(n.dataset.i) === B!.selected));
    Snd.play(620, 0.05, 'triangle', 0.05);
  });

  const move = (e: PointerEvent) => {
    if (!B || B.selected < 0 || !aCv) return;
    const r = aCv.getBoundingClientRect();
    const x = (e.clientX - r.left) / B.sc;
    const y = (e.clientY - r.top) / B.sc;
    if (x > -2 && x < AW + 2 && y > -2 && y < AH + 2) {
      B.ghost = { x: clamp(x, 0, AW), y: clamp(y, 0, AH) };
    }
  };
  document.addEventListener('pointermove', move, { passive: true });

  document.addEventListener('pointerup', (e) => {
    if (!B) return;
    if (B.over || B.selected < 0) {
      B.dragging = false;
      return;
    }
    const tg = e.target as HTMLElement | null;
    const inArena = !!tg && (tg.id === 'arena' || (typeof tg.closest === 'function' && !!tg.closest('#arenaWrap')));
    if (B.dragging && B.ghost && inArena) {
      if (playHand(B.selected, B.ghost.x, B.ghost.y)) {
        B.handNodes.forEach((n) => n.classList.remove('picked'));
      }
    }
    B.dragging = false;
  });

  wrap.addEventListener('pointerdown', (e) => {
    if (!B || B.over || B.selected < 0) return;
    const p = arenaPt(e);
    if (!p) return;
    B.ghost = p;
    B.dragging = true;
  });

  wrap.addEventListener('click', (e) => {
    if (!B || B.over || B.selected < 0) return;
    const p = arenaPt(e);
    if (!p) return;
    if (playHand(B.selected, p.x, p.y)) B.handNodes.forEach((n) => n.classList.remove('picked'));
  });
}

/* ----------------------------------------------------------------------- HUD */

/** L2229-2232 */
function updateCrowns(): void {
  if (!B) return;
  const my = must('#bMyCrowns').children;
  const en = must('#bEnemyCrowns').children;
  for (let i = 0; i < 3; i++) {
    my[i].className = i < B.sim.state.crowns[0] ? 'on' : '';
    en[i].className = i < B.sim.state.crowns[1] ? 'on' : '';
  }
}

/** L2252-2260 */
function buildElix(): void {
  if (!B) return;
  const bar = must('#elixBar');
  if (bar.dataset.built !== '1') {
    for (let i = 0; i < 10; i++) {
      const d = document.createElement('span');
      d.className = 'elixseg';
      d.innerHTML = '<i></i>';
      bar.appendChild(d);
    }
    bar.dataset.built = '1';
  }
  B.elixSegs = Array.from(bar.querySelectorAll<HTMLElement>('.elixseg')).map((x) => x.firstChild as HTMLElement);
  B.lastE = -1;
  B.lastM = -1;
}

/** L2261-2268 */
function updateElixUI(): void {
  if (!B) return;
  if (!B.elixSegs.length) buildElix();
  const e = B.sim.state.elix[0];
  for (let i = 0; i < 10; i++) B.elixSegs[i].style.transform = 'scaleX(' + clamp(e - i, 0, 1).toFixed(3) + ')';
  const n = Math.floor(e);
  if (n !== B.lastE) {
    B.lastE = n;
    must('#elixNum').textContent = String(n);
  }
  const mult = B.sim.state.mult;
  if (mult !== B.lastM) {
    B.lastM = mult;
    must('#elixX2').textContent = mult > 1 ? 'x' + mult + ' ELIXIR' : '';
  }
}

/** L2233-2251 */
function updateHud(): void {
  if (!B) return;
  const st = B.sim.state;
  const s = Math.max(0, Math.ceil(st.t));
  if (s !== lastSec) {
    lastSec = s;
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    const tm = must('#bTimer');
    tm.querySelector('.t')!.textContent = m + ':' + ss;
    tm.querySelector('.lb')!.textContent =
      st.phase === 'over' ? 'SUDDEN DEATH' : st.mult > 1 ? 'ELIXIR x' + st.mult : 'TIME';
    tm.classList.toggle('hot', s <= 30 || st.phase === 'over');
    if (s <= 5 && s > 0 && !st.over) Snd.tick();
  }
  updateElixUI();
  const el = st.elix[0];
  B.handNodes.forEach((n) => {
    const card = CARD[st.hand[Number(n.dataset.i)]];
    n.classList.toggle('no', !card || el < card.cost);
  });
}

/* ---------------------------------------------------------------------- loop */

/**
 * Fixed-step simulation with interpolated rendering.
 *
 * `acc` is capped at 10 ticks so a backgrounded tab does not come back and burn a third of a
 * second of CPU catching up in one frame — it drops the missed time instead. That is a
 * divergence risk only if it happened server-side; here the sim is authoritative on the
 * *server*, and our local copy is re-derived from the log anyway.
 */
function loop(ts: number): void {
  if (!B) return;
  const frame = Math.min(0.25, (ts - lastT) / 1000);
  lastT = ts;
  const st = B.sim.state;

  if (!st.over) {
    acc += frame;
    let steps = 0;
    while (acc >= DT && steps < 10) {
      // Snapshot pre-tick positions for interpolation. Kept on the client because the server
      // has no renderer and should not carry two extra floats per unit through a re-sim.
      for (const u of st.units as (Unit & { px?: number; py?: number })[]) {
        u.px = u.x;
        u.py = u.y;
      }
      const events = B.sim.tick(aiUpdate);
      B.fx.apply(events);
      acc -= DT;
      steps++;
      if (st.over) break;
    }
    if (acc > DT * 10) acc = 0;
  }

  B.fx.step(frame);

  // Mirror the fields the verbatim renderer reads off `B`.
  B.time = st.time + Math.min(acc, DT);
  B.over = st.over;
  B.hand = st.hand;
  B.units = st.units;
  B.projs = st.projs;
  B.spells = st.spells;
  B.crowns = st.crowns;
  B.elix = st.elix;
  B.mult = st.mult;
  B.t = st.t;
  B.phase = st.phase;
  B.shake = B.fx.shake;
  B.parts = B.fx.parts;
  B.floats = B.fx.floats;
  B.rings = B.fx.rings;

  if (B.fx.toast) {
    setToast(B.fx.toast);
    B.fx.toast = null;
  }
  const flash = $('#bFlash');
  if (flash) flash.style.opacity = String(B.fx.flashOpacity());

  if (!aCtx) sizeArena();
  drawInterpolated(st.over ? 0 : clamp(acc / DT, 0, 1));
  updateHud();
  updateCrowns();

  if (st.over && !B.submitted) {
    B.submitted = true;
    // L2052 — the prototype waited 1400 ms after an instant win, 900 ms otherwise, so the
    // banner and the tower explosion are seen before the result modal covers them.
    const delay = st.endInstant ? 1400 : 900;
    const matchId = B.matchId;
    const log = B.deployLog.slice();
    setTimeout(() => cb?.onFinish(matchId, log), delay);
  }

  rafId = requestAnimationFrame(loop);
}

/**
 * Render at `alpha` between the last tick and the next.
 *
 * Positions are temporarily overwritten, drawn, then restored. Copying the unit array each
 * frame would be tidier but `render()` is a verbatim slice reading `u.x`/`u.y` directly, and
 * mutate-restore keeps the hot path allocation-free at 60 fps.
 */
function drawInterpolated(alpha: number): void {
  if (!B || !aCtx) return;
  const units = B.sim.state.units as Unit[];

  // Projectiles are deliberately not interpolated: they travel 11-26 tiles/s, so a whole
  // tick of motion is under half a tile, and the prototype drew them from raw positions too.
  if (alpha > 0) {
    for (let i = 0; i < units.length; i++) {
      const u = units[i] as Unit & { px?: number; py?: number };
      scratchX[i] = u.x;
      scratchY[i] = u.y;
      if (u.px !== undefined) {
        u.x = u.px + (u.x - u.px) * alpha;
        u.y = u.py! + (u.y - u.py!) * alpha;
      }
    }
  }

  render();

  if (alpha > 0) {
    for (let i = 0; i < units.length; i++) {
      units[i].x = scratchX[i];
      units[i].y = scratchY[i];
    }
  }
}

export function currentBattle(): BattleView | null {
  return B;
}
