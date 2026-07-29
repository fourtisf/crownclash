/**
 * Match start / finish — the core of handoff §3.3.
 *
 * The contract in one line: **the server's re-simulation is the result.** The client sends a
 * deploy log, never an outcome, and nothing in the finish payload other than that log can
 * influence what the server computes.
 *
 * Three things make that true rather than aspirational:
 *
 *  1. The `SimConfig` is frozen at start and stored. Re-simulation reads it from the row, so
 *     a player who levels a card between start and finish replays at the old level, and a
 *     client that posts a different deck is simply ignored.
 *  2. The seed is `randomSeed()` on the server. A chosen seed is a chosen AI opening and a
 *     chosen deck shuffle; letting the client pick one would make "fair" matches farmable.
 *  3. The match is *claimed* (`finishedAt: null → now`, one conditional write) **before** the
 *     re-sim runs. Two concurrent submissions of the same match therefore cannot both reach
 *     `applyMatchRewards`, so a double payout is impossible rather than unlikely.
 *
 * A rejected log does not throw. The match is recorded as voided with a machine-readable
 * reason, pays nothing, and returns 200 with `voided` set — the client needs to show a result
 * screen either way, and a 4xx would tell a cheater exactly which check they tripped.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AI_AVATARS, AI_DECKS, AI_NAMES, API_ERRORS, Rng, aiDeckIndexFor, aiLevelFor, aiUpdate, applyMatchRewards,
  arenaFor, deckLevels, randomSeed, runMatch, validateDeployLog, MATCH_SECONDS, OVERTIME_SECONDS, TICK_HZ,
  type DeployLogEntry, type MatchFinishResponse, type MatchRewards, type MatchStartResponse, type SimConfig,
} from '@crown/shared';
import { requireUser } from '../lib/auth.js';
import { HttpError, SERVER_ERRORS, badRequest, unauthorized } from '../lib/errors.js';
import { LIMITS, limit } from '../lib/ratelimit.js';
import { loadSave, mutateSave, repairSave } from '../lib/saves.js';
import { RKEY } from '../lib/redis.js';
import type { MatchRow, Store, UserRow } from '../lib/store.js';

/** Hard ceiling for a concede tick: regulation + sudden death. */
const MAX_MATCH_TICKS = (MATCH_SECONDS + OVERTIME_SECONDS) * TICK_HZ;

const finishSchema = z.object({
  matchId: z.string().min(1).max(64),
  deployLog: z.array(
    z.object({
      t: z.number().int().min(0).max(1_000_000),
      cardId: z.string().min(1).max(32),
      x: z.number().finite(),
      y: z.number().finite(),
    }),
  ),
  conceded: z.boolean().optional(),
  concededAtTick: z.number().int().min(0).max(1_000_000).optional(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const res = schema.safeParse(body);
  if (!res.success) throw badRequest(SERVER_ERRORS.badRequest, res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
  return res.data;
}

async function requireUserRow(store: Store, req: FastifyRequest): Promise<UserRow> {
  const user = await store.userById(req.userId!);
  if (!user) throw unauthorized('session refers to a deleted account');
  return user;
}

/** Payout-free rewards block, so a voided match still has the shape the client renders. */
function noRewards(trophies: number): MatchRewards {
  return {
    result: 'draw',
    trophiesBefore: trophies,
    trophiesAfter: trophies,
    delta: 0,
    gold: 0,
    xp: 0,
    levelsGained: 0,
    chest: null,
  };
}

export interface ResimJob {
  matchId: string;
  hash: string;
}

export async function matchRoutes(app: FastifyInstance): Promise<void> {
  const store = app.store;

  app.post(
    '/api/match/start',
    { preHandler: requireUser, config: limit(LIMITS.matchStart) },
    async (req): Promise<MatchStartResponse> => {
      const user = await requireUserRow(store, req);
      const { save } = await loadSave(store, user);

      // L1439-1446 — arena, AI deck and AI level all derive from the player's trophies.
      const { i: arenaIndex } = arenaFor(save.trophies);
      const aiDeckIndex = aiDeckIndexFor(arenaIndex);
      const aiLevel = aiLevelFor(save.trophies);

      const cfg: SimConfig = {
        seed: randomSeed(),
        myDeck: save.deck.slice(),
        myCardLevels: deckLevels(save),
        myKingLevel: save.lvl,
        aiDeckIndex,
        aiLevel,
      };

      // Cosmetic only, and off a *different* stream from the match seed so that seeing the
      // opponent's name tells the client nothing about the sim. L1409 verbatim: ±45 trophies.
      const flavour = new Rng(randomSeed());
      const opponent = {
        name: flavour.pick(AI_NAMES),
        avatar: flavour.pick(AI_AVATARS),
        trophies: Math.max(0, save.trophies + flavour.rndi(-45, 45)),
      };

      const match = await store.createMatch({
        userId: user.id,
        seed: cfg.seed,
        mode: 'ai',
        config: cfg,
        aiDeck: AI_DECKS[aiDeckIndex].slice(),
        aiLevel,
        arenaIndex,
        opponent,
      });

      return {
        matchId: match.id,
        seed: cfg.seed,
        aiDeckIndex,
        aiLevel,
        aiName: opponent.name,
        aiAvatar: opponent.avatar,
        aiTrophies: opponent.trophies,
        myDeck: cfg.myDeck,
        myCardLevels: cfg.myCardLevels,
        myKingLevel: cfg.myKingLevel,
      };
    },
  );

  app.post(
    '/api/match/finish',
    { preHandler: requireUser, config: limit(LIMITS.matchFinish) },
    async (req): Promise<MatchFinishResponse> => {
      const body = parse(finishSchema, req.body);
      const user = await requireUserRow(store, req);

      const match = await store.getMatch(body.matchId);
      // Wrong owner reads as "not found" so match ids cannot be probed for existence.
      if (!match || match.userId !== user.id) {
        throw new HttpError(404, API_ERRORS.matchNotFound, 'no such match for this account');
      }
      if (match.finishedAt) {
        throw new HttpError(409, API_ERRORS.matchAlreadyFinished, 'match already submitted');
      }
      // Claim before simulating: whoever loses this race never reaches the payout.
      const claimed = await store.claimMatch(match.id, new Date());
      if (!claimed) {
        throw new HttpError(409, API_ERRORS.matchAlreadyFinished, 'match already submitted');
      }

      const cfg = match.config;
      const deployLog = body.deployLog as DeployLogEntry[];

      const voided = async (reason: string): Promise<MatchFinishResponse> => {
        req.log.warn({ userId: user.id, matchId: match.id, reason }, 'match voided');
        await store.completeMatch(match.id, {
          deployLog,
          result: null,
          crowns: null,
          validated: false,
          voidReason: reason,
        });
        // `repairSave` rather than a bare `loadSave`: loading rolls the day's quests, and
        // handing the client a quest set that was never stored would leave it showing three
        // quests the next `GET /api/save` replaces with three different ones.
        const save = await repairSave(store, user);
        return { result: 'draw', crowns: [0, 0], rewards: noRewards(save.trophies), save, voided: { reason } };
      };

      // Stage 1: structure. Ordering, deploy rate, unknown cards, cards outside the *stored*
      // deck. Cheap, and it runs before any CPU is spent on a simulation.
      const structural = validateDeployLog(deployLog, cfg.myDeck);
      if (!structural.ok) return voided(`log:${structural.reason}`);

      // A concession still replays the log in full — giving up is not a way to launder a
      // tampered log. The only thing it changes is where the simulation stops and what the
      // outcome is: the player asked to lose, so they lose, and the crowns reported are the
      // ones that were actually on the board when they quit.
      //
      // Trusting `conceded` costs nothing, because it can only ever *reduce* the reward.
      const lastLogTick = deployLog.length ? deployLog[deployLog.length - 1].t : 0;
      const concedeTick = body.conceded
        ? Math.max(lastLogTick + 1, Math.min(body.concededAtTick ?? 0, MAX_MATCH_TICKS))
        : undefined;

      // Stage 2: the authoritative replay. `runMatch` returns `illegal` the moment a logged
      // deploy is not playable at that tick — not enough elixir, wrong half, card not in hand.
      const { sim, illegal } = runMatch(cfg, deployLog, aiUpdate, concedeTick ? { maxTicks: concedeTick } : {});
      if (illegal) return voided(`sim:${illegal.reason}`);
      // A conceded match is expected to stop mid-play, so `over` is only required otherwise.
      if (!body.conceded && (!sim.state.over || !sim.state.endResult)) return voided('sim:did-not-terminate');

      const result = body.conceded ? 'lose' : sim.state.endResult!;
      const crowns: [number, number] = [sim.state.crowns[0], sim.state.crowns[1]];
      const hash = sim.hash();

      // Rewards roll off their own seed. Off the match seed the client could compute its win
      // chest before deciding whether to submit at all.
      const rewardSeed = randomSeed();
      // Compare-and-set, because the payout is the most expensive thing on this save to lose:
      // a deck edit or a chest open in flight would otherwise write back a document read before
      // the match ended and silently erase trophies the player was just told they had won.
      // The `Rng` is built *inside* the closure so a retry replays the identical roll — the
      // reward must not change because an unrelated request happened to overlap.
      const { result: rewards, save: persisted } = await mutateSave(store, user, (s) =>
        applyMatchRewards(new Rng(rewardSeed), s, result, sim.state.stat),
      );

      await store.completeMatch(match.id, {
        deployLog,
        result,
        crowns,
        validated: true,
        voidReason: null,
        resultHash: hash,
        rewardSeed,
        trophyDelta: rewards.delta,
      });

      // Fire-and-forget audit job. The worker replays the match a second time and compares
      // hashes; a mismatch means the sim stopped being deterministic, which would quietly
      // invalidate the entire anti-cheat model. Enqueue failures must never fail a match.
      const job: ResimJob = { matchId: match.id, hash };
      app.redis.client
        .xadd(RKEY.resimStream, { matchId: job.matchId, hash: job.hash })
        .catch((err: unknown) => req.log.error({ err }, 'failed to enqueue re-sim audit job'));

      req.log.info(
        { userId: user.id, matchId: match.id, result, crowns, hash, delta: rewards.delta },
        'match validated',
      );

      return { result, crowns, rewards, save: persisted };
    },
  );
}

/** Shared by the worker: replay a stored match exactly as `/finish` did. */
export function resimulate(match: Pick<MatchRow, 'config' | 'deployLog'>): { hash: string; ok: boolean } {
  const { sim, illegal } = runMatch(match.config, match.deployLog ?? [], aiUpdate);
  return { hash: sim.hash(), ok: !illegal && sim.state.over };
}
