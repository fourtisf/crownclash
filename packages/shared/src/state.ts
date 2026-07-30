/** Save state — the prototype's `S` object (L783-797), unchanged in shape (handoff §4). */
import { CARD } from './data.js';
import type { SaveState } from './types.js';

/** L791 — the 12 cards a new account starts with unlocked at level 1. */
export const STARTER_CARDS = [
  'ironclad', 'archers', 'sprites', 'spears', 'wisps', 'volley', 'jolt', 'colossus',
  'turret', 'sharpshooter', 'warden', 'meteor',
];

/** L787 — the 8-card starting deck. */
export const STARTER_DECK = ['ironclad', 'archers', 'sprites', 'spears', 'wisps', 'volley', 'jolt', 'colossus'];

/** L783-794 — verbatim. New account: 1200 gold, 120 gems, 12 cards. */
export function defaultState(): SaveState {
  const st: SaveState = {
    v: 1, name: 'Challenger', avatar: '👑', wallet: null, walletKind: null, walletBonus: false,
    lvl: 1, xp: 0, trophies: 0, best: 0, gold: 1200, gem: 120,
    wins: 0, losses: 0, cards: {}, deck: STARTER_DECK.slice(),
    quests: { date: '', list: [] }, login: { day: 0, last: '', streak: 0 },
    freeChestAt: 0, pendingChests: [], stats: { depl: 0, dmg: 0, crown: 0, elix: 0, chests: 0 }, sfx: true, music: true, seen: false,
    tutorialDone: false, quality: 'high', recoveryAsked: false,
  };
  for (const id of STARTER_CARDS) st.cards[id] = { lv: 1, cnt: 0 };
  return st;
}

/** L795 */
export const ownsCard = (s: SaveState, id: string): boolean => !!s.cards[id];

/** L796 */
export const cardLevel = (s: SaveState, id: string): number => (s.cards[id] ? s.cards[id].lv : 1);

/** Card levels for the 8 deck slots, in the form the sim wants. */
export function deckLevels(s: SaveState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of s.deck) out[id] = cardLevel(s, id);
  return out;
}

/**
 * L2985-2990 — the prototype's load-time repair pass, run on every save read.
 * Kept because real saves in the wild will hit it: shallow-merge over defaults, backfill
 * `stats`/`pendingChests`, drop deck entries for cards that no longer exist, and top the
 * deck back up to 8.
 */
export function normalizeSave(saved: Partial<SaveState> | null, fillPick: (ids: string[]) => string): SaveState {
  const s: SaveState = saved && saved.v ? Object.assign(defaultState(), saved) : defaultState();
  if (!s.stats) s.stats = { depl: 0, dmg: 0, crown: 0, elix: 0, chests: 0 };
  if (!s.pendingChests) s.pendingChests = [];
  if (!s.cards) s.cards = defaultState().cards;
  if (!s.quests) s.quests = { date: '', list: [] };
  if (!s.login) s.login = { day: 0, last: '', streak: 0 };
  if (!s.deck || s.deck.length !== 8) s.deck = defaultState().deck;
  s.deck = s.deck.filter((id) => !!CARD[id]);
  const owned = Object.keys(s.cards);
  let guard = 64;
  while (s.deck.length < 8 && guard-- > 0) {
    // The prototype could pick a duplicate here; we skip dupes so the deck stays legal for
    // the server-side hand-cycle check, which assumes 8 distinct cards.
    const candidate = fillPick(owned.filter((id) => s.deck.indexOf(id) < 0));
    if (!candidate) break;
    s.deck.push(candidate);
  }
  while (s.deck.length < 8) {
    const fallback = defaultState().deck.find((id) => s.deck.indexOf(id) < 0);
    if (!fallback) break;
    s.deck.push(fallback);
  }
  return s;
}
