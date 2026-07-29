import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { AuthResponse, MatchStartResponse, MatchFinishResponse, SaveResponse } from '@crown/shared';
import { Agent, guest, json, makeRig, honestLog, type TestRig } from './helpers.js';

let rig: TestRig;
beforeEach(async () => {
  rig = await makeRig();
});
afterEach(async () => {
  await rig.close();
});

class SolanaWallet {
  readonly keypair = nacl.sign.keyPair();
  readonly address = bs58.encode(this.keypair.publicKey);
  sign(message: string): string {
    return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), this.keypair.secretKey));
  }
}

describe('PROBE: synthetic wallet deviceId', () => {
  it('cannot be used to log in as the wallet owner', async () => {
    const anon = new Agent(rig.app);
    const wallet = new SolanaWallet();
    const c = json<{ nonce: string; message: string }>(
      await anon.post('/api/auth/wallet/nonce', { address: wallet.address, kind: 'solana' }),
    );
    await anon.post('/api/auth/wallet/link', {
      address: wallet.address, kind: 'solana', signature: wallet.sign(c.message), message: c.message,
    });
    const victim = json<AuthResponse>(await anon.get('/api/auth/me'));
    // give them something worth stealing
    const cur = (await rig.store.getSave(victim.userId))!.json;
    await rig.store.putSave(victim.userId, { ...cur, trophies: 3000, gold: 40000 });

    // The attacker knows only the public wallet address.
    const attacker = new Agent(rig.app);
    const res = await attacker.post('/api/auth/guest', { deviceId: `wallet:solana:${wallet.address}` });
    // eslint-disable-next-line no-console
    console.log('TAKEOVER status', res.statusCode, res.body.slice(0, 200));
    if (res.statusCode === 200) {
      const body = json<AuthResponse>(res);
      console.log('TAKEOVER userId match:', body.userId === victim.userId, 'trophies', body.save.trophies);
    }
    expect(res.statusCode).not.toBe(200);
  });
});

describe('PROBE: log replay against a fresh match', () => {
  it('a winning log cannot be replayed into a second match', async () => {
    const agent = await guest(rig.app, 'device-probe-001');
    const s1 = json<MatchStartResponse>(await agent.post('/api/match/start'));
    const cfg = {
      seed: s1.seed, myDeck: s1.myDeck, myCardLevels: s1.myCardLevels, myKingLevel: s1.myKingLevel,
      aiDeckIndex: s1.aiDeckIndex, aiLevel: s1.aiLevel,
    };
    const log = honestLog(cfg);
    const f1 = json<MatchFinishResponse>(await agent.post('/api/match/finish', { matchId: s1.matchId, deployLog: log }));
    console.log('match1 result', f1.result, 'voided', JSON.stringify(f1.voided));

    const s2 = json<MatchStartResponse>(await agent.post('/api/match/start'));
    const f2 = json<MatchFinishResponse>(await agent.post('/api/match/finish', { matchId: s2.matchId, deployLog: log }));
    console.log('replayed into match2:', f2.result, 'voided', JSON.stringify(f2.voided), 'delta', f2.rewards.delta);
  });
});

describe('PROBE: concurrent save writes', () => {
  it('two concurrent economy writes do not lose one another', async () => {
    const agent = await guest(rig.app, 'device-probe-002');
    const user = (await rig.store.userByDeviceId('device-probe-002'))!;
    const s = (await rig.store.getSave(user.id))!.json;
    // Complete a quest so /quest/claim will pay, and give plenty of gold + a duplicate card.
    s.quests.list[0].prog = s.quests.list[0].goal;
    s.gold = 10000;
    s.cards[s.deck[0]] = { lv: 1, cnt: 100 };
    await rig.store.putSave(user.id, s);

    const before = (await rig.store.getSave(user.id))!.json;
    const [q, u] = await Promise.all([
      agent.post('/api/quest/claim', { index: 0 }),
      agent.post('/api/cards/upgrade', { cardId: before.deck[0] }),
    ]);
    console.log('quest', q.statusCode, 'upgrade', u.statusCode);
    const after = (await rig.store.getSave(user.id))!.json;
    console.log('quest claimed?', after.quests.list[0].claimed, 'card lv', after.cards[before.deck[0]].lv, 'gold', after.gold);
  });
});

describe('PROBE: profile name', () => {
  it('accepts markup in the display name', async () => {
    const agent = await guest(rig.app, 'device-probe-003');
    const res = await agent.post('/api/save/profile', { name: '<svg onload=a()>' });
    console.log('name status', res.statusCode, res.statusCode === 200 ? json<SaveResponse>(res).save.name : res.body);
  });
});

describe('PROBE: match finish crash path', () => {
  it('a match whose finish throws is left claimed but unrecorded', async () => {
    const agent = await guest(rig.app, 'device-probe-004');
    const s1 = json<MatchStartResponse>(await agent.post('/api/match/start'));
    const m = (await rig.store.getMatch(s1.matchId))!;
    console.log('match config deck len', m.config.myDeck.length, 'finishedAt', m.finishedAt);
  });
});
