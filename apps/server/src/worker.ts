/**
 * The `worker` process (PM2 app #2, handoff §3.4: "PM2 two processes (`api`, worker for match
 * re-sim)").
 *
 * It exists so that work which is *not* on a player's critical path stops competing with
 * requests for the API's event loop. Three jobs, run on one interval:
 *
 * ### 1. Audit re-simulation — the determinism canary
 *
 * `/api/match/finish` already re-simulates and that result is authoritative. The worker
 * replays every finished match a **second** time, from the stored config and log, and compares
 * `Sim.hash()` against what the API recorded. Under normal operation the two always agree —
 * which is the point. The day they disagree, something in the sim has become non-deterministic
 * (a stray `Math.random()`, a `Map` iteration order, a float that behaves differently on a new
 * V8), and the entire anti-cheat model has silently stopped working. That failure is otherwise
 * invisible: honest players would just start getting matches voided at random.
 *
 * A mismatch is flagged on the row and logged at `error`. It deliberately does **not** claw
 * back rewards — if the sim is the thing that broke, punishing the player for it is the wrong
 * response.
 *
 * ### 2. Leaderboard snapshot
 *
 * Recomputes the cached top-100 on a fixed cadence instead of letting whichever unlucky player
 * hits the expired key pay for the scan. Same cache key, same shape, same code path as the
 * request-time refresh.
 *
 * ### 3. Reaping
 *
 * Matches started and never finished (app killed, tab closed, connection dropped) are voided
 * once they pass `MATCH_EXPIRY_MINUTES`, so the audit table has no permanently-open rows and
 * `/match/finish` cannot be used to accumulate a stock of un-submitted matches to replay later
 * against a levelled-up account. Expired wallet nonces are deleted in the same pass.
 *
 * The worker is safe to run alongside the API on one box and safe to run as several copies:
 * job claiming goes through a Redis consumer group, and the reaping queries are idempotent
 * conditional updates.
 */
import { pathToFileURL } from 'node:url';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { RKEY, createRedis, type RedisBridge } from './lib/redis.js';
import { PrismaStore } from './lib/store-prisma.js';
import type { Store } from './lib/store.js';
import { topRows } from './routes/leaderboard.js';
import { resimulate } from './routes/match.js';

export interface WorkerDeps {
  store: Store;
  redis: RedisBridge;
}

export interface CycleReport {
  audited: number;
  mismatches: number;
  expiredMatches: number;
  purgedNonces: number;
  leaderboardRows: number;
}

const CONSUMER = `worker-${process.pid}`;
const BATCH = 32;

export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ready = false;

  constructor(
    private readonly deps: WorkerDeps,
    private readonly tickMs: number = env.WORKER_TICK_MS,
  ) {}

  private async ensureGroup(): Promise<void> {
    if (this.ready) return;
    await this.deps.redis.client.xgroupCreate(RKEY.resimStream, RKEY.resimGroup);
    this.ready = true;
  }

  /** One full pass. Exported behaviour: safe to call directly, and the tests do. */
  async once(): Promise<CycleReport> {
    await this.ensureGroup();
    const report: CycleReport = {
      audited: 0,
      mismatches: 0,
      expiredMatches: 0,
      purgedNonces: 0,
      leaderboardRows: 0,
    };

    /* 1. audit re-simulation */
    // BLOCK is short: the loop below drains what is queued and then the interval takes over.
    const jobs = await this.deps.redis.client.xreadgroup(RKEY.resimStream, RKEY.resimGroup, CONSUMER, BATCH, 100);
    for (const job of jobs) {
      const matchId = job.fields.matchId;
      const expected = job.fields.hash;
      try {
        const match = await this.deps.store.getMatch(matchId);
        if (match && match.deployLog) {
          const { hash, ok } = resimulate(match);
          report.audited++;
          if (!ok || hash !== expected) {
            report.mismatches++;
            logger.error(
              { matchId, expected, got: hash, terminated: ok },
              'AUDIT MISMATCH — the simulation is no longer deterministic; match validation cannot be trusted',
            );
            await this.deps.store.completeMatch(matchId, { validated: false, voidReason: 'audit:hash-mismatch' });
          }
        }
      } catch (err) {
        logger.error({ err, matchId }, 'audit re-sim failed');
      } finally {
        // Acked either way: a job that throws twice will throw a third time, and leaving it
        // pending forever would make the stream grow without bound.
        await this.deps.redis.client.xack(RKEY.resimStream, RKEY.resimGroup, job.id).catch(() => undefined);
      }
    }

    /* 2. leaderboard snapshot */
    try {
      const rows = await topRows(this.deps.store, this.deps.redis.client, { refresh: true });
      report.leaderboardRows = rows.length;
    } catch (err) {
      logger.error({ err }, 'leaderboard snapshot failed');
    }

    /* 3. reaping */
    const now = new Date();
    try {
      const cutoff = new Date(now.getTime() - env.MATCH_EXPIRY_MINUTES * 60_000);
      report.expiredMatches = await this.deps.store.expireMatches(cutoff, now);
      report.purgedNonces = await this.deps.store.purgeNonces(now);
    } catch (err) {
      logger.error({ err }, 'reaping failed');
    }

    if (report.audited || report.mismatches || report.expiredMatches || report.purgedNonces) {
      logger.info(report, 'worker cycle');
    }
    return report;
  }

  start(): void {
    if (this.timer) return;
    const tick = () => {
      // Skip rather than overlap: an audit pass that outruns the interval must not stack.
      if (this.running) return;
      this.running = true;
      void this.once()
        .catch((err) => logger.error({ err }, 'worker cycle failed'))
        .finally(() => {
          this.running = false;
        });
    };
    this.timer = setInterval(tick, this.tickMs);
    tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Entry point. Skipped when this module is imported by a test. */
async function main(): Promise<void> {
  const deps: WorkerDeps = { store: new PrismaStore(), redis: createRedis() };
  const worker = new Worker(deps);

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    worker.stop();
    void Promise.allSettled([deps.store.close(), deps.redis.close()]).then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  worker.start();
  logger.info({ tickMs: env.WORKER_TICK_MS }, 'worker started');
}

// Only run the loop when this file *is* the process entry. `import { Worker } from
// './worker.js'` in a test must not spin up a background interval.
const entry = process.argv[1];
if (entry && pathToFileURL(entry).href === import.meta.url) {
  main().catch((err) => {
    logger.fatal({ err }, 'worker failed to start');
    process.exit(1);
  });
}
