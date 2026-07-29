/**
 * Sessions.
 *
 * A session is a signed JWT in an httpOnly cookie — the client never sees a token it could
 * leak, and `SameSite=Lax` plus a credentialed CORS allow-list is what keeps a third-party
 * page from spending someone's gems. There is no refresh dance: the game has no privileged
 * operations beyond the save itself, so a single 30-day cookie re-issued on every guest login
 * is the right amount of machinery.
 *
 * The cookie carries only `sub` (the user id). Everything else — wallet, save, trophies — is
 * read from Postgres per request, because a token that asserts state is a token that can be
 * stale in exactly the direction an attacker wants.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { env, isProd } from './env.js';
import { unauthorized } from './errors.js';

const secret = new TextEncoder().encode(env.AUTH_SECRET);
const ISSUER = 'crown-clash';
const AUDIENCE = 'crown-clash-client';

const maxAgeSeconds = env.SESSION_TTL_DAYS * 24 * 3600;

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.SESSION_TTL_DAYS}d`)
    .sign(secret);
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function issueSession(reply: FastifyReply, userId: string): Promise<void> {
  const token = await signSession(userId);
  reply.setCookie(env.COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Secure would make the cookie undeliverable over plain http on a dev machine, so it is
    // tied to NODE_ENV rather than hard-coded either way.
    secure: isProd,
    path: '/',
    domain: env.COOKIE_DOMAIN,
    maxAge: maxAgeSeconds,
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(env.COOKIE_NAME, { path: '/', domain: env.COOKIE_DOMAIN });
}

/**
 * Global `onRequest` hook. Resolves the cookie to a user id with no database round-trip so
 * that the rate limiter — which keys on `request.userId` and runs in its own `onRequest`
 * hook registered after this one — has an identity to work with on every request.
 */
export async function resolveSession(request: FastifyRequest): Promise<void> {
  const raw = request.cookies?.[env.COOKIE_NAME];
  request.userId = raw ? await verifySession(raw) : null;
}

/** Route `preHandler`. Throws `unauthorized`, which the app's error handler renders. */
export async function requireUser(request: FastifyRequest): Promise<void> {
  if (!request.userId) throw unauthorized('no session cookie');
}
