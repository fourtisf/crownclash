/**
 * Test rig.
 *
 * Everything here runs with **no Postgres and no Redis**: `buildApp` is handed a `MemoryStore`
 * and a `MemoryRedis`, so the tests exercise the real Fastify stack — hooks, cookies, zod
 * parsing, error mapping, the actual route handlers — rather than a mock of it.
 *
 * The interesting part is `honestLog`. A deploy log is only meaningful relative to the sim
 * state it was produced against: which cards were in hand, how much elixir was banked, which
 * tick it is. So the generator *plays the match* against a local `Sim` built from the same
 * config, mirroring `runMatch`'s loop exactly (deploys for tick N are applied before
 * `tick()`), and records what it played. Replaying that log through the server reproduces the
 * same sim byte for byte — which is the whole premise of the anti-cheat design, so a test rig
 * that fudged it would prove nothing.
 */
import type { FastifyInstance } from 'fastify';
import {
  CARD, DT, MATCH_SECONDS, OVERTIME_SECONDS, Sim, aiUpdate, type DeployLogEntry, type SimConfig,
} from '@crown/shared';
import { buildApp } from '../src/app.js';
import { env } from '../src/lib/env.js';
import { MemoryRedis, type RedisBridge } from '../src/lib/redis.js';
import { MemoryStore } from '../src/lib/store-memory.js';

export interface TestRig {
  app: FastifyInstance;
  store: MemoryStore;
  redis: RedisBridge;
  close(): Promise<void>;
}

export function memoryRedis(): RedisBridge {
  return { client: new MemoryRedis(), raw: null, isFallback: true, close: async () => undefined };
}

export async function makeRig(): Promise<TestRig> {
  const store = new MemoryStore();
  const redis = memoryRedis();
  const app = await buildApp({ store, redis, rateLimit: false, websocket: false });
  await app.ready();
  return { app, store, redis, close: () => app.close() };
}

/* ------------------------------------------------------------------ http agent */

/**
 * The slice of `app.inject()`'s response these tests touch. Declared locally rather than
 * imported from `light-my-request`, which is a transitive dependency of fastify and therefore
 * not resolvable from this package under pnpm's strict layout.
 */
export interface InjectResponse {
  statusCode: number;
  body: string;
  cookies: { name: string; value: string }[];
  json(): unknown;
}

export interface InjectOptions {
  method: 'GET' | 'POST';
  url: string;
  payload?: object | string;
  headers?: Record<string, string>;
}

/** Minimal cookie jar over `app.inject`, so session continuity is tested for real. */
export class Agent {
  private cookie: string | null = null;

  constructor(private readonly app: FastifyInstance) {}

  /** Drops the session cookie without touching the server — "the user cleared their cookies". */
  clearCookies(): void {
    this.cookie = null;
  }

  get hasSession(): boolean {
    return this.cookie !== null;
  }

  private capture(res: InjectResponse): void {
    for (const c of res.cookies) {
      if (c.name !== env.COOKIE_NAME) continue;
      this.cookie = c.value ? `${c.name}=${c.value}` : null;
    }
  }

  async request(opts: InjectOptions): Promise<InjectResponse> {
    const headers = { ...(opts.headers ?? {}), ...(this.cookie ? { cookie: this.cookie } : {}) };
    const res = (await this.app.inject({ ...opts, headers })) as unknown as InjectResponse;
    this.capture(res);
    return res;
  }

  post(url: string, payload?: unknown): Promise<InjectResponse> {
    return this.request({ method: 'POST', url, payload: payload as object | undefined });
  }

  get(url: string): Promise<InjectResponse> {
    return this.request({ method: 'GET', url });
  }
}

export const json = <T>(res: InjectResponse): T => res.json() as T;

/** Creates a guest account and returns the logged-in agent. */
export async function guest(app: FastifyInstance, deviceId: string): Promise<Agent> {
  const agent = new Agent(app);
  const res = await agent.post('/api/auth/guest', { deviceId });
  if (res.statusCode !== 200) throw new Error(`guest login failed: ${res.statusCode} ${res.body}`);
  return agent;
}

/* --------------------------------------------------------------- deploy logs */

const MAX_TICKS = Math.ceil((MATCH_SECONDS + OVERTIME_SECONDS + 5) / DT);

export interface HonestLogOptions {
  /** Ticks between deploys. Must be ≥ `MIN_DEPLOY_GAP_TICKS` (9) to pass structural checks. */
  gapTicks?: number;
  /** Stop after this many deploys; the match still runs to its natural end. */
  maxDeploys?: number;
}

/**
 * Plays a legal match against the AI and returns the log of what was played.
 *
 * The loop is a deliberate mirror of `runMatch`: apply this tick's deploys, then `tick()`.
 * Any divergence — playing after the tick, using a different AI step — would produce a log
 * that replays differently, which the server would correctly void.
 */
export function honestLog(cfg: SimConfig, opts: HonestLogOptions = {}): DeployLogEntry[] {
  const gap = opts.gapTicks ?? 15;
  const maxDeploys = opts.maxDeploys ?? Infinity;
  const sim = new Sim(cfg);
  const log: DeployLogEntry[] = [];
  let lastTick = -gap;

  while (!sim.state.over && sim.state.tick < MAX_TICKS) {
    if (sim.state.tick - lastTick >= gap && log.length < maxDeploys) {
      for (const cid of [...sim.state.hand]) {
        const card = CARD[cid];
        if (!card || sim.state.elix[0] < card.cost) continue;
        // y ≥ 16.95 is the player's legal half (`RIV_B + 1.1`); x is walked across the board
        // so successive deploys do not all stack on one tile.
        const x = 3.5 + (log.length % 6) * 2.2;
        const y = 20 + (log.length % 3);
        if (sim.playCardId(cid, x, y)) {
          log.push({ t: sim.state.tick, cardId: cid, x, y });
          lastTick = sim.state.tick;
        }
        break;
      }
    }
    sim.tick(aiUpdate);
  }
  return log;
}

/**
 * A log a cheating client would produce: deploy on every legal *structural* interval,
 * ignoring elixir entirely. Hand cycling is reproduced faithfully (played card goes to the
 * back of the queue) so the log passes `validateDeployLog` and is rejected by the re-sim —
 * which is exactly the boundary being tested.
 */
export function elixirOverdraftLog(cfg: SimConfig, count = 6): DeployLogEntry[] {
  const sim = new Sim(cfg);
  const hand = [...sim.state.hand];
  const queue = [...sim.state.queue];
  const log: DeployLogEntry[] = [];
  for (let i = 0; i < count; i++) {
    const cid = hand[0];
    log.push({ t: i * 9, cardId: cid, x: 9, y: 20 });
    hand[0] = queue.shift()!;
    queue.push(cid);
  }
  return log;
}

/** The first entry in `log` whose card is a troop or building — spells may be cast anywhere. */
export function firstNonSpell(log: DeployLogEntry[]): number {
  return log.findIndex((e) => CARD[e.cardId]?.t !== 'spell');
}
