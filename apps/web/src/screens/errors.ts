/**
 * One place that turns an `ApiFailure` into a line the player can read.
 *
 * The prototype had nothing like this: every meta action was a local mutation that could
 * not fail (B4 — `Store` swallowed errors and pretended they had succeeded). Now that gold,
 * chests and trophies come back over the wire, a failure has to be visible or the player
 * will tap OPEN five times and wonder where their chest went.
 *
 * **The server's `message` is never shown.** `apps/server/src/lib/errors.ts` states it
 * outright: `message` is "for humans reading logs and dev consoles". In practice it carries
 * strings like `no session cookie`, `no pending chest at that slot`,
 * `cannot upgrade: unowned, maxed, or insufficient cards/gold` and raw zod issue lists — all
 * English-only developer register, some of them describing internals the player has no
 * business seeing. We branch on the machine-readable `error` code instead and fall back to
 * the caller's own domain copy.
 */
import { API_ERRORS } from '@crown/shared';
import { ApiFailure } from '../api/client';
import { STR } from './strings';

/** Codes with copy of their own. Anything else falls through to the caller's `fallback`. */
const BY_CODE: Record<string, string> = {
  [API_ERRORS.unauthorized]: STR.err.sessionExpired,
  [API_ERRORS.rateLimited]: STR.err.tooFast,
  [API_ERRORS.notEnoughCurrency]: STR.err.notEnough,
  [API_ERRORS.nothingToClaim]: STR.err.nothingToClaim,
  [API_ERRORS.walletTaken]: STR.err.walletTaken,
  [API_ERRORS.badSignature]: STR.err.badSignature,
};

export function apiMessage(err: unknown, fallback: string = STR.err.generic): string {
  if (err instanceof ApiFailure) {
    if (err.isOffline) return STR.err.offline;
    // `isUnauthorized`/`isRateLimited` also match on status alone, so they run before the
    // code table catches the cases where the body was not JSON and `code` is 'unknown'.
    if (err.isUnauthorized) return STR.err.sessionExpired;
    if (err.isRateLimited) return STR.err.tooFast;
    const known = BY_CODE[err.code];
    if (known) return known;
    if (err.status >= 500) return STR.err.serverDown;
    return fallback;
  }
  return fallback;
}
