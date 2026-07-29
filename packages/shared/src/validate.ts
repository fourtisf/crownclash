/**
 * Anti-cheat (handoff §5).
 *
 * Two jobs:
 *  - `validateDeployLog` — structural checks on a submitted log *before* it is re-simulated.
 *    The semantic checks (enough elixir, legal position, card actually in hand) are not
 *    duplicated here on purpose: re-running `Sim` is the authority, and a second
 *    implementation of the same rules is a second thing to drift.
 *  - `sanitizeSave` — clamp an incoming save (migration or write) to plausible bounds and
 *    report what had to be clamped, so abuse is visible rather than silently accepted.
 */
import { CARD, DT, MATCH_SECONDS, OVERTIME_SECONDS, RARITY, MAX_CARD_LEVEL } from './data.js';
import { defaultState } from './state.js';
import type { ChestKey, DeployLogEntry, SaveState } from './types.js';

/** §5 — "…>1 deploy per 300ms" ⇒ consecutive deploys must be ≥ 9 ticks apart at 30 Hz. */
export const MIN_DEPLOY_GAP_TICKS = Math.ceil(0.3 / DT);

/** Absolute ceiling on log length: 10 elixir / 2-cost minimum, over 240 s, with slack. */
export const MAX_DEPLOY_ENTRIES = 400;

const MAX_TICK = Math.ceil((MATCH_SECONDS + OVERTIME_SECONDS + 5) / DT);

export interface LogValidation {
  ok: boolean;
  reason?: string;
  at?: number;
}

/**
 * Structural legality of a submitted deploy log.
 *
 * Deliberately strict about ordering: entries must be sorted by tick. A client that
 * interleaves them out of order would replay differently than it played, and we would have
 * no way to tell which ordering was the real one.
 */
export function validateDeployLog(log: unknown, deck: string[]): LogValidation {
  if (!Array.isArray(log)) return { ok: false, reason: 'log-not-array' };
  if (log.length > MAX_DEPLOY_ENTRIES) return { ok: false, reason: 'log-too-long' };

  const deckSet = new Set(deck);
  let lastTick = -Infinity;

  for (let i = 0; i < log.length; i++) {
    const e = log[i] as DeployLogEntry;
    if (!e || typeof e !== 'object') return { ok: false, reason: 'entry-malformed', at: i };
    if (!Number.isInteger(e.t) || e.t < 0 || e.t > MAX_TICK) return { ok: false, reason: 'tick-out-of-range', at: i };
    if (typeof e.cardId !== 'string' || !CARD[e.cardId]) return { ok: false, reason: 'unknown-card', at: i };
    if (e.cardId === 'behemoth_mini') return { ok: false, reason: 'card-not-playable', at: i };
    if (!deckSet.has(e.cardId)) return { ok: false, reason: 'card-not-in-deck', at: i };
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return { ok: false, reason: 'position-not-finite', at: i };
    if (e.t < lastTick) return { ok: false, reason: 'log-out-of-order', at: i };
    if (e.t - lastTick < MIN_DEPLOY_GAP_TICKS && i > 0) return { ok: false, reason: 'deploy-rate-exceeded', at: i };
    lastTick = e.t;
  }
  return { ok: true };
}

/* ------------------------------------------------------------------- saves */

/** §5 caps. Anything beyond these is clamped and flagged rather than trusted. */
export const SAVE_CAPS = {
  gold: 50_000,
  gem: 5_000,
  trophies: 4_500,
  best: 4_500,
  level: 50,
  xp: 1_000_000,
  wins: 1_000_000,
  losses: 1_000_000,
  cardCount: 100_000,
  pendingChests: 4,
  statTotal: 1_000_000_000,
} as const;

export interface SaveSanitizeResult {
  save: SaveState;
  flags: string[];
}

const CHEST_KEYS: ChestKey[] = ['wooden', 'silver', 'golden', 'magical', 'legend'];

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Clamp an untrusted save into legal bounds.
 *
 * Used both for the one-time local-save migration (handoff §3.2) and for every ordinary
 * save write. Returns the flags so the server can persist them — a save arriving with
 * `gold` at 10^9 is not a rounding error, and we want that on the record even though we
 * accept the clamped version rather than dropping the player's progress.
 */
export function sanitizeSave(input: unknown): SaveSanitizeResult {
  const flags: string[] = [];
  const base = defaultState();
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<SaveState>;
  const s: SaveState = Object.assign(base, raw);

  const note = (flag: string, before: number, after: number) => {
    if (before !== after) flags.push(`${flag}:${before}->${after}`);
  };

  const g = clampNum(s.gold, 0, SAVE_CAPS.gold, 0);
  note('gold', Number(s.gold) || 0, g);
  s.gold = g;

  const gem = clampNum(s.gem, 0, SAVE_CAPS.gem, 0);
  note('gem', Number(s.gem) || 0, gem);
  s.gem = gem;

  const tro = Math.round(clampNum(s.trophies, 0, SAVE_CAPS.trophies, 0));
  note('trophies', Number(s.trophies) || 0, tro);
  s.trophies = tro;

  s.best = Math.round(clampNum(s.best, 0, SAVE_CAPS.best, 0));
  if (s.best < s.trophies) s.best = s.trophies;

  s.lvl = Math.round(clampNum(s.lvl, 1, SAVE_CAPS.level, 1));
  s.xp = Math.max(0, clampNum(s.xp, 0, SAVE_CAPS.xp, 0));
  s.wins = Math.round(clampNum(s.wins, 0, SAVE_CAPS.wins, 0));
  s.losses = Math.round(clampNum(s.losses, 0, SAVE_CAPS.losses, 0));

  // Cards: only real ids, level within the rarity's table, non-negative counts.
  const cards: SaveState['cards'] = {};
  const rawCards = (raw.cards && typeof raw.cards === 'object' ? raw.cards : {}) as SaveState['cards'];
  for (const [id, st] of Object.entries(rawCards)) {
    const card = CARD[id];
    if (!card || id === 'behemoth_mini') {
      flags.push(`unknown-card:${id}`);
      continue;
    }
    const maxLv = RARITY[card.r].upCards.length; // 13 entries ⇒ level cap 13
    const lv = Math.round(clampNum(st?.lv, 1, Math.min(maxLv, MAX_CARD_LEVEL), 1));
    const cnt = Math.round(clampNum(st?.cnt, 0, SAVE_CAPS.cardCount, 0));
    if (st && st.lv !== lv) flags.push(`card-level:${id}:${st.lv}->${lv}`);
    if (st && st.cnt !== cnt) flags.push(`card-count:${id}:${st.cnt}->${cnt}`);
    cards[id] = { lv, cnt };
  }
  if (Object.keys(cards).length === 0) {
    flags.push('cards-empty:reset-to-starter');
    Object.assign(cards, defaultState().cards);
  }
  s.cards = cards;

  // Deck: 8 distinct owned cards; anything else falls back to the starter deck.
  const deck = Array.isArray(s.deck) ? s.deck.filter((id) => !!cards[id]) : [];
  const uniq = Array.from(new Set(deck)).slice(0, 8);
  if (uniq.length !== 8) {
    const starter = defaultState().deck.filter((id) => !!cards[id]);
    for (const id of starter) {
      if (uniq.length >= 8) break;
      if (uniq.indexOf(id) < 0) uniq.push(id);
    }
    for (const id of Object.keys(cards)) {
      if (uniq.length >= 8) break;
      if (uniq.indexOf(id) < 0) uniq.push(id);
    }
    flags.push(`deck-repaired:${uniq.length}`);
  }
  s.deck = uniq;

  const pending = Array.isArray(s.pendingChests) ? s.pendingChests.filter((k) => CHEST_KEYS.indexOf(k) >= 0) : [];
  if (pending.length > SAVE_CAPS.pendingChests) flags.push(`pending-chests:${pending.length}`);
  s.pendingChests = pending.slice(0, SAVE_CAPS.pendingChests);

  const st = s.stats && typeof s.stats === 'object' ? s.stats : base.stats;
  s.stats = {
    depl: clampNum(st.depl, 0, SAVE_CAPS.statTotal, 0),
    dmg: clampNum(st.dmg, 0, SAVE_CAPS.statTotal, 0),
    crown: clampNum(st.crown, 0, SAVE_CAPS.statTotal, 0),
    elix: clampNum(st.elix, 0, SAVE_CAPS.statTotal, 0),
    chests: clampNum(st.chests, 0, SAVE_CAPS.statTotal, 0),
  };

  // A far-future free-chest timer would be harmless; a far-past one is how you farm chests.
  s.freeChestAt = clampNum(s.freeChestAt, 0, Date.now() + 7 * 24 * 3600 * 1000, 0);

  s.name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 16) : base.name;
  s.avatar = typeof s.avatar === 'string' ? s.avatar.slice(0, 8) : base.avatar;
  s.sfx = !!s.sfx;
  s.seen = !!s.seen;
  s.tutorialDone = !!s.tutorialDone;
  s.v = 1;

  // Wallet identity is owned by the server's auth flow; a client save can never assert it.
  s.wallet = null;
  s.walletKind = null;
  s.walletBonus = !!raw.walletBonus;

  if (!s.quests || typeof s.quests !== 'object' || !Array.isArray(s.quests.list)) s.quests = { date: '', list: [] };
  s.quests.list = s.quests.list.slice(0, 3).map((q) => ({
    ...q,
    prog: clampNum(q?.prog, 0, Number(q?.goal) || 0, 0),
    claimed: !!q?.claimed,
  }));
  if (!s.login || typeof s.login !== 'object') s.login = { day: 0, last: '', streak: 0 };
  s.login.day = Math.round(clampNum(s.login.day, 0, 6, 0));
  s.login.streak = Math.round(clampNum(s.login.streak, 0, 100000, 0));
  s.login.last = typeof s.login.last === 'string' ? s.login.last.slice(0, 12) : '';

  return { save: s, flags };
}
