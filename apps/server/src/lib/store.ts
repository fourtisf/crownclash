/**
 * Persistence boundary.
 *
 * Every route talks to this interface and nothing else. Two implementations exist:
 * `store-prisma.ts` (Postgres, production) and `store-memory.ts` (tests, and `pnpm dev`
 * before anyone has run a migration).
 *
 * The interface is not a generic ORM wrapper — it is exactly the set of operations the game
 * needs, and several of them are deliberately *conditional writes* rather than read-modify-
 * write pairs. `claimMatch` and `consumeNonce` in particular have to be atomic or the two
 * things this server exists to prevent (double payouts, replayed signatures) come straight
 * back under concurrency.
 */
import { randomUUID } from 'node:crypto';
import type { DeployLogEntry, MatchOutcome, SaveState, SimConfig } from '@crown/shared';

/**
 * Device-id namespaces the server writes and a browser must never be able to present.
 *
 * `/api/auth/guest` authenticates on the device id alone — presenting one *is* presenting a
 * credential — so any id the server derives or parks has to be unreachable from that endpoint:
 *
 *  - `wallet:` — synthetic id for an account created by a wallet signature (`walletDeviceId`).
 *    Derived from a public address, so if it were reachable the credential would be public.
 *  - `orphan:` — where a device id goes when `adoptDevice` takes it away. Random and dead by
 *    construction; nothing should ever be able to log in as a displaced row.
 *
 * Real client ids are 32 hex characters (apps/web/src/api/store.ts), so the colon rules out
 * nothing legitimate.
 */
export const RESERVED_DEVICE_PREFIXES = ['wallet:', 'orphan:'] as const;

export function isReservedDeviceId(deviceId: string): boolean {
  const v = deviceId.trim().toLowerCase();
  return RESERVED_DEVICE_PREFIXES.some((p) => v.startsWith(p));
}

/** A fresh, unusable device id for an account that just had its real one taken. */
export function orphanDeviceId(): string {
  return `orphan:${randomUUID()}`;
}

/**
 * Thrown when a wallet is already bound to a different `User`. Both stores raise this same
 * class so `routes/auth.ts` can map it to `API_ERRORS.walletTaken` without sniffing driver
 * error codes. It is a race guard, not the primary check — the route reads `userByWallet`
 * first; this only fires when two links land in the same instant.
 */
export class WalletConflictError extends Error {
  constructor() {
    super('wallet already linked to another account');
    this.name = 'WalletConflictError';
  }
}

export interface UserRow {
  id: string;
  deviceId: string;
  wallet: string | null;
  walletKind: string | null;
  airdropEligible: boolean;
  createdAt: Date;
  /** HMAC of the account's recovery code, or null when the player has never made one. */
  recoveryHash: string | null;
  recoveryAt: Date | null;
}

/** Thrown by `putSave` when `expectedVersion` no longer matches the stored row. */
export class SaveConflictError extends Error {
  constructor() {
    super('save was modified concurrently');
    this.name = 'SaveConflictError';
  }
}

export interface SaveRow {
  userId: string;
  json: SaveState;
  trophies: number;
  best: number;
  migrated: boolean;
  sanitizeFlags: string[];
  updatedAt: Date;
  /**
   * Optimistic-concurrency counter, incremented on every write.
   *
   * A save is read, mutated in JS and written back, so two overlapping requests — claiming a
   * quest while an upgrade is in flight — would each write a full document computed from the
   * same starting point and the loser's changes would vanish. Passing the version we read as
   * `expectedVersion` turns the write into a compare-and-set; `mutateSave` retries the whole
   * read-modify-write on conflict. PM2 runs the api in cluster mode, so an in-process lock
   * would not have been enough.
   */
  version: number;
}

export interface MatchOpponent {
  name: string;
  avatar: string;
  trophies: number;
}

export interface MatchRow {
  id: string;
  userId: string;
  seed: string;
  mode: string;
  config: SimConfig;
  aiDeck: string[] | null;
  aiLevel: number;
  arenaIndex: number;
  opponent: MatchOpponent | null;
  deployLog: DeployLogEntry[] | null;
  result: MatchOutcome | null;
  crowns: [number, number] | null;
  validated: boolean;
  voidReason: string | null;
  resultHash: string | null;
  rewardSeed: string | null;
  trophyDelta: number | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export type MatchCreateInput = Pick<
  MatchRow,
  'userId' | 'seed' | 'mode' | 'config' | 'aiDeck' | 'aiLevel' | 'arenaIndex' | 'opponent'
>;

export type MatchCompleteInput = Partial<
  Pick<MatchRow, 'deployLog' | 'result' | 'crowns' | 'validated' | 'voidReason' | 'resultHash' | 'rewardSeed' | 'trophyDelta'>
>;

export interface NonceRow {
  nonce: string;
  address: string;
  kind: 'evm' | 'solana';
  message: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface LeaderboardRow {
  userId: string;
  name: string;
  avatar: string;
  trophies: number;
  best: number;
}

export interface SavePutMeta {
  migrated?: boolean;
  sanitizeFlags?: string[];
  /**
   * Compare-and-set guard. When set, the write only lands if the stored version still matches;
   * otherwise the store throws `SaveConflictError`. Omit it for writes that are legitimately
   * last-write-wins (migration, first-time creation).
   */
  expectedVersion?: number;
}

export interface Store {
  /* -------------------------------------------------------------------- users */
  userById(id: string): Promise<UserRow | null>;
  userByDeviceId(deviceId: string): Promise<UserRow | null>;
  /** `wallet` is already normalised by `wallet.ts` (lower-case for EVM, verbatim base58). */
  userByWallet(wallet: string): Promise<UserRow | null>;
  /** Redemption lookup. Served by the unique index on `recoveryHash`. */
  userByRecoveryHash(hash: string): Promise<UserRow | null>;
  /** Creates the user and its Save row together; the two never exist apart. */
  createUser(input: { deviceId: string; save: SaveState }): Promise<UserRow>;
  setWallet(
    userId: string,
    patch: { wallet: string | null; walletKind: string | null; airdropEligible: boolean },
  ): Promise<UserRow>;
  touchUser(userId: string, at: Date): Promise<void>;
  /** Issue or rotate a recovery code. Replacing a hash kills the code it was made from. */
  setRecoveryHash(userId: string, hash: string, at: Date): Promise<UserRow>;
  /**
   * Move `deviceId` onto `userId`, taking it from whichever account currently holds it.
   *
   * Must be atomic: `deviceId` is unique, so assigning it while another row still holds it is
   * a constraint violation, and doing it in two steps leaves a window where no row owns the
   * device at all. The displaced account is *orphaned* rather than deleted — the same rule the
   * wallet-adoption path follows, because redeeming a code should never be able to destroy a
   * row that might still hold somebody's progress.
   */
  adoptDevice(userId: string, deviceId: string): Promise<UserRow>;

  /* -------------------------------------------------------------------- saves */
  getSave(userId: string): Promise<SaveRow | null>;
  putSave(userId: string, save: SaveState, meta?: SavePutMeta): Promise<SaveRow>;

  /* ------------------------------------------------------------------- nonces */
  createNonce(row: NonceRow): Promise<void>;
  /**
   * Single-use consumption. Must be one conditional write — `usedAt IS NULL AND expiresAt >
   * now` in the WHERE clause — so two simultaneous submissions of the same signature cannot
   * both succeed. Returns the row only to the caller that won.
   */
  consumeNonce(nonce: string, now: Date): Promise<NonceRow | null>;
  purgeNonces(before: Date): Promise<number>;

  /* ------------------------------------------------------------------ matches */
  createMatch(input: MatchCreateInput): Promise<MatchRow>;
  getMatch(id: string): Promise<MatchRow | null>;
  /**
   * Atomically transition `finishedAt: null → at`. False means somebody already finished it,
   * which is how `matchAlreadyFinished` stays correct under a double-submit race. Claiming
   * *before* the re-sim means the loser of the race never touches the save.
   */
  claimMatch(id: string, at: Date): Promise<boolean>;
  completeMatch(id: string, patch: MatchCompleteInput): Promise<void>;
  /**
   * The player's most recently finished matches, newest first. Served by
   * `@@index([userId, createdAt(sort: Desc)])`, which the schema has always carried.
   */
  recentMatches(userId: string, limit: number): Promise<MatchRow[]>;
  /** Marks matches started before `before` and never finished as voided. Returns the count. */
  expireMatches(before: Date, at: Date): Promise<number>;

  /* -------------------------------------------------------------- leaderboard */
  topSaves(limit: number): Promise<LeaderboardRow[]>;
  /** Number of saves strictly above `trophies` — rank is this + 1. */
  countAbove(trophies: number): Promise<number>;

  close(): Promise<void>;
}
