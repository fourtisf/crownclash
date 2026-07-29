/**
 * One place that turns an `ApiFailure` into a line the player can read.
 *
 * The prototype had nothing like this: every meta action was a local mutation that could
 * not fail (B4 — `Store` swallowed errors and pretended they had succeeded). Now that gold,
 * chests and trophies come back over the wire, a failure has to be visible or the player
 * will tap OPEN five times and wonder where their chest went.
 */
import { ApiFailure } from '../api/client';
import { STR } from './strings';

export function apiMessage(err: unknown, fallback: string = STR.err.generic): string {
  if (err instanceof ApiFailure) {
    if (err.isOffline) return STR.err.offline;
    if (err.isRateLimited) return STR.err.tooFast;
    // The server's `message` is written for humans; fall back when it only sent a code.
    return err.message || fallback;
  }
  return fallback;
}
