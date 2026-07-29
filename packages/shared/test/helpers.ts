/**
 * Test helpers: a scripted "player bot" that produces a realistic deploy log.
 *
 * The bot is used two ways:
 *  - as a *play-through*, where it decides moves live against the sim and records them;
 *  - as a *replay*, where the recorded log is fed back through `runMatch`.
 *
 * If those two ever disagree, the server would void honest matches — which is precisely the
 * failure mode the determinism suite exists to catch.
 */
import { AH, AW, CARD, RIV_B, aiLevelFor, aiDeckIndexFor, arenaFor } from '../src/data.js';
import { Rng } from '../src/rng.js';
import { Sim } from '../src/sim.js';
import { aiUpdate } from '../src/ai.js';
import { STARTER_DECK } from '../src/state.js';
import type { DeployLogEntry, SimConfig } from '../src/types.js';
import { MIN_DEPLOY_GAP_TICKS } from '../src/validate.js';

export function cfgFor(seed: string, trophies = 0, deck: string[] = STARTER_DECK): SimConfig {
  const { i } = arenaFor(trophies);
  const levels: Record<string, number> = {};
  for (const id of deck) levels[id] = 1;
  return {
    seed,
    myDeck: deck.slice(),
    myCardLevels: levels,
    myKingLevel: 1,
    aiDeckIndex: aiDeckIndexFor(i),
    aiLevel: aiLevelFor(trophies),
  };
}

export interface PlaythroughResult {
  sim: Sim;
  log: DeployLogEntry[];
}

/**
 * Run a full match with a bot on team 0, recording everything it plays.
 *
 * `botSeed` is deliberately independent of the match seed: the bot stands in for a human,
 * and a human's choices are not derivable from the match seed. Keeping the streams separate
 * proves the replay depends only on (match seed + log), which is what the server has.
 */
export function playthrough(cfg: SimConfig, botSeed: string, opts: { aggression?: number } = {}): PlaythroughResult {
  const sim = new Sim(cfg);
  const bot = new Rng(botSeed);
  const log: DeployLogEntry[] = [];
  const aggression = opts.aggression ?? 0.5;
  let nextTry = 0;

  while (!sim.state.over && sim.state.tick < 8000) {
    const tick = sim.state.tick;
    if (tick >= nextTry) {
      // Try up to 4 hand slots; take the first legal, affordable play.
      for (let attempt = 0; attempt < 4; attempt++) {
        const i = bot.rndi(0, 3);
        const cid = sim.state.hand[i];
        const card = CARD[cid];
        if (!card || sim.state.elix[0] < card.cost) continue;
        const x = bot.rnd(1.2, AW - 1.2);
        const y = card.t === 'spell' ? bot.rnd(2, AH - 2) : bot.rnd(RIV_B + 1.3, AH - 1.5);
        if (!sim.canDeployAt(0, x, y, card)) continue;
        if (sim.playHand(i, x, y)) {
          log.push({ t: tick, cardId: cid, x, y });
          // Respect the server's 300 ms floor so generated logs are always submittable.
          nextTry = tick + MIN_DEPLOY_GAP_TICKS + bot.rndi(0, 40);
        }
        break;
      }
      if (tick >= nextTry) nextTry = tick + 1 + bot.rndi(0, Math.round(30 * (1 - aggression) + 4));
    }
    sim.tick(aiUpdate);
  }
  return { sim, log };
}

/** Damage helper for scripted scenarios — reaches into state deliberately, tests only. */
export function weakenTowers(sim: Sim, team: 0 | 1, hp: number): void {
  for (const u of sim.state.units) {
    if (u.kind === 'tower' && u.team === team) {
      u.hp = hp;
      u.maxHp = Math.max(u.maxHp, hp);
    }
  }
}
