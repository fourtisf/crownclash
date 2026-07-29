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
 *
 * ## Scope, after the art fork
 *
 * `art.ts`, `render.ts` and `arenaBg.ts` were originally slices too. The owner asked for a
 * modernised look, which cannot be done to a file that must stay byte-identical, so those
 * three were released and are now maintained by hand. Their headers record the line ranges
 * they came from.
 *
 * What still matters is unchanged: `packages/shared/test/data-parity.test.ts` keeps every
 * gameplay constant locked to the prototype. Art is presentation; `data.ts` is the game.
 * `styles.css` (the app chrome, which was not part of the restyle) and `sound.ts` stay
 * verbatim because nothing has asked them to change.
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
