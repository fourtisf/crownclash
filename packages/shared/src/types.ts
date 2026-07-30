/** Shared vocabulary for the game. No runtime values live here. */

export type RarityKey = 'common' | 'rare' | 'epic' | 'legendary';
export type CardType = 'troop' | 'build' | 'spell';
export type TargetKind = 'ground' | 'both' | 'build';
export type ChestKey = 'wooden' | 'silver' | 'golden' | 'magical' | 'legend';
export type ProjKind = 'arrow' | 'spear' | 'bullet' | 'fire' | 'ball' | 'spit' | 'lightning';

/**
 * Graphics preset.
 *
 * `low` targets phones that cannot afford an offscreen bloom pass; `high` turns everything on.
 * Stored on the save rather than in device storage so a player's choice follows them, and so
 * support can see what a bug report was rendered with.
 */
export type Quality = 'low' | 'med' | 'high';

export interface Rarity {
  k: RarityKey;
  n: string;
  c: string;
  cls: string;
  odds: number;
  /** Indexed by current level (1-based reads as `upCost[lv]`); index 0 is unused. */
  upCost: number[];
  upCards: number[];
}

/** Art descriptor — consumed only by the client's procedural renderer. */
export interface CardArt {
  k: string;
  sz?: number;
  [key: string]: unknown;
}

export interface Card {
  id: string;
  n: string;
  cost: number;
  r: RarityKey;
  t: CardType;
  d: string;
  art: CardArt;
  /** troop/building */
  cnt?: number;
  hp?: number;
  dmg?: number;
  /** hit speed, seconds between swings */
  hs?: number;
  /** range, tiles */
  rg?: number;
  /** tiles per second */
  sp?: number;
  tg?: TargetKind;
  rad?: number;
  fly?: number;
  proj?: ProjKind;
  splash?: number;
  /** building lifetime, seconds */
  life?: number;
  /** damage multiplier when charged (lancer) */
  charge?: number;
  /** chained extra targets (stormtitan) */
  chain?: number;
  /** dashes to first target (voidblade) */
  dash?: number;
  deathDmg?: number;
  deathRad?: number;
  split?: number;
  /** spell */
  radius?: number;
  /** spell damage multiplier against towers */
  twr?: number;
  stun?: number;
  knock?: number;
}

export interface Arena {
  n: string;
  t: number;
  g1: string;
  g2: string;
  path: string;
}

export interface ChestDef {
  n: string;
  cards: number;
  gold: [number, number];
  gem: [number, number];
  c1: string;
  c2: string;
  guar: RarityKey | null;
}

export type QuestKind = 'play' | 'win' | 'crown' | 'depl' | 'dmg' | 'chest' | 'elix';

export interface QuestTemplate {
  id: QuestKind;
  n: string;
  i: string;
  goal: [number, number];
  rw: { gold: number; gem: number };
}

export interface Quest {
  id: QuestKind;
  n: string;
  i: string;
  goal: number;
  prog: number;
  rw: { gold: number; gem: number };
  claimed: boolean;
}

export interface LoginReward {
  i: string;
  n: string;
  gold?: number;
  gem?: number;
  chest?: ChestKey;
}

export interface ShopEntry {
  kind: ChestKey | 'gold';
  cur: 'gold' | 'gem';
  price: number;
  gold?: number;
  label?: string;
}

/** Persisted player save. Mirrors the prototype's `S` object 1:1 (handoff §4). */
export interface SaveState {
  v: number;
  name: string;
  avatar: string;
  wallet: string | null;
  walletKind: string | null;
  walletBonus: boolean;
  lvl: number;
  xp: number;
  trophies: number;
  best: number;
  gold: number;
  gem: number;
  wins: number;
  losses: number;
  cards: Record<string, { lv: number; cnt: number }>;
  deck: string[];
  quests: { date: string; list: Quest[] };
  login: { day: number; last: string; streak: number };
  freeChestAt: number;
  pendingChests: ChestKey[];
  stats: { depl: number; dmg: number; crown: number; elix: number; chests: number };
  sfx: boolean;
  /**
   * Background music, separate from `sfx` because the two get turned off for different
   * reasons — music goes off to listen to something else, effects go off to be quiet.
   */
  music: boolean;
  seen: boolean;
  /**
   * First-match coach marks have been completed or skipped.
   *
   * Deliberately its own flag rather than deriving from `wins + losses === 0`: a draw
   * increments neither counter (L2943-2944), so a drawn first match would replay the tutorial.
   */
  tutorialDone: boolean;
  /** Graphics preset. Absent on old saves ⇒ 'high', then auto-degraded at runtime. */
  quality: Quality;
  /**
   * The "save a recovery code" prompt has been shown after a first win.
   *
   * One-way, like `seen` and `tutorialDone`: the offer stands permanently in Settings, so
   * re-showing the modal would only train players to dismiss it.
   */
  recoveryAsked: boolean;
}

/* ------------------------------------------------------------------ simulation */

export type UnitKind = 'tower' | 'troop' | 'build';
export type TowerKind = 'princess' | 'king';
export type TowerSide = 'L' | 'R' | 'K';

export interface Unit {
  uid: number;
  team: 0 | 1;
  kind: UnitKind;
  cid: string | null;
  card: Card | null;
  lvl: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dmg: number;
  hs: number;
  rg: number;
  rad: number;
  sp: number;
  tg: TargetKind;
  fly: number;
  splash: number;
  proj: ProjKind | null;
  atkCd: number;
  deploy: number;
  target: Unit | null;
  walk: number;
  atkAnim: number;
  flash: number;
  dead: boolean;
  stun: number;
  charged: number;
  chargeRun: number;
  dashed: number;
  life: number;
  retarget: number;
  face: number;
  /* tower-only */
  twKind?: TowerKind;
  side?: TowerSide;
  active?: boolean;
}

export interface Projectile {
  x: number;
  y: number;
  tx: number;
  ty: number;
  target: Unit | null;
  sp: number;
  dmg: number;
  team: 0 | 1;
  kind: ProjKind;
  owner: Unit;
  t: number;
  ang?: number;
  dead?: boolean;
}

export interface PendingSpell {
  cid: string;
  card: Card;
  team: 0 | 1;
  x: number;
  y: number;
  lvl: number;
  t: number;
  dur: number;
  done: boolean;
}

export type MatchPhase = 'normal' | 'over';
export type MatchOutcome = 'win' | 'lose' | 'draw';

/** One player action. `t` is the tick index the deploy is applied on (handoff §3.3). */
export interface DeployLogEntry {
  t: number;
  cardId: string;
  x: number;
  y: number;
}

/**
 * Events the sim emits each tick. The client turns these into particles, floats, shake and
 * sound; the server throws them away. Keeping FX out of sim state is what lets one code
 * path serve both.
 */
export type SimEvent =
  | { k: 'deploy'; cid: string; team: 0 | 1; x: number; y: number; count: number }
  /** Spawn ring. Emitted once per ring the prototype pushed, so the client can map 1:1. */
  | { k: 'ring'; x: number; y: number; team: 0 | 1; r: number }
  | { k: 'spellCast'; cid: string; team: 0 | 1; x: number; y: number }
  | { k: 'spellImpact'; cid: string; team: 0 | 1; x: number; y: number; radius: number }
  | { k: 'hit'; x: number; y: number; amount: number; byTeam: 0 | 1; rad: number }
  | { k: 'melee'; x: number; y: number }
  | { k: 'splash'; x: number; y: number; radius: number }
  | { k: 'chain'; x: number; y: number }
  | { k: 'shoot'; kind: ProjKind }
  | { k: 'projHit'; x: number; y: number; kind: ProjKind }
  | { k: 'death'; x: number; y: number; team: 0 | 1; rad: number }
  | { k: 'deathBlast'; x: number; y: number; radius: number }
  | { k: 'charged'; x: number; y: number }
  | { k: 'dash'; x: number; y: number }
  | { k: 'towerDown'; x: number; y: number; team: 0 | 1; byTeam: 0 | 1 }
  | { k: 'phase'; phase: MatchPhase }
  | { k: 'end'; result: MatchOutcome; instant: boolean };

export interface MatchStats {
  depl: number;
  elix: number;
  dmg: number;
  crown: number;
}

export interface SimConfig {
  seed: string;
  /** Player deck (8 card ids) and the level of each card. */
  myDeck: string[];
  myCardLevels: Record<string, number>;
  /** Player's King Level — drives their tower stats. */
  myKingLevel: number;
  /** Index into AI_DECKS, derived from arena. */
  aiDeckIndex: number;
  /** AI card + tower level. */
  aiLevel: number;
}

export interface MatchResultSummary {
  result: MatchOutcome;
  crowns: [number, number];
  stats: MatchStats;
  /** Ticks elapsed when the match ended. */
  endTick: number;
  /** Stable hash of the final state — used by the determinism test and by audit logs. */
  hash: string;
}
