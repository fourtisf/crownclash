/**
 * Chests, shop, quests, login streak, upgrades.
 *
 * The rule being defended throughout: currency and card counts move only as a consequence of
 * an action the server priced itself (handoff §5, §7 — "No client-trusted results, currency,
 * or chest rolls"). Every test therefore reads the *returned* save rather than trusting any
 * value the request carried.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  API_ERRORS, CHESTS, FREE_CHEST_MS, LOGIN_REWARDS, RARITY, SHOP,
  type ChestOpenResponse, type LoginClaimResponse, type QuestClaimResponse, type SaveResponse,
  type SaveState, type ShopBuyResponse, type UpgradeCardResponse,
} from '@crown/shared';
import { Agent, guest, json, makeRig, type TestRig } from './helpers.js';

let rig: TestRig;
let agent: Agent;

beforeEach(async () => {
  rig = await makeRig();
  agent = await guest(rig.app, 'device-econ-00001');
});

afterEach(async () => {
  await rig.close();
});

const uid = async (): Promise<string> => (await rig.store.userByDeviceId('device-econ-00001'))!.id;

/** Writes straight to the store — the API has no endpoint that would let a client do this. */
async function patchSave(patch: Partial<SaveState>): Promise<void> {
  const id = await uid();
  const cur = (await rig.store.getSave(id))!.json;
  await rig.store.putSave(id, { ...cur, ...patch });
}

const cardTotal = (s: SaveState): number => Object.values(s.cards).reduce((n, c) => n + c.cnt, 0);

describe('POST /api/chest/open', () => {
  it('opens a queued win chest, grants its contents, and removes it from the queue', async () => {
    await patchSave({ pendingChests: ['golden', 'wooden'] });
    const before = json<SaveResponse>(await agent.get('/api/save')).save;

    const res = await agent.post('/api/chest/open', { source: 'pending', index: 0 });
    expect(res.statusCode).toBe(200);
    const body = json<ChestOpenResponse>(res);

    expect(body.kind).toBe('golden');
    expect(body.save.pendingChests).toEqual(['wooden']);
    // Contents are within the published range for that chest, and actually applied.
    expect(body.result.gold).toBeGreaterThanOrEqual(CHESTS.golden.gold[0]);
    expect(body.result.gold).toBeLessThanOrEqual(CHESTS.golden.gold[1]);
    expect(body.save.gold).toBe(before.gold + body.result.gold);
    expect(body.save.gem).toBe(before.gem + body.result.gem);
    expect(cardTotal(body.save)).toBe(cardTotal(before) + CHESTS.golden.cards);
    // Golden guarantees at least one rare.
    expect(body.result.cards.some((c) => c.rar === 'rare')).toBe(true);
    expect(body.save.stats.chests).toBe(before.stats.chests + 1);
  });

  it('rejects a slot the player does not have', async () => {
    const res = await agent.post('/api/chest/open', { source: 'pending', index: 3 });
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe(API_ERRORS.nothingToClaim);
  });

  it('gates the free chest on the 3-hour timer and re-arms it', async () => {
    const first = await agent.post('/api/chest/open', { source: 'free' });
    expect(first.statusCode).toBe(200);
    const body = json<ChestOpenResponse>(first);
    expect(body.kind).toBe('wooden');
    expect(body.save.freeChestAt).toBeGreaterThan(Date.now() + FREE_CHEST_MS - 5_000);

    const second = await agent.post('/api/chest/open', { source: 'free' });
    expect(second.statusCode).toBe(409);
    const err = json<{ error: string; retryAfter?: number }>(second);
    expect(err.error).toBe(API_ERRORS.nothingToClaim);
    expect(err.retryAfter).toBeGreaterThan(0);
  });

  it('refuses shop and login sources — those chests are minted by their own endpoints', async () => {
    for (const source of ['shop', 'login'] as const) {
      const res = await agent.post('/api/chest/open', { source, kind: 'legend' });
      expect(res.statusCode).toBe(400);
      expect(json<{ error: string }>(res).error).toBe('unsupported_chest_source');
    }
    // Nothing was granted.
    expect(json<SaveResponse>(await agent.get('/api/save')).save.gold).toBe(1200);
  });

  it('ignores a client-supplied chest kind on a pending open', async () => {
    await patchSave({ pendingChests: ['wooden'] });
    const body = json<ChestOpenResponse>(
      await agent.post('/api/chest/open', { source: 'pending', index: 0, kind: 'legend' }),
    );
    expect(body.kind).toBe('wooden');
  });
});

describe('POST /api/shop/buy', () => {
  it('sells a chest, debiting first and crediting the roll after', async () => {
    const before = json<SaveResponse>(await agent.get('/api/save')).save;
    const entry = SHOP[0]; // wooden, 200 gold

    const body = json<ShopBuyResponse>(await agent.post('/api/shop/buy', { index: 0 }));
    expect(body.chest?.kind).toBe('wooden');
    expect(body.save.gold).toBe(before.gold - entry.price + body.chest!.result.gold);
    expect(cardTotal(body.save)).toBe(cardTotal(before) + CHESTS.wooden.cards);
  });

  it('sells the gold pack for gems', async () => {
    const before = json<SaveResponse>(await agent.get('/api/save')).save;
    const i = SHOP.findIndex((e) => e.kind === 'gold');
    const entry = SHOP[i];

    const body = json<ShopBuyResponse>(await agent.post('/api/shop/buy', { index: i }));
    expect(body.gold).toBe(entry.gold);
    expect(body.save.gem).toBe(before.gem - entry.price);
    expect(body.save.gold).toBe(before.gold + entry.gold!);
    expect(body.chest).toBeUndefined();
  });

  it('refuses a purchase the player cannot afford and changes nothing', async () => {
    const i = SHOP.findIndex((e) => e.kind === 'legend'); // 900 gems, new account has 120
    const res = await agent.post('/api/shop/buy', { index: i });
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe(API_ERRORS.notEnoughCurrency);
    expect(json<SaveResponse>(await agent.get('/api/save')).save.gem).toBe(120);
  });
});

describe('POST /api/quest/claim', () => {
  it('pays a completed quest exactly once', async () => {
    const s = json<SaveResponse>(await agent.get('/api/save')).save;
    const quests = { ...s.quests, list: s.quests.list.map((q, i) => (i === 1 ? { ...q, prog: q.goal } : q)) };
    await patchSave({ quests });
    const reward = quests.list[1].rw;

    const res = await agent.post('/api/quest/claim', { index: 1 });
    expect(res.statusCode).toBe(200);
    const body = json<QuestClaimResponse>(res);
    expect(body.gold).toBe(reward.gold);
    expect(body.save.gold).toBe(s.gold + reward.gold);
    expect(body.save.gem).toBe(s.gem + reward.gem);

    const again = await agent.post('/api/quest/claim', { index: 1 });
    expect(again.statusCode).toBe(409);
    expect(json<SaveResponse>(await agent.get('/api/save')).save.gold).toBe(body.save.gold);
  });

  it('refuses an incomplete quest', async () => {
    expect((await agent.post('/api/quest/claim', { index: 0 })).statusCode).toBe(409);
  });
});

describe('POST /api/login/claim', () => {
  it('pays day 1 and refuses a second claim the same day', async () => {
    const before = json<SaveResponse>(await agent.get('/api/save')).save;

    const body = json<LoginClaimResponse>(await agent.post('/api/login/claim'));
    expect(body.reward).toEqual(LOGIN_REWARDS[0]);
    expect(body.save.gold).toBe(before.gold + LOGIN_REWARDS[0].gold!);
    expect(body.save.login.day).toBe(1);
    expect(body.save.login.streak).toBe(1);

    expect((await agent.post('/api/login/claim')).statusCode).toBe(409);
  });

  it('rolls and grants the day-7 chest alongside its gems', async () => {
    await patchSave({ login: { day: 6, last: '', streak: 6 } });
    const before = json<SaveResponse>(await agent.get('/api/save')).save;

    const body = json<LoginClaimResponse>(await agent.post('/api/login/claim'));
    expect(body.reward.chest).toBe('golden');
    expect(body.chest?.kind).toBe('golden');
    // 150 gems from the reward plus whatever the chest rolled.
    expect(body.save.gem).toBe(before.gem + 150 + body.chest!.result.gem);
    expect(cardTotal(body.save)).toBe(cardTotal(before) + CHESTS.golden.cards);
    // The cycle wraps back to day 0.
    expect(body.save.login.day).toBe(0);
  });
});

describe('POST /api/cards/upgrade', () => {
  it('spends gold and duplicates to raise a card level', async () => {
    const need = RARITY.common.upCards[1];
    const cost = RARITY.common.upCost[1];
    const cur = json<SaveResponse>(await agent.get('/api/save')).save;
    await patchSave({ gold: cost + 10, cards: { ...cur.cards, ironclad: { lv: 1, cnt: need } } });

    const res = await agent.post('/api/cards/upgrade', { cardId: 'ironclad' });
    expect(res.statusCode).toBe(200);
    const body = json<UpgradeCardResponse>(res);
    expect(body.level).toBe(2);
    expect(body.cost).toBe(cost);
    expect(body.save.cards.ironclad.lv).toBe(2);
    expect(body.save.cards.ironclad.cnt).toBe(0);
    expect(body.save.gold).toBe(10);
  });

  it('refuses without enough duplicates and changes nothing', async () => {
    const res = await agent.post('/api/cards/upgrade', { cardId: 'ironclad' });
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe(API_ERRORS.notEnoughCurrency);
    expect(json<SaveResponse>(await agent.get('/api/save')).save.gold).toBe(1200);
  });

  it('refuses a card the player does not own', async () => {
    expect((await agent.post('/api/cards/upgrade', { cardId: 'stormtitan' })).statusCode).toBe(409);
  });
});

describe('GET /api/chest/rates', () => {
  it('publishes the drop table without a session (§7)', async () => {
    const body = json<{ rarity: Record<string, number>; chests: { key: string }[] }>(
      await new Agent(rig.app).get('/api/chest/rates'),
    );
    expect(body.rarity.common).toBe(0.755);
    expect(body.rarity.legendary).toBe(0.005);
    expect(body.chests).toHaveLength(5);
  });
});

describe('everything economic requires a session', () => {
  it('401s an anonymous caller on every mutating endpoint', async () => {
    const anon = new Agent(rig.app);
    const calls: [string, unknown][] = [
      ['/api/chest/open', { source: 'free' }],
      ['/api/shop/buy', { index: 0 }],
      ['/api/quest/claim', { index: 0 }],
      ['/api/login/claim', {}],
      ['/api/cards/upgrade', { cardId: 'ironclad' }],
    ];
    for (const [url, payload] of calls) {
      expect((await anon.post(url, payload)).statusCode).toBe(401);
    }
  });
});
