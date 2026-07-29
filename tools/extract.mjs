#!/usr/bin/env node
/**
 * Verbatim extractor.
 *
 * The prototype (`reference/crown-clash.html`) is the source of truth for the art engine,
 * the stylesheet, the arena backdrop and the battle renderer. Re-typing those by hand is how
 * a port silently changes what the game looks like, so we don't: this script slices exact
 * line ranges out of the HTML and wraps them with a generated prelude/postlude.
 *
 *   node tools/extract.mjs          write the generated files
 *   node tools/extract.mjs --check  fail if a committed file's slice drifted from the HTML
 *
 * Handoff §1: "Write a test that ... diffs them against data.ts so drift is impossible."
 * This is the stronger form of that rule for the files that are pure presentation.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'reference', 'crown-clash.html');

const BEGIN = (a, b) => `/* ==== BEGIN VERBATIM SLICE — crown-clash.html L${a}-L${b} ==== */`;
const END = '/* ==== END VERBATIM SLICE ==== */';
const CSS_BEGIN = (a, b) => `/* ==== BEGIN VERBATIM SLICE — crown-clash.html L${a}-L${b} ==== */`;

const BANNER = `/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 *
 * The region between the VERBATIM SLICE markers is copied byte-for-byte out of
 * reference/crown-clash.html. Regenerate with \`pnpm extract\`; \`pnpm extract:check\`
 * fails the build if it drifts. Edit the prototype, not this file.
 *
 * These files carry @ts-nocheck on purpose: type-annotating them would mean editing the
 * slice, which is exactly what we are preventing. The typed surface lives in engine.ts.
 */
// @ts-nocheck
/* eslint-disable */
`;

/** @type {{out:string, from:number, to:number, lang?:'css', prelude:string, postlude:string}[]} */
const TARGETS = [
  {
    out: 'apps/web/src/styles.css',
    from: 10,
    to: 492,
    lang: 'css',
    prelude: `/* AUTO-GENERATED from reference/crown-clash.html — DO NOT EDIT. Run \`pnpm extract\`. */\n`,
    postlude: '',
  },
  {
    out: 'apps/web/src/art.ts',
    from: 802,
    to: 1337,
    prelude: `${BANNER}
import { clamp } from '@crown/shared';
import { CARD, CHESTS, RARITY } from '@crown/shared';
`,
    postlude: `
export {
  shade, rr, ell, circ, limb, fitCanvas,
  Art, OL, ols, vg, shp, pill, disc, rim, gsh, face,
  renderPortrait,
};
`,
  },
  {
    out: 'apps/web/src/arenaBg.ts',
    from: 1478,
    to: 1651,
    prelude: `${BANNER}
import { AW, AH, RIV_T, RIV_B, BRIDGE, arenaFor } from '@crown/shared';
import { fitCanvas, rr, shade } from './art';

/**
 * The slice reads \`S.trophies\` (to pick the arena palette) and assigns the module-level
 * \`arenaBG\` at the end of buildArenaBG(). Both are declared here so the slice stays untouched.
 *
 * \`arenaBG\` is exported as a \`let\` on purpose: ES module live bindings mean render.ts sees
 * the new canvas the moment buildArenaBG() reassigns it, exactly as it saw the prototype's
 * shared global. A getter would have worked too, but the slice writes \`arenaBG=cv\` verbatim.
 */
let S = { trophies: 0 };
export let arenaBG = null;

export function setArenaTrophies(t) { S = { trophies: t | 0 }; }
export function getArenaBG() { return arenaBG; }
`,
    postlude: `
export { buildArenaBG };
`,
  },
  {
    out: 'apps/web/src/render.ts',
    from: 2060,
    to: 2226,
    prelude: `${BANNER}
import { AW, AH, RIV_B, CARD, clamp, lerp } from '@crown/shared';
import { towerAlive as simTowerAlive, canDeployAt as simCanDeployAt } from '@crown/shared';
import { Art, rr, ell } from './art';
import { arenaBG } from './arenaBg';

/**
 * Presentation-only randomness (screen shake). Deliberately NOT \`Rng\` from @crown/shared:
 * shared exposes randomness solely on a seeded stream so no simulation code can reach for an
 * unseeded one. Jitter on a camera shake has no bearing on the match result, so it uses
 * Math.random directly and stays out of the seeded stream entirely.
 */
const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * \`B\` is the battle facade the screen assigns before each frame: the shared sim's state
 * plus the client-only FX collections (parts/floats/rings) and view fields (sc, ghost,
 * selected, shake). Keeping its shape identical to the prototype's \`B\` is what lets
 * render() below stay a verbatim slice.
 */
let B = null;
let aCtx = null;

export function bindRenderer(battle, ctx) { B = battle; aCtx = ctx; }

/* The prototype read the ambient \`B\`/\`arenaBG\` globals; these shims preserve the call
   signatures the slice uses while the real implementations take explicit state. */
const towerAlive = (team, side) => simTowerAlive(B, team, side);
const canDeployAt = (team, x, y, card) => simCanDeployAt(B, team, x, y, card);
`,
    postlude: `
export { render, unitTopY, drawBar };
`,
  },
  {
    out: 'apps/web/src/sound.ts',
    from: 1342,
    to: 1374,
    prelude: `${BANNER}
/**
 * Presentation-only randomness — see the note in render.ts. \`Snd.hit()\` detunes each blip
 * with \`rnd(220,320)\`; that must never touch the simulation's seeded stream.
 */
const rnd = (a, b) => a + Math.random() * (b - a);

/** The slice gates every cue on \`S.sfx\`; the screen keeps this mirror in sync with the save. */
let S = { sfx: true };
export function setSfxEnabled(on) { S = { sfx: !!on }; }
`,
    postlude: `
export { Snd };
`,
  },
];

function sliceOf(lines, from, to) {
  // 1-indexed inclusive, matching the line numbers used throughout docs/EXTRACTION-PLAN.md
  return lines.slice(from - 1, to).join('\n');
}

function build(target, lines) {
  const body = sliceOf(lines, target.from, target.to);
  const begin = target.lang === 'css' ? CSS_BEGIN(target.from, target.to) : BEGIN(target.from, target.to);
  return `${target.prelude}\n${begin}\n${body}\n${END}\n${target.postlude}`;
}

function extractCommittedSlice(text, from, to) {
  const begin = BEGIN(from, to);
  const i = text.indexOf(begin);
  if (i < 0) return null;
  const j = text.indexOf(END, i);
  if (j < 0) return null;
  return text.slice(i + begin.length, j).replace(/^\n/, '').replace(/\n$/, '');
}

const check = process.argv.includes('--check');
if (!existsSync(SRC)) {
  console.error(`✗ missing ${SRC} — the prototype must be vendored for extraction to work`);
  process.exit(1);
}
const lines = readFileSync(SRC, 'utf8').split('\n');

let failed = 0;
for (const t of TARGETS) {
  const abs = join(ROOT, t.out);
  const next = build(t, lines);
  if (check) {
    if (!existsSync(abs)) {
      console.error(`✗ ${t.out} — not generated yet`);
      failed++;
      continue;
    }
    const committed = readFileSync(abs, 'utf8');
    const want = sliceOf(lines, t.from, t.to);
    const got = extractCommittedSlice(committed, t.from, t.to);
    if (got === null) {
      console.error(`✗ ${t.out} — slice markers for L${t.from}-L${t.to} missing or malformed`);
      failed++;
    } else if (got !== want) {
      const wl = want.split('\n');
      const gl = got.split('\n');
      const at = wl.findIndex((l, i) => gl[i] !== l);
      console.error(
        `✗ ${t.out} — drifted from crown-clash.html at slice line ${at + 1} (HTML L${t.from + at})\n` +
          `    html: ${JSON.stringify(wl[at])}\n    file: ${JSON.stringify(gl[at])}`,
      );
      failed++;
    } else {
      console.log(`✓ ${t.out} — verbatim (L${t.from}-L${t.to}, ${want.split('\n').length} lines)`);
    }
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, next);
    console.log(`→ ${t.out} (L${t.from}-L${t.to}, ${t.to - t.from + 1} lines verbatim)`);
  }
}

if (failed) {
  console.error(`\n${failed} file(s) drifted from the prototype. Run \`pnpm extract\` or revert the edit.`);
  process.exit(1);
}
if (check) console.log('\nAll verbatim slices match reference/crown-clash.html.');
