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
import type { ChestKey, DeployLogEntry, MatchOutcome, SaveState } from './types.js';
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
  deck?: string[];
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
} as const;
