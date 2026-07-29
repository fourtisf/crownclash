/**
 * In-memory `Store`.
 *
 * Exists so the whole HTTP surface — auth, saves, match re-simulation, economy, leaderboard —
 * can be exercised with no Postgres and no Redis (required by the test brief, and it makes
 * `pnpm dev` usable before a migration has ever run).
 *
 * It reproduces the two atomicity guarantees the interface documents. JavaScript's single
 * thread gives them for free here as long as the check and the write sit in the same
 * synchronous block with no `await` between them — which is why `claimMatch` and
 * `consumeNonce` below look conspicuously await-free.
 *
 * Saves are deep-cloned on the way in and out. Without that a route could mutate the "stored"
 * save by accident and the test suite would agree with a bug the real store would have caught.
 */
import { SaveConflictError } from './store.js';
import type { SaveState } from '@crown/shared';
import type {
  LeaderboardRow, MatchCompleteInput, MatchCreateInput, MatchRow, NonceRow, SavePutMeta, SaveRow,
  Store, UserRow,
} from './store.js';
import { WalletConflictError } from './store.js';

// `structuredClone`, not a JSON round-trip: the `Store` interface returns real `Date`s and a
// JSON clone would hand back strings, so the memory store would quietly disagree with Prisma
// about the type of every timestamp.
const clone = <T>(v: T): T => structuredClone(v);

let idSeq = 0;
const nextId = (prefix: string): string => `${prefix}_${(++idSeq).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class MemoryStore implements Store {
  private users = new Map<string, UserRow>();
  private saves = new Map<string, SaveRow>();
  private nonces = new Map<string, NonceRow>();
  private matches = new Map<string, MatchRow>();

  /* -------------------------------------------------------------------- users */

  async userById(id: string): Promise<UserRow | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async userByDeviceId(deviceId: string): Promise<UserRow | null> {
    for (const u of this.users.values()) if (u.deviceId === deviceId) return { ...u };
    return null;
  }

  async userByWallet(wallet: string): Promise<UserRow | null> {
    for (const u of this.users.values()) if (u.wallet === wallet) return { ...u };
    return null;
  }

  async createUser(input: { deviceId: string; save: SaveState }): Promise<UserRow> {
    const existing = await this.userByDeviceId(input.deviceId);
    if (existing) throw new Error('duplicate deviceId');
    const user: UserRow = {
      id: nextId('usr'),
      deviceId: input.deviceId,
      wallet: null,
      walletKind: null,
      airdropEligible: false,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    this.saves.set(user.id, {
      userId: user.id,
      json: clone(input.save),
      trophies: input.save.trophies,
      best: input.save.best,
      migrated: false,
      sanitizeFlags: [],
      updatedAt: new Date(),
      version: 0,
    });
    return { ...user };
  }

  async setWallet(
    userId: string,
    patch: { wallet: string | null; walletKind: string | null; airdropEligible: boolean },
  ): Promise<UserRow> {
    const u = this.users.get(userId);
    if (!u) throw new Error('user not found');
    if (patch.wallet) {
      for (const other of this.users.values()) {
        if (other.id !== userId && other.wallet === patch.wallet) throw new WalletConflictError();
      }
    }
    u.wallet = patch.wallet;
    u.walletKind = patch.walletKind;
    u.airdropEligible = patch.airdropEligible;
    return { ...u };
  }

  async touchUser(): Promise<void> {
    // lastSeenAt is telemetry only; the memory store has no reader for it.
  }

  /* -------------------------------------------------------------------- saves */

  async getSave(userId: string): Promise<SaveRow | null> {
    const s = this.saves.get(userId);
    return s ? { ...s, json: clone(s.json) } : null;
  }

  async putSave(userId: string, save: SaveState, meta: SavePutMeta = {}): Promise<SaveRow> {
    const prev = this.saves.get(userId);
    // Compare-and-set. The Map write below is synchronous, so the check and the swap cannot be
    // interleaved here — but the *caller* awaited between its read and this call, which is
    // exactly where the lost update happened.
    if (meta.expectedVersion !== undefined && (prev?.version ?? 0) !== meta.expectedVersion) {
      throw new SaveConflictError();
    }
    const row: SaveRow = {
      userId,
      json: clone(save),
      trophies: save.trophies,
      best: save.best,
      migrated: meta.migrated ?? prev?.migrated ?? false,
      sanitizeFlags: meta.sanitizeFlags ?? prev?.sanitizeFlags ?? [],
      updatedAt: new Date(),
      version: (prev?.version ?? 0) + 1,
    };
    this.saves.set(userId, row);
    return { ...row, json: clone(row.json) };
  }

  /* ------------------------------------------------------------------- nonces */

  async createNonce(row: NonceRow): Promise<void> {
    this.nonces.set(row.nonce, { ...row });
  }

  async consumeNonce(nonce: string, now: Date): Promise<NonceRow | null> {
    const row = this.nonces.get(nonce);
    // No `await` between the guard and the write — this is the atomic section.
    if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return null;
    row.usedAt = now;
    return { ...row };
  }

  async purgeNonces(before: Date): Promise<number> {
    let n = 0;
    for (const [k, v] of this.nonces) {
      if (v.expiresAt.getTime() < before.getTime()) {
        this.nonces.delete(k);
        n++;
      }
    }
    return n;
  }

  /* ------------------------------------------------------------------ matches */

  async createMatch(input: MatchCreateInput): Promise<MatchRow> {
    const row: MatchRow = {
      id: nextId('mch'),
      userId: input.userId,
      seed: input.seed,
      mode: input.mode,
      config: clone(input.config),
      aiDeck: input.aiDeck ? input.aiDeck.slice() : null,
      aiLevel: input.aiLevel,
      arenaIndex: input.arenaIndex,
      opponent: input.opponent ? { ...input.opponent } : null,
      deployLog: null,
      result: null,
      crowns: null,
      validated: false,
      voidReason: null,
      resultHash: null,
      rewardSeed: null,
      trophyDelta: null,
      createdAt: new Date(),
      finishedAt: null,
    };
    this.matches.set(row.id, row);
    return clone(row);
  }

  async getMatch(id: string): Promise<MatchRow | null> {
    const m = this.matches.get(id);
    return m ? clone(m) : null;
  }

  async claimMatch(id: string, at: Date): Promise<boolean> {
    const m = this.matches.get(id);
    // Atomic section: guard and write with nothing awaited in between.
    if (!m || m.finishedAt) return false;
    m.finishedAt = at;
    return true;
  }

  async completeMatch(id: string, patch: MatchCompleteInput): Promise<void> {
    const m = this.matches.get(id);
    if (!m) return;
    Object.assign(m, clone(patch));
  }

  async expireMatches(before: Date, at: Date): Promise<number> {
    let n = 0;
    for (const m of this.matches.values()) {
      if (!m.finishedAt && m.createdAt.getTime() < before.getTime()) {
        m.finishedAt = at;
        m.voidReason = 'expired';
        n++;
      }
    }
    return n;
  }

  /* -------------------------------------------------------------- leaderboard */

  async topSaves(limit: number): Promise<LeaderboardRow[]> {
    return [...this.saves.values()]
      .sort((a, b) => b.trophies - a.trophies || b.best - a.best || (a.userId < b.userId ? -1 : 1))
      .slice(0, limit)
      .map((s) => ({
        userId: s.userId,
        name: s.json.name,
        avatar: s.json.avatar,
        trophies: s.trophies,
        best: s.best,
      }));
  }

  async countAbove(trophies: number): Promise<number> {
    let n = 0;
    for (const s of this.saves.values()) if (s.trophies > trophies) n++;
    return n;
  }

  async close(): Promise<void> {
    this.users.clear();
    this.saves.clear();
    this.nonces.clear();
    this.matches.clear();
  }
}
