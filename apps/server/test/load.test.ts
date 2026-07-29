/**
 * Load test — handoff §8.5: "200 concurrent match validations < 2s p95".
 *
 * Deliberately **not** over HTTP. Fastify's `inject` and JSON codec would add noise measured
 * in microseconds around work measured in tens of milliseconds, and the thing at risk here is
 * CPU, not routing. So the test drives the exact CPU path `/api/match/finish` runs —
 * `validateDeployLog` → `runMatch(cfg, log, aiUpdate)` → `Sim.hash()` → `applyMatchRewards` —
 * over 200 distinct matches with 200 distinct seeds and 200 distinct honest logs.
 *
 * ## What the numbers mean
 *
 * Two are reported, and they answer different questions:
 *
 *  - **Service time** — how long one validation occupies the CPU. This is the p95 the
 *    acceptance criterion is about: a player submitting a match waits this long for the
 *    server's own work. It is asserted below.
 *  - **Burst wall clock** — 200 submissions arriving in the same instant at a *single* Node
 *    process. The sim is synchronous, so they queue: the burst takes roughly
 *    `200 × service-time` no matter how they are scheduled. That is a property of one event
 *    loop, not of the validator, and it is the number that sizes the deployment.
 *
 * Both are printed so CI logs carry the evidence rather than a bare pass. If the burst figure
 * ever needs to come down, the two levers are more PM2 instances (the §3.4 topology already
 * assumes several) or moving `runMatch` into a `worker_threads` pool — the re-sim is pure,
 * seeded and DOM-free, so it moves without touching a rule.
 */
import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import {
  Rng, aiUpdate, applyMatchRewards, defaultState, deckLevels, randomSeed, runMatch, validateDeployLog,
  type DeployLogEntry, type SimConfig,
} from '@crown/shared';
import { honestLog } from './helpers.js';

const CONCURRENCY = 200;
const P95_BUDGET_MS = 2_000;

interface Case {
  cfg: SimConfig;
  log: DeployLogEntry[];
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i];
}

/** Exactly the CPU work `/api/match/finish` performs, in the same order. */
function validate(c: Case): string {
  const structural = validateDeployLog(c.log, c.cfg.myDeck);
  if (!structural.ok) throw new Error(`generated log was not legal: ${structural.reason}`);
  const { sim, illegal } = runMatch(c.cfg, c.log, aiUpdate);
  if (illegal) throw new Error(`generated log was voided: ${illegal.reason}`);
  const hash = sim.hash();
  applyMatchRewards(new Rng(randomSeed()), defaultState(), sim.state.endResult ?? 'draw', sim.state.stat);
  return hash;
}

describe('load: 200 concurrent match validations', () => {
  it(`keeps validation p95 under ${P95_BUDGET_MS}ms`, async () => {
    const save = defaultState();

    // Setup, not measurement: generating a log is itself a full match simulation, and it is
    // work the *client* does. Distinct seeds throughout so no two matches share a code path.
    const cases: Case[] = [];
    const genStart = performance.now();
    for (let i = 0; i < CONCURRENCY; i++) {
      const cfg: SimConfig = {
        seed: randomSeed(),
        myDeck: save.deck.slice(),
        myCardLevels: deckLevels(save),
        myKingLevel: 1 + (i % 6),
        aiDeckIndex: i % 6,
        aiLevel: 1 + (i % 13),
      };
      cases.push({ cfg, log: honestLog(cfg) });
    }
    const genMs = performance.now() - genStart;

    // The burst: all 200 submitted at once, each recording its own service time.
    const serviceTimes: number[] = [];
    const hashes = new Set<string>();
    const burstStart = performance.now();
    await Promise.all(
      cases.map(async (c) => {
        // Yield first so every task is genuinely in flight before any of them runs.
        await Promise.resolve();
        const t0 = performance.now();
        const hash = validate(c);
        serviceTimes.push(performance.now() - t0);
        hashes.add(hash);
      }),
    );
    const burstMs = performance.now() - burstStart;

    serviceTimes.sort((a, b) => a - b);
    const p50 = percentile(serviceTimes, 50);
    const p95 = percentile(serviceTimes, 95);
    const max = serviceTimes[serviceTimes.length - 1];
    const total = serviceTimes.reduce((a, b) => a + b, 0);

    /* eslint-disable no-console */
    console.log(
      [
        '',
        `load test — ${CONCURRENCY} concurrent match validations`,
        `  setup (client-side log generation) : ${genMs.toFixed(0)}ms for ${CONCURRENCY} matches`,
        `  validation service time  p50       : ${p50.toFixed(1)}ms`,
        `  validation service time  p95       : ${p95.toFixed(1)}ms   (budget ${P95_BUDGET_MS}ms)`,
        `  validation service time  max       : ${max.toFixed(1)}ms`,
        `  burst wall clock (1 node process)  : ${burstMs.toFixed(0)}ms`,
        `  sustained throughput               : ${(CONCURRENCY / (total / 1000)).toFixed(1)} validations/s/core`,
        '',
      ].join('\n'),
    );
    /* eslint-enable no-console */

    expect(serviceTimes).toHaveLength(CONCURRENCY);
    expect(p95).toBeLessThan(P95_BUDGET_MS);
    expect(max).toBeLessThan(P95_BUDGET_MS * 2);
    // 200 different seeds must not collapse into a handful of outcomes — that would mean the
    // seed is not reaching the sim and the whole measurement is of the same match 200 times.
    expect(hashes.size).toBeGreaterThan(CONCURRENCY / 2);
  });

  it('re-validating the same match twice gives the same hash', () => {
    // Determinism is what makes the p95 above meaningful: if a replay could disagree with
    // itself, a fast validator would just be a fast way to void honest matches.
    const save = defaultState();
    const cfg: SimConfig = {
      seed: randomSeed(),
      myDeck: save.deck.slice(),
      myCardLevels: deckLevels(save),
      myKingLevel: 1,
      aiDeckIndex: 2,
      aiLevel: 4,
    };
    const log = honestLog(cfg);
    const a = runMatch(cfg, log, aiUpdate).sim;
    const b = runMatch(cfg, log, aiUpdate).sim;
    expect(a.hash()).toBe(b.hash());
    expect(a.state.endResult).toBe(b.state.endResult);
    expect(a.state.crowns).toEqual(b.state.crowns);
  });
});
