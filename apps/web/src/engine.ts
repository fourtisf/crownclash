/**
 * Typed surface over the verbatim-sliced modules.
 *
 * `art.ts`, `render.ts`, `arenaBg.ts` and `sound.ts` carry `@ts-nocheck` because their
 * bodies are byte-for-byte copies of the prototype and annotating them would mean editing
 * the thing we are trying to keep unedited (see tools/extract.mjs). This module is the seam:
 * everything downstream imports from here and gets real types, while the slices stay pure.
 */
import * as artModule from './art';
import * as renderModule from './render';
import * as arenaBgModule from './arenaBg';
import * as soundModule from './sound';
import type { Card, TowerKind } from '@crown/shared';

/* ------------------------------------------------------------------------ art */

export interface UnitDrawOpts {
  /** Scale in pixels per tile. */
  s: number;
  /** Animation clock, seconds. */
  t?: number;
  /** Walk phase; 0 = idle. */
  walk?: number;
  /** Attack animation, 1 → 0. */
  atk?: number;
}

export interface ChestDrawOpts {
  s: number;
  open?: number;
  t?: number;
  x?: number;
  y?: number;
}

export interface TowerDrawOpts {
  s: number;
  dmgFlash?: number;
}

export interface ArtApi {
  /** Shadow-heavy effects are gated on this; the renderer drops it below 28 units. */
  hq: boolean;
  unit(c: CanvasRenderingContext2D, card: Card, o: UnitDrawOpts): void;
  chest(c: CanvasRenderingContext2D, kind: string, o: ChestDrawOpts): void;
  tower(c: CanvasRenderingContext2D, kind: TowerKind, team: 0 | 1, o: TowerDrawOpts): void;
  logo(c: CanvasRenderingContext2D, u: number): void;
  weapon(c: CanvasRenderingContext2D, kind: string, u: number, glow?: string | null): void;
  spellIcon(c: CanvasRenderingContext2D, icon: string, u: number, t: number): void;
}

export const Art: ArtApi = artModule.Art as unknown as ArtApi;

export const shade: (hex: string, amt: number) => string = artModule.shade;
export const rr: (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => void = artModule.rr;
export const ell: (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, col: string) => void = artModule.ell;
export const fitCanvas: (cv: HTMLCanvasElement, w: number, h: number) => CanvasRenderingContext2D = artModule.fitCanvas;
export const renderPortrait: (cv: HTMLCanvasElement, cardId: string, size?: number) => void = artModule.renderPortrait;

/* --------------------------------------------------------------------- arena bg */

export const buildArenaBG: () => void = arenaBgModule.buildArenaBG;
export const getArenaBG: () => HTMLCanvasElement | null = arenaBgModule.getArenaBG;
export const setArenaTrophies: (t: number) => void = arenaBgModule.setArenaTrophies;

/* ---------------------------------------------------------------------- render */

/**
 * The battle facade `render()` reads. Shape is deliberately identical to the prototype's
 * `B`: shared-sim state fields merged with the client-only FX collections and view fields.
 */
export interface RenderFacade {
  sc: number;
  time: number;
  /** Seconds since the previous rendered frame — drives weather and water, not the sim. */
  dt: number;
  over: boolean;
  selected: number;
  ghost: { x: number; y: number } | null;
  shake: number;
  hand: string[];
  units: unknown[];
  projs: unknown[];
  spells: unknown[];
  parts: unknown[];
  floats: unknown[];
  rings: unknown[];
}

export const bindRenderer: (battle: RenderFacade, ctx: CanvasRenderingContext2D) => void = renderModule.bindRenderer;
export const render: () => void = renderModule.render;
export const unitTopY: (u: { y: number; kind: string }) => number = renderModule.unitTopY;

/* ----------------------------------------------------------------------- sound */

export interface SndApi {
  ctx: AudioContext | null;
  init(): void;
  play(freq: number, dur: number, type?: string, vol?: number, slide?: number): void;
  noise(dur: number, vol?: number): void;
  hit(): void;
  slash(): void;
  deploy(): void;
  boom(): void;
  coin(): void;
  crown(): void;
  win(): void;
  lose(): void;
  tick(): void;
}

export const Snd: SndApi = soundModule.Snd as unknown as SndApi;
export const setSfxEnabled: (on: boolean) => void = soundModule.setSfxEnabled;
