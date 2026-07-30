/**
 * Accounts and wallet identity (handoff §3.3).
 *
 * ## One row per human
 *
 * A guest account and a wallet account are the *same* `User`. Linking mutates the row; it
 * never forks a second one. That is what makes the acceptance path work:
 *
 *   play as guest → link wallet → clear cookies → new device id → fresh guest row →
 *   sign the wallet challenge → **the session switches to the original row, save intact**
 *
 * The last step is the subtle one. The brief says a wallet already bound to a different user
 * must return `walletTaken` — and it does, whenever the caller has something to lose. But a
 * browser that just cleared its cookies arrives with a brand-new empty account, and a valid
 * signature over a fresh server-issued nonce is *proof of ownership of that wallet*. Refusing
 * it there would strand the player forever. So:
 *
 *   - session's save has progress  → `walletTaken` (we will not silently discard it)
 *   - session's save is untouched  → adopt the wallet's account and re-issue the cookie
 *   - no session at all            → sign in as the wallet's account
 *
 * The empty guest row left behind is orphaned, not deleted: a signature should never be able
 * to destroy a row, and an unreferenced default save costs a few hundred bytes.
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  API_ERRORS, defaultState,
  type AuthResponse, type RecoveryCreateResponse, type WalletLinkResponse, type WalletNonceResponse,
} from '@crown/shared';
import { clearSession, issueSession, requireUser } from '../lib/auth.js';
import { HttpError, badRequest, unauthorized } from '../lib/errors.js';
import { LIMITS, limit } from '../lib/ratelimit.js';
import { hasProgress, loadSave, mutateSave, repairSave } from '../lib/saves.js';
import { WalletConflictError, isReservedDeviceId, type Store, type UserRow } from '../lib/store.js';
import { buildChallenge, extractNonce, normalizeAddress, verifyWalletSignature, type WalletKind } from '../lib/wallet.js';
import { generateCode, hashCode, looksLikeCode } from '../lib/recovery.js';
import { env } from '../lib/env.js';

/** +100 gems, once per account, server-side (handoff §3.3). */
export const WALLET_BONUS_GEMS = 100;

/**
 * Any endpoint that accepts a device id has to refuse the namespaces the server writes for
 * itself — `wallet:` and `orphan:`, both defined and explained in `lib/store.ts`. Device ids
 * are bearer credentials here, so a reachable synthetic id is a reachable account.
 */
const deviceIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .refine((v) => !isReservedDeviceId(v), { message: 'deviceId uses a reserved namespace' });

const guestSchema = z.object({ deviceId: deviceIdSchema });

/**
 * Redemption moves the account onto the calling device, so it takes a device id and is held
 * to exactly the same namespace rules as `/auth/guest` — otherwise this endpoint would be a
 * way to park an account on an id that endpoint refuses to serve.
 */
/**
 * The single rejection message. Malformed and simply-wrong codes are answered identically,
 * down to the detail string, so nothing about the response can be used to tell which codes
 * exist or how close a guess was.
 */
const RECOVERY_REJECT = 'that code does not match an account';

const redeemSchema = z.object({
  // Bounded, but deliberately not length-checked here: `looksLikeCode` is the only shape gate,
  // so every bad code fails the same way with the same status. A schema rejection would give a
  // 400 where a wrong-but-well-formed code gives a 401, and that difference is an oracle.
  code: z.string().trim().min(1).max(64),
  deviceId: deviceIdSchema,
});

/**
 * Device id for an account created by a wallet signature on a browser that never had a guest
 * session.
 *
 * The address is HMAC'd rather than embedded. A wallet address is public by construction, so
 * deriving a login credential from it directly would mean the credential is public too — the
 * value has to be unguessable without the server secret even though it is deterministic, so
 * the unlink-then-relink path can still find the row.
 *
 * Rotating AUTH_SECRET orphans these synthetic ids. That is tolerable: the primary lookup is
 * `store.userByWallet`, and this derivation is only the fallback for an account whose
 * `User.wallet` was cleared by an unlink.
 */
function walletDeviceId(kind: WalletKind, wallet: string): string {
  const mac = createHmac('sha256', env.AUTH_SECRET).update(`${kind}:${wallet}`).digest('hex');
  return `wallet:${kind}:${mac}`;
}

const kindSchema = z.enum(['evm', 'solana']);

const nonceSchema = z.object({
  address: z.string().trim().min(20).max(64),
  kind: kindSchema,
});

const linkSchema = z.object({
  address: z.string().trim().min(20).max(64),
  kind: kindSchema,
  signature: z.string().trim().min(16).max(512),
  message: z.string().min(16).max(4096),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const res = schema.safeParse(body);
  if (!res.success) throw badRequest('bad_request', res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
  return res.data;
}

async function authBody(store: Store, user: UserRow, created: boolean): Promise<AuthResponse> {
  return {
    userId: user.id,
    wallet: user.wallet,
    walletKind: user.walletKind,
    airdropEligible: user.airdropEligible,
    save: await repairSave(store, user),
    created,
    hasRecovery: !!user.recoveryHash,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const store = app.store;

  app.post(
    '/api/auth/guest',
    { config: limit(LIMITS.authGuest) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { deviceId } = parse(guestSchema, req.body);
      let user = await store.userByDeviceId(deviceId);
      let created = false;
      if (!user) {
        try {
          user = await store.createUser({ deviceId, save: defaultState() });
          created = true;
        } catch (err) {
          // Two tabs racing the very first launch both miss the read and both insert. The
          // unique index picks a winner; the loser just reads the row that won.
          user = await store.userByDeviceId(deviceId);
          if (!user) throw err;
        }
      }
      await store.touchUser(user.id, new Date());
      await issueSession(reply, user.id);
      return authBody(store, user, created);
    },
  );

  app.get('/api/auth/me', { preHandler: requireUser, config: limit(LIMITS.read) }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await store.userById(req.userId!);
    if (!user) {
      // Valid signature over a user that no longer exists — stale cookie, not an attack.
      clearSession(reply);
      throw unauthorized('session refers to a deleted account');
    }
    return authBody(store, user, false);
  });

  /**
   * Issue or rotate this account's recovery code.
   *
   * The plaintext is returned exactly once and then exists only in whatever the player did
   * with it. Rotating is the same call: the new hash overwrites the old, which kills the
   * previous code — that is the only lever anyone has if they think a code has been seen.
   */
  app.post(
    '/api/auth/recovery',
    { preHandler: requireUser, config: limit(LIMITS.recoveryCreate) },
    async (req: FastifyRequest): Promise<RecoveryCreateResponse> => {
      const user = await store.userById(req.userId!);
      if (!user) throw unauthorized('session refers to a deleted account');
      const code = generateCode();
      const at = new Date();
      await store.setRecoveryHash(user.id, hashCode(env.AUTH_SECRET, code), at);
      return { code, issuedAt: at.toISOString(), replaced: !!user.recoveryHash };
    },
  );

  /**
   * Redeem a code: move the account onto this device and sign in.
   *
   * The rebind is the point. `boot()` signs in with the browser's device id on every launch,
   * so handing back only a cookie would strand the player again as soon as it expired — the
   * device id has to start resolving to the recovered account, which is what `adoptDevice`
   * does.
   *
   * The progress guard mirrors the wallet-adoption rule a few routes down, for the same
   * reason: proof of ownership is proof of ownership, but if the browser presenting it has an
   * account with real progress on it, recovering would quietly abandon that progress. Refuse
   * and let the player decide, rather than guess which of the two they meant to keep.
   */
  app.post(
    '/api/auth/recovery/redeem',
    { config: limit(LIMITS.recoveryRedeem) },
    async (req: FastifyRequest, reply: FastifyReply): Promise<AuthResponse> => {
      const { code, deviceId } = parse(redeemSchema, req.body);
      // Shape check before the lookup: a malformed code is not worth a database round trip,
      // and it keeps the rate limit budget for attempts that could actually be real.
      if (!looksLikeCode(code)) throw new HttpError(401, API_ERRORS.badRecoveryCode, RECOVERY_REJECT);

      const target = await store.userByRecoveryHash(hashCode(env.AUTH_SECRET, code));
      // Deliberately the same error and the same shape as a well-formed miss: nothing here
      // should let someone probe which codes exist.
      if (!target) throw new HttpError(401, API_ERRORS.badRecoveryCode, RECOVERY_REJECT);

      const caller = req.userId ? await store.userById(req.userId) : null;
      if (caller && caller.id !== target.id) {
        const { save } = await loadSave(store, caller);
        if (hasProgress(save)) {
          throw new HttpError(409, API_ERRORS.recoveryConflict, 'this browser already has an account with progress');
        }
      }

      const user = caller && caller.id === target.id ? target : await store.adoptDevice(target.id, deviceId);
      await store.touchUser(user.id, new Date());
      await issueSession(reply, user.id);
      return authBody(store, user, false);
    },
  );

  app.post('/api/auth/logout', async (_req: FastifyRequest, reply: FastifyReply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.post(
    '/api/auth/wallet/nonce',
    { config: limit(LIMITS.walletNonce) },
    async (req: FastifyRequest): Promise<WalletNonceResponse> => {
      const { address, kind } = parse(nonceSchema, req.body);
      let challenge;
      try {
        challenge = buildChallenge(kind, address);
      } catch (err) {
        throw badRequest('bad_address', (err as Error).message);
      }
      await store.createNonce({
        nonce: challenge.nonce,
        address: challenge.address,
        kind,
        message: challenge.message,
        expiresAt: challenge.expiresAt,
        usedAt: null,
      });
      return { nonce: challenge.nonce, message: challenge.message };
    },
  );

  app.post(
    '/api/auth/wallet/link',
    { config: limit(LIMITS.walletLink) },
    async (req: FastifyRequest, reply: FastifyReply): Promise<WalletLinkResponse> => {
      const body = parse(linkSchema, req.body);
      const kind = body.kind as WalletKind;
      const now = new Date();

      const nonce = extractNonce(body.message);
      if (!nonce) throw new HttpError(401, API_ERRORS.badSignature, 'message carries no nonce');

      // Single-use: this is a conditional write, so a replayed signature loses the race even
      // if it arrives in the same millisecond.
      const challenge = await store.consumeNonce(nonce, now);
      if (!challenge) throw new HttpError(401, API_ERRORS.badSignature, 'nonce unknown, expired or already used');

      let claimed: string;
      try {
        claimed = normalizeAddress(kind, body.address);
      } catch {
        throw new HttpError(401, API_ERRORS.badSignature, 'unparseable address');
      }
      // The challenge is bound to one address, one chain and one exact string. Anything the
      // client changed between issue and submit invalidates it.
      if (challenge.kind !== kind || challenge.address !== claimed || challenge.message !== body.message) {
        throw new HttpError(401, API_ERRORS.badSignature, 'challenge does not match submission');
      }

      const wallet = await verifyWalletSignature({
        kind,
        address: body.address,
        storedMessage: challenge.message,
        nonce,
        signature: body.signature,
        now,
      });
      if (!wallet) {
        req.log.warn({ kind, address: claimed }, 'wallet signature rejected');
        throw new HttpError(401, API_ERRORS.badSignature, 'signature does not match address');
      }

      const owner = await store.userByWallet(wallet);
      let user = req.userId ? await store.userById(req.userId) : null;

      if (owner && (!user || owner.id !== user.id)) {
        if (user) {
          const { save } = await loadSave(store, user);
          if (hasProgress(save)) {
            throw new HttpError(
              409,
              API_ERRORS.walletTaken,
              'this wallet belongs to another account and the current one has progress that would be lost',
            );
          }
        }
        // Sign-in: the signature proves the wallet, the wallet names the account.
        req.log.info({ from: user?.id ?? null, to: owner.id }, 'wallet sign-in adopted existing account');
        user = owner;
      }

      if (!user) {
        // Wallet-first: no cookie ever existed on this browser. The synthetic device id keeps
        // `deviceId` NOT NULL without pretending a device we never saw.
        //
        // Reused rather than blindly created, because unlinking clears `User.wallet` but not
        // `deviceId`: a wallet-first player who unlinks and later signs in again from a clean
        // browser is no longer findable by wallet, and creating a second row would both
        // collide on the unique index and strand their save.
        const deviceId = walletDeviceId(kind, wallet);
        user = (await store.userByDeviceId(deviceId)) ?? (await store.createUser({ deviceId, save: defaultState() }));
      }

      if (user.wallet !== wallet || !user.airdropEligible) {
        try {
          user = await store.setWallet(user.id, { wallet, walletKind: kind, airdropEligible: true });
        } catch (err) {
          if (err instanceof WalletConflictError) {
            throw new HttpError(409, API_ERRORS.walletTaken, 'wallet linked to another account');
          }
          throw err;
        }
      }

      await issueSession(reply, user.id);

      // Compare-and-set. `walletBonus` is the *only* thing standing between this endpoint and
      // paying 100 gems twice, and it lives inside the save document — so an unguarded
      // read-modify-write here could have the flag reset by any other write that was read
      // before the link and landed after it, at which point an unlink/relink pays again.
      // Re-running the closure on a retry re-reads the flag, which is exactly the check we want.
      const linked = await mutateSave(store, user, (save) => {
        let granted = false;
        // Guarded on the save, not on the user row: unlink → relink must not pay twice.
        if (!save.walletBonus) {
          save.gem += WALLET_BONUS_GEMS;
          save.walletBonus = true;
          granted = true;
        }
        save.wallet = user.wallet;
        save.walletKind = user.walletKind;
        return granted;
      });
      const bonusGranted = linked.result;
      const persisted = linked.save;

      return {
        wallet: user.wallet!,
        walletKind: user.walletKind!,
        airdropEligible: user.airdropEligible,
        bonusGranted,
        save: persisted,
      };
    },
  );

  app.post(
    '/api/auth/wallet/unlink',
    { preHandler: requireUser, config: limit(LIMITS.walletLink) },
    async (req: FastifyRequest) => {
      const user = await store.userById(req.userId!);
      if (!user) throw unauthorized('session refers to a deleted account');
      // Airdrop eligibility goes with the wallet — there is no address left to pay. The
      // `walletBonus` flag on the save deliberately does NOT reset, so relinking pays nothing.
      const updated = await store.setWallet(user.id, { wallet: null, walletKind: null, airdropEligible: false });
      // The wallet has already been cleared on the `User` row, which is the fact; this write
      // only re-stamps the save's display copy, so `repairSave` is enough.
      const persisted = await repairSave(store, updated);
      return { wallet: null, walletKind: null, airdropEligible: false, save: persisted };
    },
  );
}
