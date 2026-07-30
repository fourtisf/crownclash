/**
 * API client.
 *
 * Replaces the prototype's `window.storage` shim (L669-682). Two rules:
 *
 *  - **The server owns the save.** Every mutating call returns the authoritative
 *    `SaveState`; we overwrite, never merge. Optimistic local edits would drift from the
 *    server's copy and the drift would be invisible until a reload.
 *  - **Failures are visible.** The prototype's `Store` swallowed every error and silently
 *    fell back to an in-memory map, so a broken save looked exactly like a working one (B4).
 *    Here a failure throws `ApiFailure`, and the offline queue is an explicit decision made
 *    by the caller, not an accident.
 *
 * The session cookie is httpOnly and set by the server, so there is no token to steal from
 * JS; `credentials: 'include'` is what carries it.
 */
import { API_ERRORS, API_PREFIX } from '@crown/shared';
import type {
  ApiError, AuthResponse, ChestOpenRequest, ChestOpenResponse, LeaderboardResponse,
  MatchHistoryResponse, MatchReplayResponse,
  LoginClaimResponse, MatchFinishRequest, MatchFinishResponse, MatchStartResponse,
  ProfileUpdateRequest, QuestClaimRequest, QuestClaimResponse, RecoveryCreateResponse,
  SaveResponse, ShopBuyRequest,
  ShopBuyResponse, UpgradeCardRequest, UpgradeCardResponse, WalletLinkRequest,
  WalletLinkResponse, WalletNonceRequest, WalletNonceResponse,
} from '@crown/shared';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;

  constructor(status: number, body: ApiError | null, fallback = 'request failed') {
    super(body?.message || body?.error || fallback);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = body?.error || 'unknown';
    this.retryAfter = body?.retryAfter;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
  get isRateLimited(): boolean {
    return this.status === 429 || this.code === API_ERRORS.rateLimited;
  }
  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === API_ERRORS.unauthorized;
  }
}

const BASE = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${API_PREFIX}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Network-level failure: no response at all. Status 0 distinguishes it from a 5xx.
    throw new ApiFailure(0, null, 'network unreachable');
  }
  if (!res.ok) {
    let parsed: ApiError | null = null;
    try {
      parsed = (await res.json()) as ApiError;
    } catch {
      /* non-JSON error body; the status alone will have to do */
    }
    throw new ApiFailure(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});

export const api = {
  /* auth */
  guest: (deviceId: string) => post<AuthResponse>('/auth/guest', { deviceId }),
  me: () => get<AuthResponse>('/auth/me'),
  logout: () => post<void>('/auth/logout'),
  walletNonce: (req: WalletNonceRequest) => post<WalletNonceResponse>('/auth/wallet/nonce', req),
  walletLink: (req: WalletLinkRequest) => post<WalletLinkResponse>('/auth/wallet/link', req),
  walletUnlink: () => post<SaveResponse>('/auth/wallet/unlink'),

  /* recovery */
  createRecovery: () => post<RecoveryCreateResponse>('/auth/recovery'),
  redeemRecovery: (code: string, deviceId: string) =>
    post<AuthResponse>('/auth/recovery/redeem', { code, deviceId }),

  /* save */
  loadSave: () => get<SaveResponse>('/save'),
  migrateSave: (save: unknown) => post<SaveResponse>('/save/migrate', { save }),
  updateProfile: (req: ProfileUpdateRequest) => post<SaveResponse>('/save/profile', req),

  /* match */
  matchStart: () => post<MatchStartResponse>('/match/start'),
  matchFinish: (req: MatchFinishRequest) => post<MatchFinishResponse>('/match/finish', req),

  /* economy */
  openChest: (req: ChestOpenRequest) => post<ChestOpenResponse>('/chest/open', req),
  buy: (req: ShopBuyRequest) => post<ShopBuyResponse>('/shop/buy', req),
  claimQuest: (req: QuestClaimRequest) => post<QuestClaimResponse>('/quest/claim', req),
  claimLogin: () => post<LoginClaimResponse>('/login/claim'),
  upgradeCard: (req: UpgradeCardRequest) => post<UpgradeCardResponse>('/cards/upgrade', req),

  /* history + replay */
  matchHistory: () => get<MatchHistoryResponse>('/match/history'),
  matchReplay: (matchId: string) => get<MatchReplayResponse>(`/match/${encodeURIComponent(matchId)}/replay`),

  /* leaderboard */
  leaderboard: () => get<LeaderboardResponse>('/leaderboard'),
};

export type Api = typeof api;
