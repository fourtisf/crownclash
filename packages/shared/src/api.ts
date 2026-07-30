/**
 * HTTP contract between `apps/web` and `apps/server`.
 *
 * Lives in shared so neither side can drift: the server's zod schemas are built from these
 * shapes and the client's fetch wrapper is typed by them.
 *
 * The shape of every mutating response is the same on purpose — `{ save, ... }` — because
 * the server owns the save. The client never patches its local copy from its own optimism;
 * it replaces it with whatever comes back.
 */
import type { ChestKey, DeployLogEntry, MatchOutcome, Quality, SaveState } from './types.js';
import type { ChestResult, MatchRewards } from './economy.js';

export const API_PREFIX = '/api';

/* ---------------------------------------------------------------------- auth */

export interface GuestAuthRequest {
  /** Stable per-device id generated client-side and kept in IndexedDB. */
  deviceId: string;
}

export interface AuthResponse {
  userId: string;
  wallet: string | null;
  walletKind: string | null;
  airdropEligible: boolean;
  save: SaveState;
  /** True when this call created the account. */
  created: boolean;
  /**
   * A recovery code has been issued for this account.
   *
   * Never the code itself — only its hash is stored, so nothing can hand it back. This flag
   * exists so the client knows whether it still needs to ask the player to make one.
   */
  hasRecovery: boolean;
}

/* ------------------------------------------------------------------- recovery */

/**
 * Account recovery.
 *
 * A guest account is identified by a random device id in the browser's IndexedDB and nothing
 * else. Clear site data, replace the phone, or let the browser evict storage, and the account
 * is unreachable — everything the player earned is still on the server with no way to prove it
 * is theirs. Wallet linking was the only answer, which excludes anyone without a wallet.
 *
 * A recovery code is a 100-bit secret the player can write down. The server stores only an
 * HMAC of it, so it is shown exactly once and a database dump yields nothing usable.
 */
export interface RecoveryCreateResponse {
  /** Plaintext, formatted in groups of five. Shown once and never retrievable again. */
  code: string;
  /** ISO timestamp the code was issued, so the UI can say which one is live. */
  issuedAt: string;
  /** True when this replaced an earlier code, which is now dead. */
  replaced: boolean;
}

export interface RecoveryRedeemRequest {
  code: string;
  /**
   * The device to move the account onto.
   *
   * Redemption has to rebind, not just hand out a cookie: `boot()` signs in with the device
   * id on every launch, so a session alone would strand the player again the moment it
   * expired. Same reserved-namespace rules as `/auth/guest`.
   */
  deviceId: string;
}

export interface WalletNonceRequest {
  address: string;
  kind: 'evm' | 'solana';
}

export interface WalletNonceResponse {
  nonce: string;
  /** For EVM this is a full SIWE message; for Solana, the text to sign. */
  message: string;
}

export interface WalletLinkRequest {
  address: string;
  kind: 'evm' | 'solana';
  signature: string;
  message: string;
}

export interface WalletLinkResponse {
  wallet: string;
  walletKind: string;
  airdropEligible: boolean;
  /** +100 gems, granted server-side exactly once per account (handoff §3.3). */
  bonusGranted: boolean;
  save: SaveState;
}

/* ---------------------------------------------------------------------- save */

export interface SaveResponse {
  save: SaveState;
  /** Sanitizer findings, if the incoming save had to be clamped. */
  flags?: string[];
}

export interface SaveMigrateRequest {
  save: unknown;
}

export interface ProfileUpdateRequest {
  name?: string;
  avatar?: string;
  sfx?: boolean;
  music?: boolean;
  deck?: string[];
  /** First-run explainer dismissed. The prototype persisted this on `S` (L2995). */
  seen?: boolean;
  /** First-match coach marks finished or skipped. One-way: it can only be set true. */
  tutorialDone?: boolean;
  /** Graphics preset. */
  quality?: Quality;
  /** Recovery-code prompt shown. One-way: it can only be set true. */
  recoveryAsked?: boolean;
}

/* --------------------------------------------------------------------- match */

export interface MatchStartResponse {
  matchId: string;
  seed: string;
  /** Which AI deck the server chose — the client must simulate against this one. */
  aiDeckIndex: number;
  aiLevel: number;
  aiName: string;
  aiAvatar: string;
  aiTrophies: number;
  /** Echoed so the client simulates with exactly what the server will re-simulate with. */
  myDeck: string[];
  myCardLevels: Record<string, number>;
  myKingLevel: number;
}

export interface MatchFinishRequest {
  matchId: string;
  deployLog: DeployLogEntry[];
  /**
   * The player gave up rather than playing to the whistle.
   *
   * Trusting this costs nothing: conceding can only ever *lose* trophies, so there is no
   * incentive to claim it falsely. The log is still validated exactly as normal — conceding
   * is not an escape hatch from a tampered log.
   */
  conceded?: boolean;
  /**
   * Tick the player gave up on. The server simulates the log only up to here, so the crowns
   * shown on the result screen are the ones that were actually on the board at that moment.
   */
  concededAtTick?: number;
}

export interface MatchFinishResponse {
  /** The server's own result. A client-claimed result is never read. */
  result: MatchOutcome;
  crowns: [number, number];
  rewards: MatchRewards;
  save: SaveState;
  /** Present when the log failed validation; the match is recorded but pays nothing. */
  voided?: { reason: string };
}

/* --------------------------------------------------------------------- chest */

export interface ChestOpenRequest {
  /** `pending` opens the queued win-chest at `index`; `free` opens the 3-hour chest. */
  source: 'pending' | 'free' | 'shop' | 'login';
  index?: number;
  kind?: ChestKey;
}

export interface ChestOpenResponse {
  kind: ChestKey;
  /** Rolled server-side from a seed the client never sees; the client only animates it. */
  result: ChestResult;
  save: SaveState;
}

export interface ShopBuyRequest {
  /** Index into `SHOP`. */
  index: number;
}

export interface ShopBuyResponse {
  save: SaveState;
  /** Set for chest purchases; the client then plays the open animation. */
  chest?: { kind: ChestKey; result: ChestResult };
  /** Set for the gold pack. */
  gold?: number;
}

/* ------------------------------------------------------------- quests / login */

export interface QuestClaimRequest {
  index: number;
}
export interface QuestClaimResponse {
  gold: number;
  gem: number;
  save: SaveState;
}

export interface LoginClaimResponse {
  reward: { i: string; n: string; gold?: number; gem?: number; chest?: ChestKey };
  chest?: { kind: ChestKey; result: ChestResult };
  save: SaveState;
}

export interface UpgradeCardRequest {
  cardId: string;
}
export interface UpgradeCardResponse {
  level: number;
  cost: number;
  save: SaveState;
}

/* --------------------------------------------------------------- leaderboard */

export interface LeaderboardEntry {
  rank: number;
  name: string;
  avatar: string;
  trophies: number;
  best: number;
  /** True for the requesting user's own row. */
  me?: boolean;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

/* ----------------------------------------------------------------- telemetry */

/**
 * One analytics event.
 *
 * Deliberately loose: `name` plus a flat bag of scalars. A rigid schema would mean a server
 * deploy every time a question changes, and the questions change constantly early on.
 * The server clamps sizes and never trusts any of it — telemetry is evidence, not state, and
 * nothing in the game may read it back.
 */
export interface TelemetryEvent {
  name: string;
  /** Client wall-clock at emit, ms. Kept so out-of-order batches can still be sequenced. */
  t: number;
  props?: Record<string, string | number | boolean | null>;
}

export interface TelemetryRequest {
  events: TelemetryEvent[];
  /** Groups events from one page load without needing a cookie or a user id. */
  session: string;
}

/** Event names the client emits. Listed here so the two sides cannot drift on spelling. */
export const TELEMETRY = {
  appOpen: 'app_open',
  screenView: 'screen_view',
  matchStart: 'match_start',
  matchEnd: 'match_end',
  matchGiveUp: 'match_give_up',
  matchVoided: 'match_voided',
  tutorialStep: 'tutorial_step',
  tutorialDone: 'tutorial_done',
  chestOpen: 'chest_open',
  shopBuy: 'shop_buy',
  cardUpgrade: 'card_upgrade',
  questClaim: 'quest_claim',
  loginClaim: 'login_claim',
  walletLink: 'wallet_link',
  clientError: 'client_error',
} as const;

/* --------------------------------------------------------------------- error */

export interface ApiError {
  error: string;
  message?: string;
  /** Seconds until the caller may retry, for 429s. */
  retryAfter?: number;
}

/** Error codes the client branches on. Anything else is treated as a generic failure. */
export const API_ERRORS = {
  unauthorized: 'unauthorized',
  rateLimited: 'rate_limited',
  matchNotFound: 'match_not_found',
  matchAlreadyFinished: 'match_already_finished',
  invalidLog: 'invalid_log',
  notEnoughCurrency: 'not_enough_currency',
  nothingToClaim: 'nothing_to_claim',
  walletTaken: 'wallet_taken',
  badSignature: 'bad_signature',
  /** The code does not match any account. Deliberately says nothing about why. */
  badRecoveryCode: 'bad_recovery_code',
  /**
   * The browser redeeming the code already has an account with progress on it. Recovering
   * would abandon that progress, so it is refused rather than resolved by guessing.
   */
  recoveryConflict: 'recovery_conflict',
} as const;
