/**
 * Rate limits (handoff §5).
 *
 * Keyed per **user**, not per IP: a phone on carrier NAT shares an address with thousands of
 * strangers, and the limits below are tight enough that IP keying would lock legitimate
 * players out. Anonymous requests fall back to the IP because there is nothing else.
 *
 * The three numbers §5 names verbatim — match start 1/10s, chest open 1/2s, save write 1/5s —
 * are here unchanged. The rest exist because an endpoint with no limit is an endpoint someone
 * will find: `/auth/wallet/*` gates signature verification (CPU) and account takeover attempts,
 * and `/match/finish` gates the re-simulation, which is by far the most expensive thing the
 * API does.
 */
export interface RouteLimit {
  max: number;
  timeWindow: string | number;
}

export const LIMITS = {
  /** §5 verbatim. A match lasts 3 minutes; one start per 10 s is already 18× generous. */
  matchStart: { max: 1, timeWindow: '10 seconds' },
  /** Each finish costs a full headless re-sim (~10-25 ms of CPU). */
  matchFinish: { max: 6, timeWindow: '1 minute' },
  /** §5 verbatim. */
  chestOpen: { max: 1, timeWindow: '2 seconds' },
  /** §5 verbatim. Applies to every save-mutating write. */
  saveWrite: { max: 1, timeWindow: '5 seconds' },
  /** Shop, quests, login and upgrades all mutate currency; same budget as a chest. */
  economy: { max: 1, timeWindow: '2 seconds' },
  /** Account creation. Keyed by IP since there is no session yet. */
  authGuest: { max: 10, timeWindow: '1 minute' },
  /** Nonce issuance is cheap but unauthenticated — cap it hard. */
  walletNonce: { max: 5, timeWindow: '1 minute' },
  /** Signature verification is expensive and is the account-takeover surface. */
  walletLink: { max: 5, timeWindow: '5 minutes' },
  /** Plain reads. */
  read: { max: 60, timeWindow: '1 minute' },
  /**
   * Telemetry. Generous because the client batches and flushes on tab-hide, so a player
   * switching apps repeatedly is normal traffic — but bounded, because this endpoint writes
   * to the log pipeline and is the cheapest thing on the server to abuse.
   */
  telemetry: { max: 30, timeWindow: '1 minute' },
} as const satisfies Record<string, RouteLimit>;

/** Route `config` block. Ignored harmlessly when the plugin is not registered. */
export const limit = (l: RouteLimit): { rateLimit: RouteLimit } => ({ rateLimit: l });
