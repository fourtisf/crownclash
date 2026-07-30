/**
 * Save read / migrate / profile.
 *
 * The server owns the save (handoff §3.3): there is deliberately no general
 * "POST the whole save" endpoint. Currency, trophies, cards and chests change only as a
 * *consequence* of a validated action — a finished match, an opened chest, a claimed quest —
 * which is why the only writable fields here are cosmetic plus the deck.
 *
 * `/api/save/migrate` is the one exception, and it is fenced three ways: once per account,
 * only onto an account with no progress, and everything it accepts goes through
 * `sanitizeSave()` first with the clamps recorded on the row (§5).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sanitizeSave, type SaveResponse } from '@crown/shared';
import { requireUser } from '../lib/auth.js';
import { SERVER_ERRORS, badRequest, conflict, unauthorized } from '../lib/errors.js';
import { LIMITS, limit } from '../lib/ratelimit.js';
import {
  PROFILE_AVATARS, ensurePlayableDeck, hasProgress, loadSave, mutateSave, persistSave, repairSave, validateDeck,
} from '../lib/saves.js';
import type { Store, UserRow } from '../lib/store.js';

const migrateSchema = z.object({ save: z.unknown() });

const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(16).optional(),
    avatar: z.string().min(1).max(8).optional(),
    sfx: z.boolean().optional(),
    music: z.boolean().optional(),
    deck: z.array(z.string()).length(8).optional(),
    seen: z.boolean().optional(),
    tutorialDone: z.boolean().optional(),
    quality: z.enum(['low', 'med', 'high']).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.avatar !== undefined ||
      v.sfx !== undefined ||
      v.music !== undefined ||
      v.deck !== undefined ||
      v.seen !== undefined ||
      v.tutorialDone !== undefined ||
      v.quality !== undefined,
    { message: 'no fields to update' },
  );

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const res = schema.safeParse(body);
  if (!res.success) throw badRequest(SERVER_ERRORS.badRequest, res.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
  return res.data;
}

async function requireUserRow(store: Store, req: FastifyRequest): Promise<UserRow> {
  const user = await store.userById(req.userId!);
  if (!user) throw unauthorized('session refers to a deleted account');
  return user;
}

export async function saveRoutes(app: FastifyInstance): Promise<void> {
  const store = app.store;

  app.get('/api/save', { preHandler: requireUser, config: limit(LIMITS.read) }, async (req): Promise<SaveResponse> => {
    const user = await requireUserRow(store, req);
    return { save: await repairSave(store, user) };
  });

  app.post(
    '/api/save/migrate',
    { preHandler: requireUser, config: limit(LIMITS.saveWrite) },
    async (req): Promise<SaveResponse> => {
      const body = parse(migrateSchema, req.body);
      const user = await requireUserRow(store, req);

      const row = await store.getSave(user.id);
      if (row?.migrated) {
        throw conflict(SERVER_ERRORS.alreadyMigrated, 'this account has already imported a local save');
      }

      const { save: current, version } = await loadSave(store, user);
      if (hasProgress(current)) {
        // Importing over real progress is indistinguishable from overwriting it, and the
        // client only ever calls this on first login. Anything else is a bug or an attack.
        throw conflict(SERVER_ERRORS.migrationRefused, 'account already has progress; import refused');
      }

      const { save, flags } = sanitizeSave(body.save);

      // Identity and the one-time bonus are server-owned. A local save claiming
      // `walletBonus: true` would only cheat itself, but a save claiming a wallet would be an
      // account-takeover primitive, so both come from the current row rather than the payload.
      save.wallet = user.wallet;
      save.walletKind = user.walletKind;
      save.walletBonus = current.walletBonus;
      // Keep the quests the server already rolled for today rather than importing stale ones.
      save.quests = current.quests;
      // A save whose card list was mostly junk survives sanitising with a deck of one or two
      // cards. Repair it here rather than handing the client an unplayable account.
      ensurePlayableDeck(save);

      if (flags.length) req.log.warn({ userId: user.id, flags }, 'save migration clamped values');
      // Compare-and-set rather than a retry: this endpoint *replaces* the save, so re-running
      // it against a document somebody else just wrote would discard whatever they wrote. Two
      // simultaneous migrations therefore end as one import and one 409, which is also what
      // closes the read-then-check gap on `migrated` above.
      const persisted = await persistSave(store, user.id, save, {
        migrated: true,
        sanitizeFlags: flags,
        expectedVersion: version,
      });
      return { save: persisted, flags: flags.length ? flags : undefined };
    },
  );

  app.post(
    '/api/save/profile',
    { preHandler: requireUser, config: limit(LIMITS.saveWrite) },
    async (req): Promise<SaveResponse> => {
      const body = parse(profileSchema, req.body);
      const user = await requireUserRow(store, req);

      // Compare-and-set like every other writer. This is the write the client fires most often
      // — the deck editor saves on each card swap — so an unguarded one here is the most likely
      // thing to land on top of a match payout and erase it.
      const { save: persisted } = await mutateSave(store, user, (save) => {
        if (body.name !== undefined) {
          // Strip control characters: the client renders names into innerHTML-built markup.
          const name = body.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
          if (!name) throw badRequest(SERVER_ERRORS.invalidProfile, 'name is empty after sanitising');
          save.name = name;
        }
        if (body.avatar !== undefined) {
          // The profile modal offers exactly ten emoji (L2928); anything else is a crafted request.
          if (PROFILE_AVATARS.indexOf(body.avatar) < 0) throw badRequest(SERVER_ERRORS.invalidProfile, 'unknown avatar');
          save.avatar = body.avatar;
        }
        if (body.sfx !== undefined) save.sfx = body.sfx;
        if (body.music !== undefined) save.music = body.music;
        // One-way: the first-run explainer can be dismissed but not un-dismissed, so a stale
        // client cannot make it reappear for someone who has already played.
        if (body.seen === true) save.seen = true;
      // Also one-way, for the same reason: a stale client must not be able to make a player
      // who has already played sit through the coach marks again.
      if (body.tutorialDone === true) save.tutorialDone = true;
      if (body.quality !== undefined) save.quality = body.quality;
        if (body.deck !== undefined) {
          // Re-validated on every attempt: a retry runs against a freshly-read save, and a deck
          // is only legal relative to the cards that save owns.
          const deck = validateDeck(save, body.deck);
          if (!deck) throw badRequest(SERVER_ERRORS.invalidDeck, 'deck must be 8 distinct owned cards');
          save.deck = deck;
        }
      });
      return { save: persisted };
    },
  );
}
