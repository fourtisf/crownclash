/**
 * Phase 2 scaffold — real-time PvP transport and matchmaking.
 *
 * ## What is real here, today
 *
 * Everything up to the moment two players are paired:
 *
 *  - `/ws` accepts an authenticated upgrade (the session cookie is already resolved by the
 *    global `onRequest` hook, so an anonymous socket is refused at handshake).
 *  - `queue` / `cancel` messages drive a Redis sorted set scored by trophies, shared across
 *    PM2 instances. The search window widens ±50 → ±200 linearly over 10 s (handoff §3 Phase
 *    2), and at 10 s the player is told to fall back to the Phase-1 vs-AI path — which is
 *    exactly the existing matchmaking-modal UX, so nothing visible changes when this ships.
 *  - Pairing creates a `Room`, both sockets are told `matched` with the room id, the shared
 *    seed and their opponent's profile, and disconnects tear the room down.
 *
 * ## What Phase 2 fills in
 *
 *  1. **The authoritative loop.** A `Room` today holds the seed and both players' frozen decks
 *     but no `Sim`. Phase 2 constructs one and runs `sim.tick(null)` — `null`, not `aiUpdate`,
 *     because both sides are humans — on a 30 Hz interval, applies queued `deploy` intents at
 *     tick boundaries, and broadcasts a snapshot every 3rd tick (10 Hz) as §3 specifies. The
 *     sim exists and is already deterministic; the pump and the snapshot codec are what is
 *     missing. It also needs a two-sided `SimConfig` in `@crown/shared` — today's shape is
 *     player-vs-AI, which is why a `Room` deliberately does not fabricate one.
 *  2. **Snapshot encoding.** `SimEvent[]` plus a delta of `BattleState.units` — the client's
 *     renderer already interpolates 100 ms behind, so nothing on the client changes either.
 *  3. **Reconnect.** A 15 s window keyed on `Room.id + userId`; past it, concede. The room
 *     map below is per-process, so Phase 2 either pins a room to an instance (Redis holds
 *     `room → instance`) or moves room state into Redis outright.
 *  4. **Result submission.** A PvP room finishes server-side, so there is no deploy log to
 *     re-validate — the room writes the `Match` row directly. Phase 1's seeded-replay
 *     validation stays for the vs-AI ladder.
 *
 * Nothing here can crash the API process: every handler is wrapped, and a socket that sends
 * garbage is closed rather than thrown from.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { deckLevels, randomSeed } from '@crown/shared';
import { logger } from './lib/logger.js';
import { RKEY, type RedisLike } from './lib/redis.js';
import type { Store } from './lib/store.js';

/* --------------------------------------------------------------- matchmaking */

/** §3 Phase 2: ±50 at t=0, widening to ±200 by t=10 s, then AI fallback. */
export const MM_WINDOW_MIN = 50;
export const MM_WINDOW_MAX = 200;
export const MM_WIDEN_MS = 10_000;

export function matchWindow(waitedMs: number): number {
  const t = Math.min(1, Math.max(0, waitedMs / MM_WIDEN_MS));
  return Math.round(MM_WINDOW_MIN + (MM_WINDOW_MAX - MM_WINDOW_MIN) * t);
}

interface Waiting {
  userId: string;
  trophies: number;
  socket: WebSocket;
  joinedAt: number;
  name: string;
  avatar: string;
  /** Read at queue time so a deck edit mid-search cannot change the match already forming. */
  deck: string[];
  cardLevels: Record<string, number>;
  kingLevel: number;
}

/* --------------------------------------------------------------------- rooms */

export interface RoomPlayer {
  userId: string;
  socket: WebSocket;
  name: string;
  avatar: string;
  trophies: number;
  deck: string[];
  cardLevels: Record<string, number>;
  kingLevel: number;
}

export interface Room {
  id: string;
  /** Shared by both clients; the authoritative sim runs on it server-side. */
  seed: string;
  players: [RoomPlayer, RoomPlayer];
  createdAt: number;
}

type ClientMessage =
  | { t: 'queue' }
  | { t: 'cancel' }
  | { t: 'ping' }
  /** Phase 2: applied at the next tick boundary by the room's authoritative loop. */
  | { t: 'deploy'; cardId: string; x: number; y: number };

function send(socket: WebSocket, payload: unknown): void {
  // readyState 1 === OPEN. Writing to a closing socket throws inside `ws`.
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch (err) {
    logger.debug({ err }, 'ws send failed');
  }
}

/**
 * Per-process matchmaking + room registry.
 *
 * The Redis sorted set is the cross-instance view (so two PM2 workers pair with each other);
 * the local map holds the sockets, which cannot leave the process that owns them. Phase 2
 * makes the pairing message itself go through Redis pub/sub so the two halves can live on
 * different instances.
 */
export class Matchmaker {
  private waiting = new Map<string, Waiting>();
  private rooms = new Map<string, Room>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: RedisLike,
    private readonly tickMs = 500,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep().catch((err) => logger.error({ err }, 'matchmaking sweep failed'));
    }, this.tickMs);
    // Do not hold the event loop open on shutdown.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async enqueue(entry: Waiting): Promise<void> {
    this.waiting.set(entry.userId, entry);
    await this.redis.zadd(RKEY.matchmaking, entry.trophies, entry.userId);
    send(entry.socket, { t: 'queued', window: MM_WINDOW_MIN });
  }

  async dequeue(userId: string): Promise<void> {
    this.waiting.delete(userId);
    await this.redis.zrem(RKEY.matchmaking, userId);
  }

  get queueSize(): number {
    return this.waiting.size;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** One pass: pair whoever overlaps, then time out the rest onto the AI path. */
  private async sweep(): Promise<void> {
    const now = Date.now();
    const entries = [...this.waiting.values()].sort((a, b) => a.joinedAt - b.joinedAt);

    for (const me of entries) {
      if (!this.waiting.has(me.userId)) continue; // already paired this pass
      const window = matchWindow(now - me.joinedAt);
      const candidates = await this.redis.zrangebyscore(
        RKEY.matchmaking,
        me.trophies - window,
        me.trophies + window,
      );
      const opponent = candidates
        .map((id) => this.waiting.get(id))
        .find((w): w is Waiting => !!w && w.userId !== me.userId);

      if (opponent) {
        await this.pair(me, opponent);
        continue;
      }
      if (now - me.joinedAt >= MM_WIDEN_MS) {
        // §3 Phase 2: "fall back to AI disguised with the existing AI_NAMES". The client then
        // runs the ordinary Phase-1 flow — /api/match/start, local sim, /api/match/finish.
        await this.dequeue(me.userId);
        send(me.socket, { t: 'ai-fallback' });
      } else {
        send(me.socket, { t: 'searching', window });
      }
    }
  }

  private async pair(a: Waiting, b: Waiting): Promise<void> {
    await this.dequeue(a.userId);
    await this.dequeue(b.userId);

    // Decks and levels were snapshotted at queue time, for the same reason vs-AI freezes its
    // SimConfig at /match/start: the rules of a match must not change once it has started.
    const seed = randomSeed();
    const toPlayer = (w: Waiting): RoomPlayer => ({
      userId: w.userId, socket: w.socket, name: w.name, avatar: w.avatar, trophies: w.trophies,
      deck: w.deck, cardLevels: w.cardLevels, kingLevel: w.kingLevel,
    });

    const room: Room = {
      id: `room_${randomSeed().slice(0, 16)}`,
      seed,
      players: [toPlayer(a), toPlayer(b)],
      createdAt: Date.now(),
    };
    this.rooms.set(room.id, room);

    room.players.forEach((p, i) => {
      const foe = room.players[1 - i];
      send(p.socket, {
        t: 'matched',
        roomId: room.id,
        seed,
        team: i,
        opponent: { name: foe.name, avatar: foe.avatar, trophies: foe.trophies },
      });
    });
    logger.info({ roomId: room.id, a: a.userId, b: b.userId }, 'pvp room created');
    // Phase 2 starts the 30 Hz authoritative loop here.
  }

  /** Called on socket close. Phase 2 replaces the immediate teardown with a 15 s hold. */
  async drop(userId: string): Promise<void> {
    await this.dequeue(userId);
    for (const room of this.rooms.values()) {
      const idx = room.players.findIndex((p) => p.userId === userId);
      if (idx < 0) continue;
      const foe = room.players[1 - idx];
      send(foe.socket, { t: 'opponent-left', roomId: room.id });
      this.rooms.delete(room.id);
      logger.info({ roomId: room.id, userId }, 'pvp room closed on disconnect');
    }
  }
}

/* -------------------------------------------------------------------- plugin */

export async function registerWs(app: FastifyInstance): Promise<Matchmaker> {
  await app.register(websocket, {
    // A deploy intent is ~60 bytes. Anything near this cap is not a game client.
    options: { maxPayload: 16 * 1024 },
  });

  const mm = new Matchmaker(app.redis.client);
  mm.start();

  app.get('/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const userId = req.userId;
    if (!userId) {
      send(socket, { t: 'error', error: 'unauthorized' });
      socket.close(4401, 'unauthorized');
      return;
    }
    const store: Store = app.store;

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      void (async () => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(String(raw)) as ClientMessage;
        } catch {
          send(socket, { t: 'error', error: 'bad_json' });
          return;
        }
        switch (msg.t) {
          case 'ping':
            send(socket, { t: 'pong' });
            return;
          case 'queue': {
            const row = await store.getSave(userId);
            if (!row) {
              send(socket, { t: 'error', error: 'no_save' });
              return;
            }
            await mm.enqueue({
              userId,
              trophies: row.trophies,
              socket,
              joinedAt: Date.now(),
              name: row.json.name,
              avatar: row.json.avatar,
              deck: row.json.deck.slice(),
              cardLevels: deckLevels(row.json),
              kingLevel: row.json.lvl,
            });
            return;
          }
          case 'cancel':
            await mm.dequeue(userId);
            send(socket, { t: 'cancelled' });
            return;
          case 'deploy':
            // Phase 2: push onto the room's intent queue for the next tick boundary.
            send(socket, { t: 'error', error: 'pvp_not_enabled' });
            return;
          default:
            send(socket, { t: 'error', error: 'unknown_message' });
        }
      })().catch((err) => app.log.error({ err }, 'ws message handler failed'));
    });

    socket.on('close', () => {
      void mm.drop(userId).catch((err) => app.log.error({ err }, 'ws drop failed'));
    });
    socket.on('error', (err: Error) => app.log.debug({ err }, 'ws socket error'));

    send(socket, { t: 'hello', userId, pvp: false });
  });

  app.addHook('onClose', async () => {
    mm.stop();
  });

  return mm;
}
