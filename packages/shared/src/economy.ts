/**
 * Meta economy — chests, quests, login streak, match rewards, card upgrades.
 *
 * All of it moves server-side (handoff §3.3, §5: "Rewards … applied server-side only",
 * "Server issues chest contents (seeded roll) — client only animates"). The client imports
 * these same functions purely to render optimistic UI; the numbers it shows are always
 * replaced by the server's response.
 *
 * Every roll takes an explicit `Rng` so the server can seed it and log the seed. The
 * prototype's ambient `Math.random()` is gone.
 */
import { CARDS, CHESTS, LOGIN_REWARDS, QUEST_POOL, RARITY, MAX_CARD_LEVEL } from './data.js';
import type { Rng } from './rng.js';
import { dayKey, fmt, xpNeed } from './util.js';
import type { ChestKey, Quest, RarityKey, SaveState } from './types.js';

export interface ChestCardDrop {
  id: string;
  n: number;
  rar: RarityKey;
  isNew?: boolean;
}

export interface ChestResult {
  gold: number;
  gem: number;
  cards: ChestCardDrop[];
}

/** Free chest cadence — L2559, three hours. */
export const FREE_CHEST_MS = 3 * 3600 * 1000;
/** L2951 — pending win-chest queue depth. */
export const MAX_PENDING_CHESTS = 4;

/**
 * L2720-2725 — rarity roll.
 *
 * Walks legendary → epic → rare → common accumulating `odds` (0.005, 0.045, 0.245, 1.0).
 * The published rates in the shop screen are these exact numbers (handoff §7 requires drop
 * rates stay published).
 */
export function pickRarity(rng: Rng, force?: RarityKey | null): RarityKey {
  if (force) return force;
  const r = rng.random();
  let acc = 0;
  for (const k of ['legendary', 'epic', 'rare', 'common'] as RarityKey[]) {
    acc += RARITY[k].odds;
    if (r < acc) return k;
  }
  return 'common';
}

/**
 * L2726-2742 — chest contents.
 *
 * `types = clamp(round(cards/3.2), 2, 6)` distinct rolls; the guarantee applies to the first
 * roll only (D5), so a Legendary Chest yields exactly one guaranteed legendary and the other
 * rolls are ordinary. The last type absorbs whatever count is left, which is why the totals
 * always add up to `CHESTS[kind].cards`.
 */
export function rollChest(rng: Rng, kind: ChestKey): ChestResult {
  const k = CHESTS[kind];
  const out: ChestResult = {
    gold: rng.rndi(k.gold[0], k.gold[1]),
    gem: rng.rndi(k.gem[0], k.gem[1]),
    cards: [],
  };
  const types = Math.min(Math.max(Math.round(k.cards / 3.2), 2), 6);
  let left = k.cards;
  for (let i = 0; i < types; i++) {
    const rar = i === 0 && k.guar ? k.guar : pickRarity(rng);
    const pool = CARDS.filter((c) => c.r === rar);
    const card = rng.pick(pool);
    const cnt =
      i === types - 1
        ? left
        : Math.min(Math.max(Math.round((left / (types - i)) * rng.rnd(0.6, 1.4)), 1), left - (types - i - 1));
    left -= cnt;
    const ex = out.cards.find((x) => x.id === card.id);
    if (ex) ex.n += cnt;
    else out.cards.push({ id: card.id, n: cnt, rar });
    if (left <= 0) break;
  }
  return out;
}

/** L2743-2750 — apply a rolled chest to a save. Mutates `s` and marks first-time cards. */
export function grantChest(s: SaveState, res: ChestResult): ChestResult {
  s.gold += res.gold;
  s.gem += res.gem;
  res.cards.forEach((cd) => {
    if (!s.cards[cd.id]) {
      s.cards[cd.id] = { lv: 1, cnt: 0 };
      cd.isNew = true;
    }
    s.cards[cd.id].cnt += cd.n;
  });
  s.stats.chests++;
  bumpQuest(s, 'chest', 1);
  return res;
}

/* ------------------------------------------------------------------- quests */

/**
 * L2805-2814 — draw 3 distinct quests from the pool of 7.
 * The `dmg` goal is quantised to 500s so the label reads "Deal 4.5K tower damage".
 */
export function rollQuests(rng: Rng, s: SaveState, today = dayKey()): void {
  const pool = QUEST_POOL.slice();
  const list: Quest[] = [];
  for (let i = 0; i < 3; i++) {
    const q = pool.splice(rng.rndi(0, pool.length - 1), 1)[0];
    const goal = q.id === 'dmg' ? rng.rndi(q.goal[0] / 500, q.goal[1] / 500) * 500 : rng.rndi(q.goal[0], q.goal[1]);
    list.push({ id: q.id, n: q.n.replace('{g}', fmt(goal)), i: q.i, goal, prog: 0, rw: q.rw, claimed: false });
  }
  s.quests = { date: today, list };
}

/** L2815 — quests reset when the local date string changes. */
export function checkQuests(rng: Rng, s: SaveState, today = dayKey()): boolean {
  if (s.quests.date !== today) {
    rollQuests(rng, s, today);
    return true;
  }
  return false;
}

/** L2816-2821 */
export function bumpQuest(s: SaveState, type: Quest['id'], n: number): boolean {
  let changed = false;
  s.quests.list.forEach((q) => {
    if (q.id === type && q.prog < q.goal) {
      q.prog = Math.min(q.goal, q.prog + n);
      changed = true;
    }
  });
  return changed;
}

/** L2822 */
export function questsReady(s: SaveState): boolean {
  return s.quests.list.some((q) => q.prog >= q.goal && !q.claimed);
}

/** L2843-2846 — claim one quest. Returns null if it wasn't claimable. */
export function claimQuest(s: SaveState, index: number): { gold: number; gem: number } | null {
  const q = s.quests.list[index];
  if (!q || q.claimed || q.prog < q.goal) return null;
  q.claimed = true;
  s.gold += q.rw.gold;
  s.gem += q.rw.gem;
  return { gold: q.rw.gold, gem: q.rw.gem };
}

/* -------------------------------------------------------------------- login */

/** L2852 */
export function loginReady(s: SaveState, today = dayKey()): boolean {
  return s.login.last !== today;
}

/**
 * L2875-2887 — claim today's login reward and advance the 7-day cycle.
 *
 * The streak increments only when the last claim was literally yesterday's `dayKey`;
 * otherwise it resets to 1. The day index advances mod 7 regardless, so a broken streak
 * still moves you through the cycle — verbatim.
 */
export function claimLogin(
  s: SaveState,
  now = Date.now(),
): { reward: (typeof LOGIN_REWARDS)[number]; chest: ChestKey | null } | null {
  const today = dayKey(new Date(now));
  if (!loginReady(s, today)) return null;
  const r = LOGIN_REWARDS[s.login.day];
  const yesterday = dayKey(new Date(now - 864e5));
  s.login.streak = s.login.last === yesterday ? s.login.streak + 1 : 1;
  s.login.last = today;
  s.login.day = (s.login.day + 1) % 7;
  if (r.gold) s.gold += r.gold;
  if (r.gem) s.gem += r.gem;
  return { reward: r, chest: r.chest ?? null };
}

/* --------------------------------------------------------------- progression */

/** L2382-2385 — returns the number of King Levels gained, for the client's toast. */
export function addXp(s: SaveState, n: number): number {
  s.xp += n;
  let gained = 0;
  while (s.xp >= xpNeed(s.lvl)) {
    s.xp -= xpNeed(s.lvl);
    s.lvl++;
    gained++;
  }
  return gained;
}

/** L2657-2661 — spend gold + duplicate cards to raise a card's level. */
export function upgradeCard(s: SaveState, cid: string): { level: number; cost: number } | null {
  const st = s.cards[cid];
  if (!st) return null;
  const card = CARDS.find((c) => c.id === cid);
  if (!card) return null;
  const rar = RARITY[card.r];
  const need = rar.upCards[st.lv] || 0;
  const cost = rar.upCost[st.lv] || 0;
  if (st.lv >= MAX_CARD_LEVEL || st.cnt < need || s.gold < cost) return null;
  s.gold -= cost;
  st.cnt -= need;
  st.lv++;
  return { level: st.lv, cost };
}

/* -------------------------------------------------------------- match rewards */

export interface MatchRewards {
  result: 'win' | 'lose' | 'draw';
  trophiesBefore: number;
  trophiesAfter: number;
  delta: number;
  gold: number;
  xp: number;
  levelsGained: number;
  chest: ChestKey | null;
}

/**
 * L2939-2954 — the whole post-match payout, applied to the save.
 *
 * Runs on the server only: it is the sole place trophies, gold, XP and the win-chest are
 * created, so a client that lies about its result changes nothing (handoff §5).
 * Win chest odds: 10% golden, 35% silver, 55% wooden — and if the pending queue is already
 * full at 4 the chest is dropped entirely rather than queued.
 */
export function applyMatchRewards(
  rng: Rng,
  s: SaveState,
  result: 'win' | 'lose' | 'draw',
  stats: { depl: number; dmg: number; crown: number; elix: number },
): MatchRewards {
  const delta = result === 'win' ? rng.rndi(28, 33) : result === 'lose' ? -rng.rndi(18, 26) : 0;
  const before = s.trophies;
  s.trophies = Math.max(0, s.trophies + delta);
  s.best = Math.max(s.best, s.trophies);

  let xp = 0;
  if (result === 'win') {
    s.wins++;
    xp = 45;
    bumpQuest(s, 'win', 1);
  } else if (result === 'lose') {
    s.losses++;
    xp = 16;
  }
  const levelsGained = addXp(s, xp);

  bumpQuest(s, 'play', 1);
  bumpQuest(s, 'crown', stats.crown);
  bumpQuest(s, 'depl', stats.depl);
  bumpQuest(s, 'dmg', Math.round(stats.dmg));
  bumpQuest(s, 'elix', Math.round(stats.elix));

  s.stats.depl += stats.depl;
  s.stats.dmg += stats.dmg;
  s.stats.crown += stats.crown;
  s.stats.elix += stats.elix;

  let chest: ChestKey | null = null;
  if (result === 'win') {
    const r = rng.random();
    chest = r < 0.1 ? 'golden' : r < 0.45 ? 'silver' : 'wooden';
    if (s.pendingChests.length < MAX_PENDING_CHESTS) s.pendingChests.push(chest);
    else chest = null;
  }
  const gold = result === 'win' ? rng.rndi(40, 90) : rng.rndi(8, 22);
  s.gold += gold;

  return { result, trophiesBefore: before, trophiesAfter: s.trophies, delta, gold, xp, levelsGained, chest };
}
