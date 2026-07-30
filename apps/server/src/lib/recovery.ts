/**
 * Recovery codes.
 *
 * The code is the credential, so the two properties that matter are that it cannot be guessed
 * and that it cannot be read back out of the database.
 *
 * **Unguessable.** Twenty Crockford base32 characters is 100 bits from `crypto.randomBytes`.
 * At the redemption rate limit (`LIMITS.recovery`) an attacker gets a handful of tries a
 * minute against a 2^100 space, so no amount of patience helps and there is nothing to gain
 * from a slow hash — the entropy is in the secret, not in the KDF. Plain HMAC-SHA256 keyed on
 * `AUTH_SECRET` is the right primitive here, and it is fast enough that redemption stays a
 * single indexed lookup.
 *
 * **Unreadable.** Only the HMAC is stored. A dump of the `User` table hands an attacker
 * nothing they can present at the door, and support genuinely cannot recover a lost code —
 * which is worth saying out loud in the UI, because it is a feature and it reads like a bug.
 *
 * Crockford base32 rather than hex or base64: it drops the four characters people confuse
 * (I, L, O, U) and decodes the ones they still type by mistake, so a code copied off paper in
 * bad handwriting round-trips instead of failing for no visible reason.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Crockford's alphabet: 0-9 A-Z minus I, L, O and U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP = 5;
const GROUPS = 4;
/** 20 characters × 5 bits. */
export const CODE_CHARS = GROUP * GROUPS;

/**
 * Canonical form for anything the player typed.
 *
 * Case is folded, separators and spaces are dropped, and Crockford's substitutions are
 * applied — `I` and `L` read as `1`, `O` reads as `0`. Someone reading a code aloud to
 * someone else is the expected recovery path, so the decoder has to be forgiving of exactly
 * the mistakes that produces.
 */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]/g, '');
}

/** Groups of five, hyphen-separated: `4T9KP-2M7XW-...`. Purely for reading and copying. */
export function formatCode(raw: string): string {
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += GROUP) groups.push(raw.slice(i, i + GROUP));
  return groups.join('-');
}

/**
 * A fresh code, formatted for display.
 *
 * Rejection sampling rather than `% 32` on a byte: 256 is a multiple of 32, so a plain modulo
 * would in fact be uniform here — but that is a property of this specific alphabet length,
 * and a future edit to `ALPHABET` would silently bias the generator. Masking the low five
 * bits is uniform for any power-of-two alphabet and does not depend on remembering why.
 */
export function generateCode(): string {
  const bytes = randomBytes(CODE_CHARS);
  let raw = '';
  for (let i = 0; i < CODE_CHARS; i++) raw += ALPHABET[bytes[i] & 31];
  return formatCode(raw);
}

/** True when `input` could be a code at all. Cheap reject before touching the database. */
export function looksLikeCode(input: string): boolean {
  const raw = normalizeCode(input);
  if (raw.length !== CODE_CHARS) return false;
  for (const ch of raw) if (!ALPHABET.includes(ch)) return false;
  return true;
}

/** Keyed hash of the canonical form. Rotating `AUTH_SECRET` invalidates every code. */
export function hashCode(secret: string, input: string): string {
  return createHmac('sha256', secret).update(normalizeCode(input)).digest('hex');
}

/**
 * Constant-time comparison of two hashes.
 *
 * The database lookup is by unique index and therefore not constant-time, so this is not the
 * whole story — but it costs nothing and keeps the final comparison from being the easy half
 * of a timing attack.
 */
export function hashEquals(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}
