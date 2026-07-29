/**
 * Save loading, repair and persistence.
 *
 * Every route that touches a save goes through here so three invariants hold everywhere:
 *
 *  1. What comes out of the database is passed through `normalizeSave()` before any code
 *     reads it. Real saves in the wild will have missing keys (the prototype shipped several
 *     schema versions) and every route would otherwise need its own guards.
 *  2. Daily quests roll over on read, not on some cron. A player who does not log in for a
 *     week should find fresh quests, and the *server's* `dayKey()` is the authority — set `TZ`
 *     on the VPS and every player's day boundary is the same one.
 *  3. `save.wallet` / `save.walletKind` are re-stamped from the `User` row on every load. The
 *     save JSON is the display copy; `User.wallet` is the fact. `sanitizeSave()` nulls those
 *     fields precisely because a client save must never be able to assert an identity.
 */
import {
  Rng, STARTER_DECK, checkQuests, defaultState, normalizeSave, randomSeed, CARD, type SaveState,
} from '@crown/shared';
import { SaveConflictError, type SavePutMeta, type Store, type UserRow } from './store.js';

/** L2928 — the ten emoji the prototype's profile modal offers. Not in `data.ts`; UI-only. */
export const PROFILE_AVATARS: readonly string[] = ['👑', '⚔️', '🛡️', '🐉', '🔥', '💀', '🦁', '🧙', '🏹', '⚡'];

/** A fresh unpredictable stream. Used for every server-side roll (chests, rewards, quests). */
export const serverRng = (): Rng => new Rng(randomSeed());

export interface LoadedSave {
  save: SaveState;
  /** True when the load itself changed something worth writing back (quest roll, identity). */
  dirty: boolean;
  /** Version the save was read at, for the compare-and-set on write. 0 when no row existed. */
  version: number;
}

/**
 * Guarantee the deck invariant every other subsystem assumes: **8 distinct, real, owned cards**.
 *
 * `Sim` slices `hand = deck.slice(0,4)` and `queue = deck.slice(4)`, so a short deck produces
 * `undefined` hand slots and a match that cannot be replayed. `sanitizeSave()` gets as close as
 * it can, but it will not grant ownership, so a save whose card list was mostly junk comes out
 * of migration with a one-card deck. Here the missing slots are filled from the starter deck and
 * *unlocked at level 1 with zero duplicates* — which grants nothing of value and restores a
 * playable account rather than a broken one.
 *
 * Returns whether anything changed, so callers know if a write is needed.
 */
export function ensurePlayableDeck(s: SaveState): boolean {
  const before = s.deck.join(',');
  const deck: string[] = [];
  const push = (id: string): void => {
    if (deck.length < 8 && deck.indexOf(id) < 0) deck.push(id);
  };

  for (const id of Array.isArray(s.deck) ? s.deck : []) {
    if (CARD[id] && id !== 'behemoth_mini' && s.cards[id]) push(id);
  }
  for (const id of Object.keys(s.cards)) {
    if (CARD[id] && id !== 'behemoth_mini') push(id);
  }
  for (const id of STARTER_DECK) push(id);

  for (const id of deck) if (!s.cards[id]) s.cards[id] = { lv: 1, cnt: 0 };
  s.deck = deck;
  return before !== deck.join(',');
}

export async function loadSave(store: Store, user: UserRow): Promise<LoadedSave> {
  const row = await store.getSave(user.id);
  // `fillPick` takes the first candidate rather than a random one: deck repair must be
  // reproducible, and there is nothing to gain from randomising which card fills slot 8.
  const save = normalizeSave(row ? (row.json as Partial<SaveState>) : null, (ids) => ids[0]);

  let dirty = !row;
  if (ensurePlayableDeck(save)) dirty = true;
  if (checkQuests(serverRng(), save)) dirty = true;
  if (save.wallet !== user.wallet || save.walletKind !== user.walletKind) {
    save.wallet = user.wallet;
    save.walletKind = user.walletKind;
    dirty = true;
  }
  return { save, dirty, version: row?.version ?? 0 };
}

export async function persistSave(
  store: Store,
  userId: string,
  save: SaveState,
  meta?: SavePutMeta,
): Promise<SaveState> {
  const row = await store.putSave(userId, save, meta);
  return row.json;
}

/**
 * Load, mutate, write — with the read-modify-write made safe against concurrent requests.
 *
 * Every economy route reads the whole save, changes a few fields in JS and writes the whole
 * document back. Two of those overlapping (claim a quest while an upgrade is in flight) each
 * compute their result from the same starting document, and the second write erases the
 * first — a player loses gold, or gets a level without paying for it. The write is therefore
 * a compare-and-set on `version`, and a losing writer re-reads and re-applies rather than
 * clobbering.
 *
 * `fn` must be a pure function of the save it is handed: it is called again from scratch on
 * every retry, so anything it does outside the save (issuing a chest, spending a nonce) would
 * happen more than once. Routes that need such a side effect roll it *before* calling here and
 * pass the outcome in.
 *
 * `MAX_ATTEMPTS` is small deliberately. Contention on a single player's save is a double-tap,
 * not a thundering herd; if four attempts in a row lose, something is wrong and a 409 is a
 * more honest answer than spinning.
 */
const MAX_ATTEMPTS = 4;

export async function mutateSave<T>(
  store: Store,
  user: UserRow,
  fn: (save: SaveState) => T | Promise<T>,
): Promise<{ result: T; save: SaveState }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { save, version } = await loadSave(store, user);
    const result = await fn(save);
    try {
      const persisted = await persistSave(store, user.id, save, { expectedVersion: version });
      return { result, save: persisted };
    } catch (err) {
      if (!(err instanceof SaveConflictError)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Write back only what the *load* itself repaired — a rolled-over quest set, a patched deck, a
 * re-stamped wallet — and nothing else.
 *
 * Used by the read paths (`GET /api/save`, `/auth/me`, the voided-match response). These must
 * still be compare-and-set, or a slow read would republish a stale document over a payout that
 * landed in between. Losing the race is not an error here: the winner also went through
 * `loadSave`, so its document already carries the same repair. Its version is simply newer, so
 * it wins and we return it.
 */
export async function repairSave(store: Store, user: UserRow): Promise<SaveState> {
  const { save, dirty, version } = await loadSave(store, user);
  if (!dirty) return save;
  try {
    return await persistSave(store, user.id, save, { expectedVersion: version });
  } catch (err) {
    if (!(err instanceof SaveConflictError)) throw err;
    return (await loadSave(store, user)).save;
  }
}

/**
 * "Has this account actually played?"
 *
 * Gates two irreversible operations: the one-time local-save migration, and adopting a
 * session into a wallet's existing account. Both are safe only when nothing would be lost.
 * Deliberately generous about what counts — a name change or an sfx toggle is not progress,
 * but a single won battle, a single opened chest or a spent coin is.
 */
export function hasProgress(s: SaveState): boolean {
  const base = defaultState();
  if (s.trophies > 0 || s.best > 0 || s.wins > 0 || s.losses > 0) return true;
  if (s.lvl > 1 || s.xp > 0) return true;
  if (s.gold !== base.gold || s.gem !== base.gem) return true;
  if (s.pendingChests.length > 0) return true;
  if (s.login.streak > 0 || s.login.day !== 0) return true;
  if (s.walletBonus) return true;
  const st = s.stats;
  if (st.chests > 0 || st.depl > 0 || st.dmg > 0 || st.crown > 0 || st.elix > 0) return true;
  // Owning more than the 12 starter cards, or having levelled any of them, is progress.
  const ids = Object.keys(s.cards);
  if (ids.length !== Object.keys(base.cards).length) return true;
  for (const id of ids) {
    const c = s.cards[id];
    if (c.lv > 1 || c.cnt > 0) return true;
  }
  if (s.quests.list.some((q) => q.prog > 0 || q.claimed)) return true;
  return false;
}

/** 8 distinct, real, owned cards — the shape `Sim` and `validateDeployLog` both assume. */
export function validateDeck(save: SaveState, deck: unknown): string[] | null {
  if (!Array.isArray(deck) || deck.length !== 8) return null;
  const out: string[] = [];
  for (const id of deck) {
    if (typeof id !== 'string') return null;
    // `behemoth_mini` exists in CARD but is spawned by a death effect and is not playable.
    if (!CARD[id] || id === 'behemoth_mini') return null;
    if (!save.cards[id]) return null;
    if (out.indexOf(id) >= 0) return null;
    out.push(id);
  }
  return out;
}
