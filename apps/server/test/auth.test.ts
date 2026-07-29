/**
 * Accounts and wallet identity.
 *
 * The headline case is handoff §9's acceptance criterion: *"link a wallet → get +100 gems once
 * → clear cookies → log back in via wallet with save intact."* That path is tested end to end
 * on both chains, together with the ways it must NOT work — replayed nonces, forged
 * signatures, a swapped message, and a wallet already owned by an account that has progress.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem';
import { API_ERRORS, type AuthResponse, type WalletLinkResponse, type WalletNonceResponse } from '@crown/shared';
import { WALLET_BONUS_GEMS } from '../src/routes/auth.js';
import { Agent, guest, json, makeRig, type TestRig } from './helpers.js';

let rig: TestRig;

beforeEach(async () => {
  rig = await makeRig();
});

afterEach(async () => {
  await rig.close();
});

/* ------------------------------------------------------------------ signers */

class SolanaWallet {
  readonly keypair = nacl.sign.keyPair();
  readonly address = bs58.encode(this.keypair.publicKey);

  sign(message: string): string {
    return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), this.keypair.secretKey));
  }
}

class EvmWallet {
  readonly account: PrivateKeyAccount;

  constructor(pk: `0x${string}`) {
    this.account = privateKeyToAccount(pk);
  }

  get address(): string {
    return this.account.address;
  }

  sign(message: string): Promise<string> {
    return this.account.signMessage({ message });
  }
}

const PK_A = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const PK_B = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as const;

async function challenge(agent: Agent, address: string, kind: 'evm' | 'solana'): Promise<WalletNonceResponse> {
  const res = await agent.post('/api/auth/wallet/nonce', { address, kind });
  expect(res.statusCode).toBe(200);
  return json<WalletNonceResponse>(res);
}

/* -------------------------------------------------------------------- guest */

describe('POST /api/auth/guest', () => {
  it('creates an account with the prototype’s starting state', async () => {
    const agent = new Agent(rig.app);
    const res = await agent.post('/api/auth/guest', { deviceId: 'device-aaaaaaaa' });
    expect(res.statusCode).toBe(200);
    const body = json<AuthResponse>(res);

    expect(body.created).toBe(true);
    expect(body.save.gold).toBe(1200);
    expect(body.save.gem).toBe(120);
    expect(Object.keys(body.save.cards)).toHaveLength(12);
    expect(body.save.deck).toHaveLength(8);
    // Quests are rolled server-side on the first load rather than left empty.
    expect(body.save.quests.list).toHaveLength(3);
    expect(agent.hasSession).toBe(true);
  });

  it('is idempotent for the same device and returns the same save', async () => {
    const first = json<AuthResponse>(
      await new Agent(rig.app).post('/api/auth/guest', { deviceId: 'device-bbbbbbbb' }),
    );
    const second = json<AuthResponse>(
      await new Agent(rig.app).post('/api/auth/guest', { deviceId: 'device-bbbbbbbb' }),
    );
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
  });

  it('rejects a too-short device id', async () => {
    expect((await new Agent(rig.app).post('/api/auth/guest', { deviceId: 'short' })).statusCode).toBe(400);
  });
});

describe('GET /api/auth/me and logout', () => {
  it('returns the session account, then stops after logout', async () => {
    const agent = await guest(rig.app, 'device-cccccccc');
    expect((await agent.get('/api/auth/me')).statusCode).toBe(200);
    await agent.post('/api/auth/logout');
    expect(agent.hasSession).toBe(false);
    expect((await agent.get('/api/auth/me')).statusCode).toBe(401);
  });
});

/* ------------------------------------------------------------ wallet linking */

describe('wallet link — Solana', () => {
  it('links, pays the one-time bonus, and keeps the existing save', async () => {
    const agent = await guest(rig.app, 'device-solana-01');
    const wallet = new SolanaWallet();

    // Give the account something to lose so "save intact" means something.
    const user = (await rig.store.userByDeviceId('device-solana-01'))!;
    const before = (await rig.store.getSave(user.id))!.json;
    await rig.store.putSave(user.id, { ...before, trophies: 640, gold: 4321, wins: 7 });

    const { message } = await challenge(agent, wallet.address, 'solana');
    const res = await agent.post('/api/auth/wallet/link', {
      address: wallet.address,
      kind: 'solana',
      signature: wallet.sign(message),
      message,
    });
    expect(res.statusCode).toBe(200);
    const body = json<WalletLinkResponse>(res);

    expect(body.wallet).toBe(wallet.address);
    expect(body.walletKind).toBe('solana');
    expect(body.airdropEligible).toBe(true);
    expect(body.bonusGranted).toBe(true);
    expect(body.save.gem).toBe(120 + WALLET_BONUS_GEMS);
    // The save is preserved, not replaced.
    expect(body.save.trophies).toBe(640);
    expect(body.save.gold).toBe(4321);
    expect(body.save.wins).toBe(7);
    expect(body.save.walletBonus).toBe(true);
  });

  it('pays the bonus exactly once, even across unlink and relink', async () => {
    const agent = await guest(rig.app, 'device-solana-02');
    const wallet = new SolanaWallet();

    const c1 = await challenge(agent, wallet.address, 'solana');
    const first = json<WalletLinkResponse>(
      await agent.post('/api/auth/wallet/link', {
        address: wallet.address, kind: 'solana', signature: wallet.sign(c1.message), message: c1.message,
      }),
    );
    expect(first.bonusGranted).toBe(true);
    const gemsAfterFirst = first.save.gem;

    await agent.post('/api/auth/wallet/unlink');

    const c2 = await challenge(agent, wallet.address, 'solana');
    const second = json<WalletLinkResponse>(
      await agent.post('/api/auth/wallet/link', {
        address: wallet.address, kind: 'solana', signature: wallet.sign(c2.message), message: c2.message,
      }),
    );
    expect(second.bonusGranted).toBe(false);
    expect(second.save.gem).toBe(gemsAfterFirst);
  });

  /** Handoff §9: "clear cookies → log back in via wallet with save intact". */
  it('signs a cleared-cookie browser back into the same account and save', async () => {
    const original = await guest(rig.app, 'device-solana-03');
    const wallet = new SolanaWallet();

    const user = (await rig.store.userByDeviceId('device-solana-03'))!;
    const seed = (await rig.store.getSave(user.id))!.json;
    await rig.store.putSave(user.id, { ...seed, trophies: 1234, best: 1300, gold: 9876, wins: 21, name: 'Rina' });

    const c1 = await challenge(original, wallet.address, 'solana');
    const linked = json<WalletLinkResponse>(
      await original.post('/api/auth/wallet/link', {
        address: wallet.address, kind: 'solana', signature: wallet.sign(c1.message), message: c1.message,
      }),
    );
    const gemsBefore = linked.save.gem;

    // --- the player clears cookies and site data. New browser, new device id, fresh account.
    const fresh = new Agent(rig.app);
    const guestBody = json<AuthResponse>(await fresh.post('/api/auth/guest', { deviceId: 'device-solana-03-new' }));
    expect(guestBody.created).toBe(true);
    expect(guestBody.userId).not.toBe(user.id);
    expect(guestBody.save.trophies).toBe(0);

    // --- they connect the same wallet.
    const c2 = await challenge(fresh, wallet.address, 'solana');
    const back = await fresh.post('/api/auth/wallet/link', {
      address: wallet.address, kind: 'solana', signature: wallet.sign(c2.message), message: c2.message,
    });
    expect(back.statusCode).toBe(200);
    const restored = json<WalletLinkResponse>(back);

    expect(restored.save.trophies).toBe(1234);
    expect(restored.save.best).toBe(1300);
    expect(restored.save.gold).toBe(9876);
    expect(restored.save.wins).toBe(21);
    expect(restored.save.name).toBe('Rina');
    // No second bonus for signing in again.
    expect(restored.bonusGranted).toBe(false);
    expect(restored.save.gem).toBe(gemsBefore);

    // The re-issued cookie really is the original account.
    const me = json<AuthResponse>(await fresh.get('/api/auth/me'));
    expect(me.userId).toBe(user.id);
    expect(me.save.trophies).toBe(1234);
  });

  it('creates an account for a wallet-first visitor with no session at all', async () => {
    const anon = new Agent(rig.app);
    const wallet = new SolanaWallet();
    const c = await challenge(anon, wallet.address, 'solana');
    const res = await anon.post('/api/auth/wallet/link', {
      address: wallet.address, kind: 'solana', signature: wallet.sign(c.message), message: c.message,
    });
    expect(res.statusCode).toBe(200);
    const body = json<WalletLinkResponse>(res);
    expect(body.bonusGranted).toBe(true);
    expect(body.save.gold).toBe(1200);
    expect((await anon.get('/api/auth/me')).statusCode).toBe(200);
  });

  it('reuses the wallet-first account after unlink and a re-sign from a clean browser', async () => {
    const anon = new Agent(rig.app);
    const wallet = new SolanaWallet();

    const c1 = await challenge(anon, wallet.address, 'solana');
    const created = json<WalletLinkResponse>(
      await anon.post('/api/auth/wallet/link', {
        address: wallet.address, kind: 'solana', signature: wallet.sign(c1.message), message: c1.message,
      }),
    );
    const userId = json<AuthResponse>(await anon.get('/api/auth/me')).userId;
    void created;

    // Give the account progress, then unlink — `User.wallet` goes null but the synthetic
    // device id stays, so a naive re-link would collide on it.
    const cur = (await rig.store.getSave(userId))!.json;
    await rig.store.putSave(userId, { ...cur, trophies: 555, gold: 7777 });
    await anon.post('/api/auth/wallet/unlink');

    const clean = new Agent(rig.app);
    const c2 = await challenge(clean, wallet.address, 'solana');
    const res = await clean.post('/api/auth/wallet/link', {
      address: wallet.address, kind: 'solana', signature: wallet.sign(c2.message), message: c2.message,
    });
    expect(res.statusCode).toBe(200);
    const body = json<WalletLinkResponse>(res);
    expect(body.save.trophies).toBe(555);
    expect(body.save.gold).toBe(7777);
    expect(json<AuthResponse>(await clean.get('/api/auth/me')).userId).toBe(userId);
  });

  it('returns walletTaken when the current account has progress that would be lost', async () => {
    const owner = await guest(rig.app, 'device-solana-04');
    const wallet = new SolanaWallet();
    const c1 = await challenge(owner, wallet.address, 'solana');
    await owner.post('/api/auth/wallet/link', {
      address: wallet.address, kind: 'solana', signature: wallet.sign(c1.message), message: c1.message,
    });

    // A different account that has actually played.
    const other = await guest(rig.app, 'device-solana-05');
    const otherUser = (await rig.store.userByDeviceId('device-solana-05'))!;
    const s = (await rig.store.getSave(otherUser.id))!.json;
    await rig.store.putSave(otherUser.id, { ...s, trophies: 300, wins: 4 });

    const c2 = await challenge(other, wallet.address, 'solana');
    const res = await other.post('/api/auth/wallet/link', {
      address: wallet.address, kind: 'solana', signature: wallet.sign(c2.message), message: c2.message,
    });
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe(API_ERRORS.walletTaken);

    // The would-be thief keeps their own account and save, untouched.
    const me = json<AuthResponse>(await other.get('/api/auth/me'));
    expect(me.userId).toBe(otherUser.id);
    expect(me.save.trophies).toBe(300);
  });

  it('unlink clears the wallet and airdrop eligibility but keeps the save', async () => {
    const agent = await guest(rig.app, 'device-solana-06');
    const wallet = new SolanaWallet();
    const c = await challenge(agent, wallet.address, 'solana');
    const linked = json<WalletLinkResponse>(
      await agent.post('/api/auth/wallet/link', {
        address: wallet.address, kind: 'solana', signature: wallet.sign(c.message), message: c.message,
      }),
    );

    const res = await agent.post('/api/auth/wallet/unlink');
    expect(res.statusCode).toBe(200);
    const body = json<{ wallet: null; airdropEligible: boolean; save: { gem: number } }>(res);
    expect(body.wallet).toBeNull();
    expect(body.airdropEligible).toBe(false);
    // Gems already granted are not confiscated.
    expect(body.save.gem).toBe(linked.save.gem);
  });
});

describe('wallet link — EVM / SIWE', () => {
  it('verifies a real SIWE signature and links the account', async () => {
    const agent = await guest(rig.app, 'device-evm-0001');
    const wallet = new EvmWallet(PK_A);

    const c = await challenge(agent, wallet.address, 'evm');
    // The server builds the whole EIP-4361 message; the client only signs it.
    expect(c.message).toContain('wants you to sign in with your Ethereum account:');
    expect(c.message).toContain(`Nonce: ${c.nonce}`);

    const res = await agent.post('/api/auth/wallet/link', {
      address: wallet.address,
      kind: 'evm',
      signature: await wallet.sign(c.message),
      message: c.message,
    });
    expect(res.statusCode).toBe(200);
    const body = json<WalletLinkResponse>(res);
    // Stored lower-cased so the unique index behaves.
    expect(body.wallet).toBe(wallet.address.toLowerCase());
    expect(body.walletKind).toBe('evm');
    expect(body.bonusGranted).toBe(true);
  });

  it('rejects a signature made by a different key', async () => {
    const agent = await guest(rig.app, 'device-evm-0002');
    const claimed = new EvmWallet(PK_A);
    const attacker = new EvmWallet(PK_B);

    const c = await challenge(agent, claimed.address, 'evm');
    const res = await agent.post('/api/auth/wallet/link', {
      address: claimed.address,
      kind: 'evm',
      signature: await attacker.sign(c.message),
      message: c.message,
    });
    expect(res.statusCode).toBe(401);
    expect(json<{ error: string }>(res).error).toBe(API_ERRORS.badSignature);
  });

  it('rejects a malformed address at nonce time', async () => {
    const agent = await guest(rig.app, 'device-evm-0003');
    const res = await agent.post('/api/auth/wallet/nonce', { address: '0xnot-an-address-at-all', kind: 'evm' });
    expect(res.statusCode).toBe(400);
  });
});

describe('nonce hygiene', () => {
  it('refuses a replayed signature', async () => {
    const agent = await guest(rig.app, 'device-nonce-01');
    const wallet = new SolanaWallet();
    const c = await challenge(agent, wallet.address, 'solana');
    const payload = {
      address: wallet.address, kind: 'solana' as const, signature: wallet.sign(c.message), message: c.message,
    };

    expect((await agent.post('/api/auth/wallet/link', payload)).statusCode).toBe(200);
    const replay = await agent.post('/api/auth/wallet/link', payload);
    expect(replay.statusCode).toBe(401);
    expect(json<{ error: string }>(replay).error).toBe(API_ERRORS.badSignature);
  });

  it('refuses an expired nonce', async () => {
    const agent = await guest(rig.app, 'device-nonce-02');
    const wallet = new SolanaWallet();
    // Planted directly with a past expiry, rather than waiting out the five-minute TTL. The
    // message is in the exact format `buildChallenge` emits, because verification runs against
    // the stored text.
    const nonce = 'e'.repeat(32);
    const message = [
      'localhost:5173 wants you to sign in with your Solana account:',
      wallet.address,
      '',
      'Link this wallet to your Crown Clash account.',
      '',
      'URI: http://localhost:5173',
      'Version: 1',
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(Date.now() - 600_000).toISOString()}`,
      `Expiration Time: ${new Date(Date.now() - 300_000).toISOString()}`,
    ].join('\n');
    await rig.store.createNonce({
      nonce,
      address: wallet.address,
      kind: 'solana',
      message,
      expiresAt: new Date(Date.now() - 300_000),
      usedAt: null,
    });

    const res = await agent.post('/api/auth/wallet/link', {
      address: wallet.address, kind: 'solana', signature: wallet.sign(message), message,
    });
    expect(res.statusCode).toBe(401);
    expect(json<{ error: string }>(res).error).toBe(API_ERRORS.badSignature);
  });

  it('refuses a message the server did not issue', async () => {
    const agent = await guest(rig.app, 'device-nonce-03');
    const wallet = new SolanaWallet();
    const c = await challenge(agent, wallet.address, 'solana');
    // Same nonce line, different body — a correctly signed message we never wrote.
    const forged = `gm\n${wallet.address}\n\nNonce: ${c.nonce}\n`;

    const res = await agent.post('/api/auth/wallet/link', {
      address: wallet.address, kind: 'solana', signature: wallet.sign(forged), message: forged,
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a signature bound to a different address', async () => {
    const agent = await guest(rig.app, 'device-nonce-04');
    const wallet = new SolanaWallet();
    const other = new SolanaWallet();
    const c = await challenge(agent, wallet.address, 'solana');

    const res = await agent.post('/api/auth/wallet/link', {
      address: other.address, kind: 'solana', signature: other.sign(c.message), message: c.message,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('leaderboard', () => {
  it('ranks by trophies and marks the caller', async () => {
    const a = await guest(rig.app, 'device-lb-000001');
    await guest(rig.app, 'device-lb-000002');
    const ua = (await rig.store.userByDeviceId('device-lb-000001'))!;
    const ub = (await rig.store.userByDeviceId('device-lb-000002'))!;
    await rig.store.putSave(ua.id, { ...(await rig.store.getSave(ua.id))!.json, trophies: 900, best: 900 });
    await rig.store.putSave(ub.id, { ...(await rig.store.getSave(ub.id))!.json, trophies: 1500, best: 1500 });

    const body = json<{ entries: { rank: number; trophies: number; me?: boolean }[]; me: { rank: number } | null }>(
      await a.get('/api/leaderboard'),
    );
    expect(body.entries[0].trophies).toBe(1500);
    expect(body.entries[1].trophies).toBe(900);
    expect(body.me?.rank).toBe(2);
    expect(body.entries[1].me).toBe(true);
  });

  it('serves anonymous callers without a `me` row', async () => {
    const body = json<{ entries: unknown[]; me: null }>(await new Agent(rig.app).get('/api/leaderboard'));
    expect(body.me).toBeNull();
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

describe('GET /api/health', () => {
  it('reports the redis mode so a misconfigured VPS is obvious', async () => {
    const body = json<{ ok: boolean; redis: string }>(await new Agent(rig.app).get('/api/health'));
    expect(body.ok).toBe(true);
    expect(body.redis).toBe('memory');
  });
});
