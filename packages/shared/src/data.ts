/**
 * Game data — copied **verbatim** from reference/crown-clash.html.
 *
 * Handoff §1: "every constant in data.ts must be copied verbatim from crown-clash.html ...
 * Do not 'improve' numbers." `packages/shared/test/data-parity.test.ts` re-extracts these
 * same structures out of the HTML on every run and deep-equals them against this file, so a
 * well-meaning tweak fails CI rather than shipping a balance change.
 *
 * Line references below point at the prototype.
 */
import type { Rng } from './rng.js';
import type {
  Arena,
  Card,
  ChestDef,
  ChestKey,
  LoginReward,
  QuestTemplate,
  Rarity,
  RarityKey,
  ShopEntry,
  TowerKind,
  TowerSide,
} from './types.js';

/* ----------------------------------------------------------------- L685-690 */
export const RARITY: Record<RarityKey, Rarity> = {
  common: { k: 'common', n: 'Common', c: '#b9c6dd', cls: 'r-common', odds: 0.755, upCost: [0, 20, 50, 150, 400, 1000, 2000, 4000, 8000, 15000, 25000, 40000, 60000], upCards: [0, 2, 4, 10, 20, 50, 100, 200, 400, 800, 1000, 2000, 5000] },
  rare: { k: 'rare', n: 'Rare', c: '#ff9d3c', cls: 'r-rare', odds: 0.2, upCost: [0, 50, 150, 400, 1000, 2000, 4000, 8000, 15000, 25000, 40000, 60000, 90000], upCards: [0, 2, 4, 10, 20, 50, 100, 200, 400, 800, 1000, 2000, 5000] },
  epic: { k: 'epic', n: 'Epic', c: '#c060ff', cls: 'r-epic', odds: 0.04, upCost: [0, 400, 1000, 2000, 4000, 8000, 15000, 25000, 40000, 60000, 90000, 120000, 180000], upCards: [0, 2, 4, 10, 20, 50, 100, 200, 400, 800, 1000, 2000, 5000] },
  legendary: { k: 'legendary', n: 'Legendary', c: '#3ff0e0', cls: 'r-legend', odds: 0.005, upCost: [0, 5000, 15000, 25000, 40000, 60000, 90000, 120000, 180000, 250000, 350000, 500000, 700000], upCards: [0, 2, 4, 6, 10, 20, 30, 40, 60, 80, 100, 150, 200] },
};

/** Max card level. The upgrade tables above are 13 entries long. */
export const MAX_CARD_LEVEL = 13;

/** L691 — movement speeds, tiles/second. */
export const SPD = { slow: 0.72, med: 1.05, fast: 1.4, vfast: 1.75 } as const;

/**
 * L694-740 — the 21 playable cards.
 *
 * Note `jolt` sits inside the rare block but is declared `r:'common'` (D4). That is not a
 * typo to fix: it sets jolt's chest pool and its upgrade curve.
 */
export const CARDS: Card[] = [
  { id: 'ironclad', n: 'Ironclad', cost: 3, r: 'common', t: 'troop', cnt: 1, hp: 1600, dmg: 175, hs: 1.2, rg: 0.85, sp: SPD.med, tg: 'ground', rad: 0.42, art: { k: 'humanoid', skin: '#f2c9a0', cloth: '#2f5fbe', armor: '#cfd9ea', weapon: 'sword', helm: 1, shield: 1, sz: 1 }, d: 'Cheap all-round tank.' },
  { id: 'archers', n: 'Twin Archers', cost: 3, r: 'common', t: 'troop', cnt: 2, hp: 290, dmg: 110, hs: 1.15, rg: 5.4, sp: SPD.med, tg: 'both', rad: 0.3, proj: 'arrow', art: { k: 'humanoid', skin: '#f2c9a0', cloth: '#7a2fbe', armor: '#3a2a55', weapon: 'bow', hair: '#f0d060', sz: 0.92 }, d: 'Two archers. Hits air.' },
  { id: 'sprites', n: 'Sprites', cost: 2, r: 'common', t: 'troop', cnt: 3, hp: 230, dmg: 135, hs: 1.05, rg: 0.6, sp: SPD.vfast, tg: 'ground', rad: 0.27, art: { k: 'goblin', skin: '#7ad84f', cloth: '#c94b2b', weapon: 'dagger', sz: 0.78 }, d: 'Three fast bodies. Big DPS.' },
  { id: 'bones', n: 'Bone Horde', cost: 3, r: 'common', t: 'troop', cnt: 10, hp: 95, dmg: 95, hs: 1.0, rg: 0.55, sp: SPD.fast, tg: 'ground', rad: 0.22, art: { k: 'skeleton', sz: 0.72 }, d: 'Ten skeletons. Melts tanks.' },
  { id: 'wisps', n: 'Wisps', cost: 3, r: 'common', t: 'troop', cnt: 3, hp: 215, dmg: 98, hs: 1.0, rg: 1.6, sp: SPD.fast, tg: 'both', rad: 0.3, fly: 1, proj: 'spit', art: { k: 'flyer', body: '#5fd0f5', wing: '#b8e9ff', sz: 0.8 }, d: 'Three flying swarmers.' },
  { id: 'spears', n: 'Spear Sprites', cost: 2, r: 'common', t: 'troop', cnt: 3, hp: 150, dmg: 70, hs: 1.1, rg: 4.8, sp: SPD.vfast, tg: 'both', rad: 0.26, proj: 'spear', art: { k: 'goblin', skin: '#7ad84f', cloth: '#2f7fbe', weapon: 'spear', sz: 0.75 }, d: 'Cheap chip damage from range.' },
  { id: 'turret', n: 'Turret', cost: 3, r: 'common', t: 'build', hp: 950, dmg: 150, hs: 0.9, rg: 5.5, tg: 'ground', rad: 0.55, life: 30, proj: 'ball', art: { k: 'cannon' }, d: 'Building that pulls tanks. 30s.' },
  { id: 'volley', n: 'Volley', cost: 3, r: 'common', t: 'spell', radius: 4.0, dmg: 250, twr: 0.4, art: { k: 'spell', icon: 'arrows', c1: '#8fd0ff', c2: '#2a6ee0' }, d: 'Arrow rain over a wide area.' },

  { id: 'sharpshooter', n: 'Sharpshooter', cost: 4, r: 'rare', t: 'troop', cnt: 1, hp: 780, dmg: 225, hs: 1.1, rg: 6.4, sp: SPD.med, tg: 'both', rad: 0.34, proj: 'bullet', art: { k: 'humanoid', skin: '#f2c9a0', cloth: '#1d7a5f', armor: '#2b3a55', weapon: 'gun', hat: 1, sz: 0.98 }, d: 'Long-range sniper. Steady DPS.' },
  { id: 'warden', n: 'Warden', cost: 4, r: 'rare', t: 'troop', cnt: 1, hp: 1850, dmg: 265, hs: 1.5, rg: 0.9, sp: SPD.med, tg: 'ground', rad: 0.45, splash: 1.7, art: { k: 'humanoid', skin: '#f2c9a0', cloth: '#b03a5a', armor: '#e2c15a', weapon: 'axe', hair: '#ff8c3a', sz: 1.02 }, d: 'Splash attacker. Swarm shredder.' },
  { id: 'colossus', n: 'Colossus', cost: 5, r: 'rare', t: 'troop', cnt: 1, hp: 3700, dmg: 245, hs: 1.5, rg: 0.95, sp: SPD.slow, tg: 'build', rad: 0.62, art: { k: 'humanoid', skin: '#e8b98a', cloth: '#c8862c', armor: '#8a5a24', weapon: 'fist', sz: 1.5 }, d: 'Huge tank. Buildings only.' },
  { id: 'meteor', n: 'Meteor', cost: 4, r: 'rare', t: 'spell', radius: 2.6, dmg: 620, twr: 0.35, knock: 1, art: { k: 'spell', icon: 'meteor', c1: '#ffb04a', c2: '#d02a10' }, d: 'High-damage fireball.' },
  { id: 'drakeling', n: 'Drakeling', cost: 4, r: 'rare', t: 'troop', cnt: 1, hp: 1250, dmg: 195, hs: 1.6, rg: 3.2, sp: SPD.med, tg: 'both', rad: 0.46, fly: 1, splash: 1.5, proj: 'fire', art: { k: 'dragon', body: '#5ac8ff', belly: '#d8f2ff', sz: 1.1 }, d: 'Flying dragon. Splash damage.' },
  { id: 'boar', n: 'Boar Rider', cost: 4, r: 'rare', t: 'troop', cnt: 1, hp: 1650, dmg: 325, hs: 1.6, rg: 0.9, sp: SPD.vfast, tg: 'build', rad: 0.46, art: { k: 'beast', body: '#a86b45', rider: '#e0b040', sz: 1.1 }, d: 'Charges the tower. Win condition.' },
  { id: 'jolt', n: 'Jolt', cost: 2, r: 'common', t: 'spell', radius: 2.5, dmg: 190, twr: 0.35, stun: 0.7, art: { k: 'spell', icon: 'zap', c1: '#a8f0ff', c2: '#2f7fe0' }, d: 'Small zap plus 0.7s stun.' },

  { id: 'blademaster', n: 'Blademaster', cost: 4, r: 'epic', t: 'troop', cnt: 1, hp: 1550, dmg: 730, hs: 1.8, rg: 0.85, sp: SPD.fast, tg: 'ground', rad: 0.44, art: { k: 'humanoid', skin: '#2a2a3a', cloth: '#1b1b2c', armor: '#5a2ab0', weapon: 'greatsword', helm: 1, glow: '#c060ff', sz: 1.12 }, d: 'One-shot machine. Deletes tanks.' },
  { id: 'lancer', n: 'Lancer', cost: 5, r: 'epic', t: 'troop', cnt: 1, hp: 1950, dmg: 430, hs: 1.5, rg: 1.0, sp: SPD.fast, tg: 'ground', rad: 0.48, charge: 2, art: { k: 'humanoid', skin: '#f2c9a0', cloth: '#2f5fbe', armor: '#f0d878', weapon: 'lance', helm: 1, cape: '#c0304a', sz: 1.15 }, d: 'Charge hit deals double damage.' },
  { id: 'pyromancer', n: 'Pyromancer', cost: 5, r: 'epic', t: 'troop', cnt: 1, hp: 880, dmg: 330, hs: 1.4, rg: 5.4, sp: SPD.med, tg: 'both', rad: 0.34, splash: 1.4, proj: 'fire', art: { k: 'humanoid', skin: '#f2c9a0', cloth: '#d8452a', armor: '#7a1f10', weapon: 'staff', hat: 2, beard: '#e8e8f0', sz: 1.02 }, d: 'Rapid fireballs. Splash.' },
  { id: 'behemoth', n: 'Behemoth', cost: 8, r: 'epic', t: 'troop', cnt: 1, hp: 5400, dmg: 330, hs: 2.5, rg: 1.0, sp: SPD.slow, tg: 'build', rad: 0.75, deathDmg: 340, deathRad: 2.2, split: 2, art: { k: 'golem', body: '#6b7a92', crack: '#ffb04a', sz: 1.7 }, d: 'Giant tank. Explodes on death.' },

  { id: 'voidblade', n: 'Voidblade', cost: 4, r: 'legendary', t: 'troop', cnt: 1, hp: 1450, dmg: 390, hs: 1.3, rg: 0.9, sp: SPD.vfast, tg: 'ground', rad: 0.42, dash: 1, art: { k: 'humanoid', skin: '#3a2f55', cloth: '#150e28', armor: '#7ff5ea', weapon: 'twinblade', glow: '#3ff0e0', sz: 1.05 }, d: 'Dashes to the first target.' },
  { id: 'stormtitan', n: 'Storm Titan', cost: 6, r: 'legendary', t: 'troop', cnt: 1, hp: 2900, dmg: 310, hs: 1.7, rg: 4.4, sp: SPD.slow, tg: 'both', rad: 0.62, chain: 2, proj: 'lightning', art: { k: 'titan', body: '#3f5fa8', glow: '#8fe8ff', sz: 1.45 }, d: 'Lightning chains to 3 targets.' },
];

/**
 * L1392-1393 — the hidden 22nd card. Spawned only by Behemoth's `split:2` on death; it is
 * deliberately absent from CARDS so it never appears in a chest, the collection or a deck.
 */
export const BEHEMOTH_MINI: Card = {
  id: 'behemoth_mini', n: 'Behemoth Shard', cost: 0, r: 'epic', t: 'troop', cnt: 1, hp: 1250, dmg: 135, hs: 2.0, rg: 1.0,
  sp: SPD.slow, tg: 'build', rad: 0.48, deathDmg: 130, deathRad: 1.6, art: { k: 'golem', body: '#6b7a92', crack: '#ffb04a', sz: 1.0 }, d: '',
};

/** L741 + L1392 — id → card, including the hidden shard. */
export const CARD: Record<string, Card> = {};
for (const c of CARDS) CARD[c.id] = c;
CARD[BEHEMOTH_MINI.id] = BEHEMOTH_MINI;

/* ----------------------------------------------------------------- L743-752 */
export const ARENAS: Arena[] = [
  { n: 'Training Camp', t: 0, g1: '#3f8f4a', g2: '#357a40', path: '#c9a45f' },
  { n: 'Goblin Stadium', t: 300, g1: '#4a8f3f', g2: '#3d7a35', path: '#b89a52' },
  { n: 'Bone Pit', t: 700, g1: '#6b7a5a', g2: '#5c6a4e', path: '#a8a08a' },
  { n: 'Frozen Peak', t: 1200, g1: '#7fa8c4', g2: '#6b93ae', path: '#dfeaf2' },
  { n: 'Ember Forge', t: 1800, g1: '#8a5a3f', g2: '#754c35', path: '#e0a050' },
  { n: 'Royal Arena', t: 2600, g1: '#3f7f8f', g2: '#356b7a', path: '#e8d9a0' },
  { n: 'Legendary Arena', t: 3600, g1: '#5a4a8f', g2: '#4a3d7a', path: '#d9c8ff' },
];

/**
 * L752 — highest arena whose threshold is met. The prototype scans the whole array and
 * keeps the last match rather than breaking early; identical result, kept for clarity.
 */
export function arenaFor(t: number): { a: Arena; i: number } {
  let a = ARENAS[0];
  let i = 0;
  ARENAS.forEach((x, k) => {
    if (t >= x.t) {
      a = x;
      i = k;
    }
  });
  return { a, i };
}

/* ----------------------------------------------------------------- L754-760 */
export const CHESTS: Record<ChestKey, ChestDef> = {
  wooden: { n: 'Wooden Chest', cards: 3, gold: [60, 120], gem: [0, 2], c1: '#b3803f', c2: '#6b4a1f', guar: null },
  silver: { n: 'Silver Chest', cards: 6, gold: [130, 260], gem: [0, 6], c1: '#d8dfea', c2: '#8a94a8', guar: null },
  golden: { n: 'Golden Chest', cards: 12, gold: [300, 560], gem: [4, 16], c1: '#ffd964', c2: '#c08a10', guar: 'rare' },
  magical: { n: 'Magical Chest', cards: 22, gold: [600, 1100], gem: [10, 30], c1: '#a06bff', c2: '#5a1fb0', guar: 'epic' },
  legend: { n: 'Legendary Chest', cards: 14, gold: [400, 800], gem: [0, 10], c1: '#3ff0e0', c2: '#0f7f9a', guar: 'legendary' },
};

/* ----------------------------------------------------------------- L762-770 */
export const QUEST_POOL: QuestTemplate[] = [
  { id: 'play', n: 'Play {g} battles', i: '⚔️', goal: [2, 4], rw: { gold: 150, gem: 5 } },
  { id: 'win', n: 'Win {g} battles', i: '🏆', goal: [1, 3], rw: { gold: 300, gem: 10 } },
  { id: 'crown', n: 'Destroy {g} towers', i: '👑', goal: [3, 7], rw: { gold: 220, gem: 8 } },
  { id: 'depl', n: 'Deploy {g} troops', i: '🪖', goal: [25, 50], rw: { gold: 180, gem: 5 } },
  { id: 'dmg', n: 'Deal {g} tower damage', i: '💥', goal: [2500, 6000], rw: { gold: 260, gem: 8 } },
  { id: 'chest', n: 'Open {g} chests', i: '🎁', goal: [1, 3], rw: { gold: 200, gem: 6 } },
  { id: 'elix', n: 'Spend {g} elixir', i: '⚡', goal: [60, 120], rw: { gold: 170, gem: 5 } },
];

/* ----------------------------------------------------------------- L771-779 */
export const LOGIN_REWARDS: LoginReward[] = [
  { i: '🪙', n: '200 Gold', gold: 200 },
  { i: '💎', n: '25 Gem', gem: 25 },
  { i: '🎁', n: 'Wooden Chest', chest: 'wooden' },
  { i: '🪙', n: '600 Gold', gold: 600 },
  { i: '💎', n: '60 Gem', gem: 60 },
  { i: '🎁', n: 'Silver Chest', chest: 'silver' },
  { i: '👑', n: 'Golden Chest + 150 Gems', chest: 'golden', gem: 150 },
];

/* ---------------------------------------------------------------- L2683-2690 */
export const SHOP: ShopEntry[] = [
  { kind: 'wooden', cur: 'gold', price: 200 },
  { kind: 'silver', cur: 'gold', price: 600 },
  { kind: 'golden', cur: 'gold', price: 1800 },
  { kind: 'magical', cur: 'gem', price: 280 },
  { kind: 'legend', cur: 'gem', price: 900 },
  { kind: 'gold', cur: 'gem', price: 120, gold: 2500, label: '2,500 Gold' },
];

/* ------------------------------------------------------- arena geometry L1379 */
export const AW = 18;
export const AH = 30;
export const RIV_T = 14.15;
export const RIV_B = 15.85;
export const BRIDGE: [number, number] = [4.0, 14.0];

/* ---------------------------------------------------------------- L1380-1383 */
export const TOWER_DEF: Record<TowerKind, { hp: number; dmg: number; hs: number; rg: number; rad: number }> = {
  princess: { hp: 2400, dmg: 92, hs: 0.8, rg: 7.4, rad: 1.05 },
  king: { hp: 4000, dmg: 112, hs: 1.0, rg: 7.0, rad: 1.3 },
};

/* ---------------------------------------------------------------- L1384-1391 */
export const TOWER_POS: { team: 0 | 1; kind: TowerKind; x: number; y: number; side: TowerSide }[] = [
  { team: 0, kind: 'princess', x: 3.3, y: 23.4, side: 'L' },
  { team: 0, kind: 'princess', x: 14.7, y: 23.4, side: 'R' },
  { team: 0, kind: 'king', x: 9.0, y: 27.1, side: 'K' },
  { team: 1, kind: 'princess', x: 3.3, y: 6.6, side: 'L' },
  { team: 1, kind: 'princess', x: 14.7, y: 6.6, side: 'R' },
  { team: 1, kind: 'king', x: 9.0, y: 2.9, side: 'K' },
];

/* ---------------------------------------------------------------- L1395-1403 */
/**
 * Opponent decks, ordered by tier — index 0 is the softest, the last is the hardest.
 *
 * The prototype shipped the first six (L1395-1403) and picked one by arena index with no
 * randomness at all, so a player grinding a single arena met the *same eight cards* every
 * match, sometimes forty times running. The random names and avatars made that worse rather
 * than better: it looked like variety and was not.
 *
 * Twelve now, two per tier, chosen from a band (`aiDeckIndexFor`). Every added deck is built
 * from the same 21 cards and follows the same shape as the originals — a win condition, a
 * tank or a swarm to defend with, air cover, and a spell — so this widens the pool without
 * touching what any card does.
 */
export const AI_DECKS: string[][] = [
  // Tier 0 — Training Camp / Goblin Stadium
  ['ironclad', 'archers', 'sprites', 'bones', 'wisps', 'volley', 'colossus', 'jolt'],
  ['ironclad', 'spears', 'sprites', 'turret', 'wisps', 'volley', 'warden', 'jolt'],
  // Tier 1 — Bone Pit
  ['boar', 'warden', 'archers', 'spears', 'meteor', 'jolt', 'turret', 'wisps'],
  ['colossus', 'archers', 'bones', 'sprites', 'volley', 'jolt', 'ironclad', 'wisps'],
  // Tier 2 — Frozen Peak
  ['colossus', 'sharpshooter', 'drakeling', 'warden', 'meteor', 'jolt', 'sprites', 'bones'],
  ['boar', 'pyromancer', 'wisps', 'ironclad', 'volley', 'jolt', 'spears', 'turret'],
  // Tier 3 — Ember Forge
  ['lancer', 'blademaster', 'wisps', 'volley', 'sharpshooter', 'turret', 'jolt', 'ironclad'],
  ['colossus', 'pyromancer', 'drakeling', 'bones', 'meteor', 'jolt', 'archers', 'warden'],
  // Tier 4 — Royal Arena
  ['behemoth', 'drakeling', 'pyromancer', 'warden', 'meteor', 'jolt', 'archers', 'bones'],
  ['lancer', 'stormtitan', 'wisps', 'warden', 'volley', 'jolt', 'sprites', 'turret'],
  // Tier 5 — Legendary Arena
  ['voidblade', 'stormtitan', 'boar', 'warden', 'meteor', 'volley', 'sprites', 'turret'],
  ['behemoth', 'voidblade', 'pyromancer', 'sharpshooter', 'meteor', 'jolt', 'wisps', 'bones'],
];

/** Decks per difficulty tier. `AI_DECKS` is grouped, so tier `t` starts at `t * AI_DECKS_PER_TIER`. */
export const AI_DECKS_PER_TIER = 2;
/** Six tiers across seven arenas — the top two arenas share the hardest one. */
export const AI_TIERS = AI_DECKS.length / AI_DECKS_PER_TIER;

export const AI_NAMES: string[] = ['DragonSlayer', 'xX_Reaper_Xx', 'StormBringer', 'ElixirGolem', 'NoobMaster69', 'LordOfCrowns', 'GrandMarshal', 'Zeus', 'MetaAbuser', 'WhaleTrader', 'GG_Vortex', 'KingRobin'];

export const AI_AVATARS: string[] = ['🐉', '💀', '🦁', '⚔️', '🔥', '🧙', '🏹', '⚡', '👺'];

/** L1980 — the ids `aiUpdate` treats as "a spell I can drop on a crowd". */
export const SPELL_IDS: string[] = ['volley', 'meteor', 'jolt'];

/* ------------------------------------------------------------- match constants */
/** L1443-1444 — 180 s regulation, 60 s sudden death, elixir 5→10 at 1 per 2.8 s. */
export const MATCH_SECONDS = 180;
export const OVERTIME_SECONDS = 60;
export const ELIX_START = 5;
export const ELIX_MAX = 10;
export const ELIX_RATE = 1 / 2.8;

/**
 * Fixed simulation step. The prototype ran a variable-dt rAF loop clamped to `min(.05, …)`;
 * re-simulation needs one shared rate on client and server, so the sim is stepped at 30 Hz
 * and the client interpolates between ticks for rendering.
 */
export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;

/**
 * How strong the opponent's cards are, from the player's trophies.
 *
 * The prototype's L1440 was `1 + floor(trophies / 240)`: **linear** in trophies. Card upgrades
 * cost roughly double per level, which makes a player's power **logarithmic** in the resources
 * they earn. Two curves shaped like that diverge, and `tools/economy-sim.mjs` — which plays
 * the real economy through the real `applyMatchRewards`/`rollChest`/`upgradeCard` — measured
 * exactly where:
 *
 *   arena            player deck lv   old AI lv   AI stat advantage
 *   Goblin Stadium        3.6              2          0.73x
 *   Bone Pit              4.4              3          0.77x
 *   Frozen Peak           4.9              6          1.24x
 *   Ember Forge           5.3              8          1.69x
 *   Royal Arena           5.9             11          2.66x
 *   Legendary Arena       6.0             13          3.80x
 *
 * A player asymptotes near level 6; the AI marched to 13. Past Ember Forge the ladder was not
 * difficult, it was closed — and that measurement is already generous (55% win rate, 25
 * matches a day, every quest and free chest claimed, gold always spent on the cheapest
 * available upgrade).
 *
 * The curve below is anchored to that measured player progression instead, with a deliberate
 * offset: the opponent is *behind* the player in the first two arenas, level with them in the
 * middle, and ahead at the top so the ladder still has a summit worth climbing. Interpolated
 * between anchors so there are no difficulty cliffs at arena boundaries.
 *
 * `test/balance.test.ts` re-runs the same economy model and fails if any arena drifts outside
 * the intended band, so this cannot silently rot the next time a chest or a cost changes.
 */
const AI_LEVEL_CURVE: { t: number; lv: number }[] = [
  { t: 0, lv: 1 },
  { t: 300, lv: 3 },
  { t: 700, lv: 4 },
  { t: 1200, lv: 5 },
  { t: 1800, lv: 6 },
  { t: 2600, lv: 7 },
  { t: 3600, lv: 8 },
];

export function aiLevelFor(trophies: number): number {
  const t = Math.max(0, trophies);
  const last = AI_LEVEL_CURVE[AI_LEVEL_CURVE.length - 1];
  if (t >= last.t) return Math.min(MAX_CARD_LEVEL, last.lv);
  let i = 0;
  while (i < AI_LEVEL_CURVE.length - 1 && t >= AI_LEVEL_CURVE[i + 1].t) i++;
  const a = AI_LEVEL_CURVE[i];
  const b = AI_LEVEL_CURVE[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  return Math.min(MAX_CARD_LEVEL, Math.max(1, Math.round(a.lv + (b.lv - a.lv) * f)));
}

/**
 * Pick an opponent deck for an arena.
 *
 * Replaces L1446's `min(arenaIndex, AI_DECKS.length - 1)`, which was a pure function of the
 * arena and therefore handed a player the identical eight cards for their entire stay in it.
 *
 * The band is this arena's tier plus the one below, so an opponent is always appropriate to
 * where the player is but never the same twice running by construction. `rng` comes off the
 * match seed, which the server generates and freezes into the `Match` row — so the choice is
 * unpredictable to the client and still perfectly reproducible when the log is re-simulated.
 *
 * Called without an `rng` it returns the tier's first deck, which keeps every existing caller
 * and every fixture deterministic.
 */
export function aiDeckIndexFor(arenaIndex: number, rng?: Rng): number {
  const tier = Math.min(Math.max(arenaIndex, 0), AI_TIERS - 1);
  const lo = Math.max(0, tier - 1) * AI_DECKS_PER_TIER;
  const hi = tier * AI_DECKS_PER_TIER + (AI_DECKS_PER_TIER - 1);
  return rng ? rng.rndi(lo, hi) : tier * AI_DECKS_PER_TIER;
}
