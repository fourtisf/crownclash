/**
 * Chests, shop, quests, login streak, card upgrades.
 *
 * Every roll happens here with a server-seeded `Rng` and every mutation runs through the
 * shared `economy.ts` functions the client also imports — so the numbers the player sees
 * pre-flight and the numbers the server commits come from one implementation (handoff §5:
 * "Server issues chest contents (seeded roll) — client only animates").
 *
 * ### Why `/api/chest/open` rejects `source: 'shop'` and `'login'`
 *
 * `ChestOpenRequest` carries all four sources because the client's *animation* layer is one
 * component: whatever produced a chest, the same tap-to-open screen plays it. But a shop
 * chest is created by `/api/shop/buy` (which debits first) and a login chest by
 * `/api/login/claim` (which advances the 7-day cycle first). Honouring those sources here as
 * well would be a second, unpriced way to mint the same chest. So they are refused, and the
 * two purchase endpoints return the rolled contents inline for the animation to consume.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  API_ERRORS, CHESTS, FREE_CHEST_MS, SHOP, claimLogin, claimQuest, grantChest, rollChest, upgradeCard,
  type ChestKey, type ChestOpenResponse, type LoginClaimResponse, type QuestClaimResponse,
  type ShopBuyResponse, type UpgradeCardResponse,
} from '@crown/shared';
import { requireUser } from '../lib/auth.js';
import { HttpError, SERVER_ERRORS, badRequest, unauthorized } from '../lib/errors.js';
import { LIMITS, limit } from '../lib/ratelimit.js';
import { mutateSave, serverRng } from '../lib/saves.js';
import type { Store, UserRow } from '../lib/store.js';

const chestSchema = z.object({
  source: z.enum(['pending', 'free', 'shop', 'login']),
  index: z.number().int().min(0).max(63).optional(),
  kind: z.enum(['wooden', 'silver', 'golden', 'magical', 'legend']).optional(),
});

const shopSchema = z.object({ index: z.number().int().min(0).max(SHOP.length - 1) });
const questSchema = z.object({ index: z.number().int().min(0).max(2) });
const upgradeSchema = z.object({ cardId: z.string().min(1).max(32) });

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

const nothingToClaim = (msg: string): HttpError => new HttpError(409, API_ERRORS.nothingToClaim, msg);
const notEnough = (msg: string): HttpError => new HttpError(409, API_ERRORS.notEnoughCurrency, msg);

export async function economyRoutes(app: FastifyInstance): Promise<void> {
  const store = app.store;

  app.post(
    '/api/chest/open',
    { preHandler: requireUser, config: limit(LIMITS.chestOpen) },
    async (req): Promise<ChestOpenResponse> => {
      const body = parse(chestSchema, req.body);
      const user = await requireUserRow(store, req);

      // The roll happens inside the mutation on purpose. A retry discards the losing attempt's
      // save wholesale, so its chest is discarded with it — what gets persisted and what gets
      // returned are always the same roll. Rolling outside the loop would be no more fair and
      // would pin the player to a roll made against a stale save.
      const { result: opened, save: persisted } = await mutateSave(store, user, (save) => {
      let kind: ChestKey;
      if (body.source === 'pending') {
        const i = body.index ?? -1;
        if (i < 0 || i >= save.pendingChests.length) throw nothingToClaim('no pending chest at that slot');
        // Splice *before* rolling: if anything below throws, the player keeps the chest.
        kind = save.pendingChests.splice(i, 1)[0];
      } else if (body.source === 'free') {
        const now = Date.now();
        if (now < save.freeChestAt) {
          throw new HttpError(
            409,
            API_ERRORS.nothingToClaim,
            'free chest not ready',
            Math.ceil((save.freeChestAt - now) / 1000),
          );
        }
        kind = 'wooden'; // L2559 — the 3-hour chest is always wooden.
        save.freeChestAt = now + FREE_CHEST_MS;
      } else {
        throw badRequest(
          SERVER_ERRORS.unsupportedChestSource,
          `chests from '${body.source}' are granted by their own endpoint`,
        );
      }

        const result = grantChest(save, rollChest(serverRng(), kind));
        return { kind, result };
      });
      req.log.info({ userId: user.id, source: body.source, kind: opened.kind }, 'chest opened');
      return { kind: opened.kind, result: opened.result, save: persisted };
    },
  );

  app.post(
    '/api/shop/buy',
    { preHandler: requireUser, config: limit(LIMITS.economy) },
    async (req): Promise<ShopBuyResponse> => {
      const { index } = parse(shopSchema, req.body);
      const user = await requireUserRow(store, req);
      const entry = SHOP[index];
      if (!entry) throw badRequest(SERVER_ERRORS.unknownShopItem, 'no such shop entry');

      const { result: bought, save: persisted } = await mutateSave(store, user, (save) => {
        const balance = entry.cur === 'gold' ? save.gold : save.gem;
        if (balance < entry.price) throw notEnough(`need ${entry.price} ${entry.cur}`);

        // L2705-2709 verbatim ordering: debit first, then credit. It matters for the gold packs
        // and for gold-priced chests, whose contents also pay gold.
        if (entry.cur === 'gold') save.gold -= entry.price;
        else save.gem -= entry.price;

        if (entry.kind === 'gold') {
          const gold = entry.gold ?? 0;
          save.gold += gold;
          return { gold, chest: undefined as ShopBuyResponse['chest'] };
        }

        const kind = entry.kind as ChestKey;
        return { gold: undefined, chest: { kind, result: grantChest(save, rollChest(serverRng(), kind)) } };
      });
      if (bought.chest) {
        req.log.info(
          { userId: user.id, kind: bought.chest.kind, price: entry.price, cur: entry.cur },
          'shop chest purchased',
        );
      }
      return { save: persisted, gold: bought.gold, chest: bought.chest };
    },
  );

  app.post(
    '/api/quest/claim',
    { preHandler: requireUser, config: limit(LIMITS.economy) },
    async (req): Promise<QuestClaimResponse> => {
      const { index } = parse(questSchema, req.body);
      const user = await requireUserRow(store, req);
      const { result: reward, save: persisted } = await mutateSave(store, user, (save) => {
        const r = claimQuest(save, index);
        if (!r) throw nothingToClaim('quest is not complete, already claimed, or does not exist');
        return r;
      });
      return { gold: reward.gold, gem: reward.gem, save: persisted };
    },
  );

  app.post(
    '/api/login/claim',
    { preHandler: requireUser, config: limit(LIMITS.economy) },
    async (req): Promise<LoginClaimResponse> => {
      const user = await requireUserRow(store, req);
      const { result: claimed, save: persisted } = await mutateSave(store, user, (save) => {
        const claim = claimLogin(save);
        if (!claim) throw nothingToClaim('today’s login reward has already been claimed');

        // Day 7 pays a Golden Chest *and* 150 gems; `claimLogin` applied the gems, the chest is
        // rolled and granted here so the client gets contents to animate in the same response.
        let chest: LoginClaimResponse['chest'];
        if (claim.chest) {
          const kind = claim.chest;
          chest = { kind, result: grantChest(save, rollChest(serverRng(), kind)) };
        }
        return { reward: claim.reward, chest };
      });
      return { reward: claimed.reward, chest: claimed.chest, save: persisted };
    },
  );

  app.post(
    '/api/cards/upgrade',
    { preHandler: requireUser, config: limit(LIMITS.economy) },
    async (req): Promise<UpgradeCardResponse> => {
      const { cardId } = parse(upgradeSchema, req.body);
      const user = await requireUserRow(store, req);
      const { result: up, save: persisted } = await mutateSave(store, user, (save) => {
        const r = upgradeCard(save, cardId);
        // `upgradeCard` folds "not owned", "max level", "not enough duplicates" and "not enough
        // gold" into one null. The client already greys the button out in all four cases.
        if (!r) throw notEnough('cannot upgrade: unowned, maxed, or insufficient cards/gold');
        return r;
      });
      return { level: up.level, cost: up.cost, save: persisted };
    },
  );

  /** Published drop rates (handoff §7 — they stay visible). Static, so it needs no auth. */
  app.get('/api/chest/rates', async () => ({
    rarity: { common: 0.755, rare: 0.2, epic: 0.04, legendary: 0.005 },
    chests: Object.entries(CHESTS).map(([key, c]) => ({
      key,
      name: c.n,
      cards: c.cards,
      gold: c.gold,
      gem: c.gem,
      guaranteed: c.guar,
    })),
  }));
}
