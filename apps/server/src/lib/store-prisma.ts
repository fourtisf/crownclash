/**
 * Postgres-backed `Store`.
 *
 * The only file in the server that knows Prisma exists. Two things are worth reading closely:
 *
 *  - `claimMatch` and `consumeNonce` are `updateMany` with the precondition in the WHERE
 *    clause, not read-then-write. Postgres evaluates each as a single statement, so exactly
 *    one concurrent caller can observe `count === 1`. That single fact is what makes double
 *    payouts and replayed signatures impossible rather than merely unlikely.
 *  - `putSave` mirrors `trophies`/`best` out of the JSON into indexed columns. It is the only
 *    writer of those columns, so they cannot drift from `json`.
 */
import type { SaveState } from '@crown/shared';
import { getPrisma, isUniqueViolation, type DbMatch, type DbSave, type DbUser, type DbWalletNonce, type PrismaLike } from './prisma.js';
import type {
  LeaderboardRow, MatchCompleteInput, MatchCreateInput, MatchRow, NonceRow, SavePutMeta, SaveRow,
  Store, UserRow,
} from './store.js';
import { SaveConflictError, WalletConflictError, orphanDeviceId } from './store.js';

const toUser = (u: DbUser): UserRow => ({
  id: u.id,
  deviceId: u.deviceId,
  wallet: u.wallet,
  walletKind: u.walletKind,
  airdropEligible: u.airdropEligible,
  createdAt: u.createdAt,
  recoveryHash: u.recoveryHash,
  recoveryAt: u.recoveryAt,
});

const toSave = (s: DbSave): SaveRow => ({
  userId: s.userId,
  json: s.json as SaveState,
  trophies: s.trophies,
  best: s.best,
  migrated: s.migrated,
  sanitizeFlags: s.sanitizeFlags ?? [],
  updatedAt: s.updatedAt,
  version: s.version ?? 0,
});

const toMatch = (m: DbMatch): MatchRow => ({
  id: m.id,
  userId: m.userId,
  seed: m.seed,
  mode: m.mode,
  config: m.config as MatchRow['config'],
  aiDeck: (m.aiDeck as string[] | null) ?? null,
  aiLevel: m.aiLevel,
  arenaIndex: m.arenaIndex,
  opponent: (m.opponent as MatchRow['opponent']) ?? null,
  deployLog: (m.deployLog as MatchRow['deployLog']) ?? null,
  result: (m.result as MatchRow['result']) ?? null,
  crowns: (m.crowns as MatchRow['crowns']) ?? null,
  validated: m.validated,
  voidReason: m.voidReason,
  resultHash: m.resultHash,
  rewardSeed: m.rewardSeed,
  trophyDelta: m.trophyDelta,
  createdAt: m.createdAt,
  finishedAt: m.finishedAt,
});

const toNonce = (n: DbWalletNonce): NonceRow => ({
  nonce: n.nonce,
  address: n.address,
  kind: n.kind as NonceRow['kind'],
  message: n.message,
  expiresAt: n.expiresAt,
  usedAt: n.usedAt,
});

export class PrismaStore implements Store {
  private db: PrismaLike | null = null;

  private async client(): Promise<PrismaLike> {
    if (!this.db) this.db = await getPrisma();
    return this.db;
  }

  /* -------------------------------------------------------------------- users */

  async userById(id: string): Promise<UserRow | null> {
    const db = await this.client();
    const u = await db.user.findUnique({ where: { id } });
    return u ? toUser(u) : null;
  }

  async userByDeviceId(deviceId: string): Promise<UserRow | null> {
    const db = await this.client();
    const u = await db.user.findUnique({ where: { deviceId } });
    return u ? toUser(u) : null;
  }

  async userByWallet(wallet: string): Promise<UserRow | null> {
    const db = await this.client();
    const u = await db.user.findUnique({ where: { wallet } });
    return u ? toUser(u) : null;
  }

  async userByRecoveryHash(hash: string): Promise<UserRow | null> {
    const db = await this.client();
    const u = await db.user.findUnique({ where: { recoveryHash: hash } });
    return u ? toUser(u) : null;
  }

  async createUser(input: { deviceId: string; save: SaveState }): Promise<UserRow> {
    const db = await this.client();
    // Nested create: a User without a Save is a state no route knows how to handle, so the
    // two rows are born in one statement.
    const u = await db.user.create({
      data: {
        deviceId: input.deviceId,
        save: {
          create: {
            json: input.save as unknown as Record<string, unknown>,
            trophies: input.save.trophies,
            best: input.save.best,
          },
        },
      },
    });
    return toUser(u);
  }

  async setWallet(
    userId: string,
    patch: { wallet: string | null; walletKind: string | null; airdropEligible: boolean },
  ): Promise<UserRow> {
    const db = await this.client();
    try {
      const u = await db.user.update({ where: { id: userId }, data: patch });
      return toUser(u);
    } catch (err) {
      if (isUniqueViolation(err)) throw new WalletConflictError();
      throw err;
    }
  }

  async setRecoveryHash(userId: string, hash: string, at: Date): Promise<UserRow> {
    const db = await this.client();
    const u = await db.user.update({ where: { id: userId }, data: { recoveryHash: hash, recoveryAt: at } });
    return toUser(u);
  }

  /**
   * One transaction, because `deviceId` is unique: the row holding it has to let go in the
   * same statement batch that hands it over, or the second write hits the constraint. The
   * displaced account keeps its save and its wallet and simply becomes unreachable by device
   * id — if it had a wallet or a recovery code of its own, those still open it.
   */
  async adoptDevice(userId: string, deviceId: string): Promise<UserRow> {
    const db = await this.client();
    return db.$transaction(async (tx) => {
      const holder = await tx.user.findUnique({ where: { deviceId } });
      if (holder && holder.id !== userId) {
        await tx.user.update({ where: { id: holder.id }, data: { deviceId: orphanDeviceId() } });
      }
      const u = await tx.user.update({ where: { id: userId }, data: { deviceId } });
      return toUser(u);
    });
  }

  async touchUser(userId: string, at: Date): Promise<void> {
    const db = await this.client();
    await db.user.updateMany({ where: { id: userId }, data: { lastSeenAt: at } });
  }

  /* -------------------------------------------------------------------- saves */

  async getSave(userId: string): Promise<SaveRow | null> {
    const db = await this.client();
    const s = await db.save.findUnique({ where: { userId } });
    return s ? toSave(s) : null;
  }

  async putSave(userId: string, save: SaveState, meta: SavePutMeta = {}): Promise<SaveRow> {
    const db = await this.client();
    const json = save as unknown as Record<string, unknown>;
    const update: Record<string, unknown> = { json, trophies: save.trophies, best: save.best };
    if (meta.migrated !== undefined) {
      update.migrated = meta.migrated;
      update.migratedAt = meta.migrated ? new Date() : null;
    }
    if (meta.sanitizeFlags !== undefined) update.sanitizeFlags = meta.sanitizeFlags;

    // Compare-and-set path: one conditional UPDATE, so the database decides the winner. A
    // read-then-write in application code would reintroduce exactly the race this closes.
    if (meta.expectedVersion !== undefined) {
      const res = await db.save.updateMany({
        where: { userId, version: meta.expectedVersion },
        data: { ...update, version: { increment: 1 } },
      });
      if (res.count === 0) throw new SaveConflictError();
      const row = await db.save.findUnique({ where: { userId } });
      if (!row) throw new SaveConflictError();
      return toSave(row);
    }

    const s = await db.save.upsert({
      where: { userId },
      create: {
        userId,
        json,
        trophies: save.trophies,
        best: save.best,
        migrated: meta.migrated ?? false,
        migratedAt: meta.migrated ? new Date() : null,
        sanitizeFlags: meta.sanitizeFlags ?? [],
      },
      update: { ...update, version: { increment: 1 } },
    });
    return toSave(s);
  }

  /* ------------------------------------------------------------------- nonces */

  async createNonce(row: NonceRow): Promise<void> {
    const db = await this.client();
    await db.walletNonce.create({
      data: {
        nonce: row.nonce,
        address: row.address,
        kind: row.kind,
        message: row.message,
        expiresAt: row.expiresAt,
      },
    });
  }

  async consumeNonce(nonce: string, now: Date): Promise<NonceRow | null> {
    const db = await this.client();
    // One statement, precondition included: a second submission of the same signature finds
    // `usedAt` already set and gets count 0.
    const res = await db.walletNonce.updateMany({
      where: { nonce, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (res.count !== 1) return null;
    const row = await db.walletNonce.findUnique({ where: { nonce } });
    return row ? toNonce(row) : null;
  }

  async purgeNonces(before: Date): Promise<number> {
    const db = await this.client();
    const res = await db.walletNonce.deleteMany({ where: { expiresAt: { lt: before } } });
    return res.count;
  }

  /* ------------------------------------------------------------------ matches */

  async createMatch(input: MatchCreateInput): Promise<MatchRow> {
    const db = await this.client();
    const m = await db.match.create({
      data: {
        userId: input.userId,
        seed: input.seed,
        mode: input.mode,
        config: input.config as unknown as Record<string, unknown>,
        aiDeck: input.aiDeck,
        aiLevel: input.aiLevel,
        arenaIndex: input.arenaIndex,
        opponent: input.opponent as unknown as Record<string, unknown> | null,
      },
    });
    return toMatch(m);
  }

  async getMatch(id: string): Promise<MatchRow | null> {
    const db = await this.client();
    const m = await db.match.findUnique({ where: { id } });
    return m ? toMatch(m) : null;
  }

  async claimMatch(id: string, at: Date): Promise<boolean> {
    const db = await this.client();
    const res = await db.match.updateMany({ where: { id, finishedAt: null }, data: { finishedAt: at } });
    return res.count === 1;
  }

  async completeMatch(id: string, patch: MatchCompleteInput): Promise<void> {
    const db = await this.client();
    const data: Record<string, unknown> = {};
    if (patch.deployLog !== undefined) data.deployLog = patch.deployLog as unknown as Record<string, unknown>;
    if (patch.result !== undefined) data.result = patch.result;
    if (patch.crowns !== undefined) data.crowns = patch.crowns as unknown as Record<string, unknown>;
    if (patch.validated !== undefined) data.validated = patch.validated;
    if (patch.voidReason !== undefined) data.voidReason = patch.voidReason;
    if (patch.resultHash !== undefined) data.resultHash = patch.resultHash;
    if (patch.rewardSeed !== undefined) data.rewardSeed = patch.rewardSeed;
    if (patch.trophyDelta !== undefined) data.trophyDelta = patch.trophyDelta;
    if (Object.keys(data).length === 0) return;
    await db.match.updateMany({ where: { id }, data });
  }

  async expireMatches(before: Date, at: Date): Promise<number> {
    const db = await this.client();
    const res = await db.match.updateMany({
      where: { finishedAt: null, createdAt: { lt: before } },
      data: { finishedAt: at, voidReason: 'expired' },
    });
    return res.count;
  }

  /* -------------------------------------------------------------- leaderboard */

  async topSaves(limit: number): Promise<LeaderboardRow[]> {
    const db = await this.client();
    // Served by `@@index([trophies(sort: Desc)])`; `best` only breaks ties.
    const rows = await db.save.findMany({
      orderBy: [{ trophies: 'desc' }, { best: 'desc' }],
      take: limit,
      select: { userId: true, json: true, trophies: true, best: true },
    });
    return rows.map((r) => {
      const json = r.json as SaveState;
      return { userId: r.userId, name: json.name, avatar: json.avatar, trophies: r.trophies, best: r.best };
    });
  }

  async countAbove(trophies: number): Promise<number> {
    const db = await this.client();
    return db.save.count({ where: { trophies: { gt: trophies } } });
  }

  async close(): Promise<void> {
    if (!this.db) return;
    await this.db.$disconnect();
    this.db = null;
  }
}
