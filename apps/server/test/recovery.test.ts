/**
 * Account recovery.
 *
 * A guest account is reachable only through a random device id in the browser's IndexedDB.
 * Clear site data or change phones and everything earned is stranded on the server with no way
 * to prove ownership. A recovery code is the proof.
 *
 * That makes this an authentication endpoint, so the tests below care about two things in
 * roughly equal measure: that a player who kept their code gets their account back on a new
 * device, and that nobody else does. The redemption path can move an account between devices,
 * which is exactly the capability an attacker would want.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { API_ERRORS, type AuthResponse, type RecoveryCreateResponse } from '@crown/shared';
import {
  CODE_CHARS,
  formatCode,
  generateCode,
  hashCode,
  looksLikeCode,
  normalizeCode,
} from '../src/lib/recovery.js';
import { isReservedDeviceId, orphanDeviceId } from '../src/lib/store.js';
import { Agent, guest, json, makeRig, type TestRig } from './helpers.js';

let rig: TestRig;

beforeEach(async () => {
  rig = await makeRig();
});

afterEach(async () => {
  await rig.close();
});

/** Issue a code for an agent, returning the plaintext. */
async function makeCode(agent: Agent): Promise<string> {
  const res = await agent.post('/api/auth/recovery', {});
  expect(res.statusCode).toBe(200);
  return json<RecoveryCreateResponse>(res).code;
}

/**
 * Give an account something worth recovering.
 *
 * Written straight to the store rather than played for, the same way auth.test.ts seeds
 * progress: what these tests are about is whether the save follows the code, not how the gold
 * got there.
 */
async function earn(agent: Agent, gold: number): Promise<void> {
  const { userId } = json<AuthResponse>(await agent.get('/api/auth/me'));
  const current = (await rig.store.getSave(userId))!.json;
  await rig.store.putSave(userId, { ...current, gold, trophies: 300, wins: 4 });
}

/* ------------------------------------------------------------------- the code */

describe('the code itself', () => {
  it('is 100 bits, drawn from an alphabet without the characters people confuse', () => {
    const code = generateCode();
    expect(normalizeCode(code)).toHaveLength(CODE_CHARS);
    // Crockford: no I, L, O or U anywhere in a generated code.
    expect(code).not.toMatch(/[ILOU]/);
    expect(code.split('-')).toHaveLength(4);
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateCode());
    expect(seen.size).toBe(500);
  });

  it('forgives the mistakes reading a code aloud actually produces', () => {
    const raw = 'ABCDE12345FGHJK67890';
    const canonical = normalizeCode(formatCode(raw));
    // Lower case, missing hyphens, stray spaces.
    expect(normalizeCode('abcde12345fghjk67890')).toBe(canonical);
    expect(normalizeCode(' ABCDE 12345 FGHJK 67890 ')).toBe(canonical);
    // Crockford substitutions: someone who wrote down O for 0 and I/L for 1 still gets in.
    expect(normalizeCode('ABCDEI2345FGHJK6789O')).toBe(normalizeCode('ABCDE12345FGHJK67890'));
    expect(normalizeCode('ABCDEL2345FGHJK67890')).toBe(normalizeCode('ABCDE12345FGHJK67890'));
  });

  it('rejects anything that is not the right shape before it reaches the database', () => {
    expect(looksLikeCode(generateCode())).toBe(true);
    expect(looksLikeCode('')).toBe(false);
    expect(looksLikeCode('TOO-SHORT')).toBe(false);
    expect(looksLikeCode(generateCode() + 'X')).toBe(false);
  });

  it('hashes the canonical form, so formatting never changes the answer', () => {
    const code = generateCode();
    const secret = 'test-secret';
    expect(hashCode(secret, code)).toBe(hashCode(secret, code.toLowerCase().replace(/-/g, '')));
    // ...and the hash is keyed, so a different deployment cannot redeem this code.
    expect(hashCode(secret, code)).not.toBe(hashCode('other-secret', code));
  });
});

/* ---------------------------------------------------------------- the round trip */

describe('recovering an account', () => {
  it('returns the code once and never again', async () => {
    const agent = await guest(rig.app, 'device-original-0001');
    const first = json<RecoveryCreateResponse>(await agent.post('/api/auth/recovery', {}));
    expect(first.replaced).toBe(false);
    expect(looksLikeCode(first.code)).toBe(true);

    // There is no endpoint that hands the code back, by design — the only way to see one
    // again is to issue a new one, which kills the old.
    const second = json<RecoveryCreateResponse>(await agent.post('/api/auth/recovery', {}));
    expect(second.replaced).toBe(true);
    expect(second.code).not.toBe(first.code);
  });

  it('reports whether a code exists without revealing it', async () => {
    const agent = await guest(rig.app, 'device-flag-0001');
    expect(json<AuthResponse>(await agent.get('/api/auth/me')).hasRecovery).toBe(false);
    const code = await makeCode(agent);
    const me = json<AuthResponse>(await agent.get('/api/auth/me'));
    expect(me.hasRecovery).toBe(true);
    expect(JSON.stringify(me)).not.toContain(normalizeCode(code).slice(0, 8));
  });

  it('gives a player their save back on a completely fresh device', async () => {
    const original = await guest(rig.app, 'device-original-0002');
    await earn(original, 7777);
    const code = await makeCode(original);

    // A new phone: new browser, new device id, nothing carried over.
    const replacement = new Agent(rig.app);
    const res = await replacement.post('/api/auth/recovery/redeem', { code, deviceId: 'device-replacement-0002' });
    expect(res.statusCode).toBe(200);
    expect(json<AuthResponse>(res).save.gold).toBe(7777);
  });

  it('sticks past the session, because the new device id now resolves to the account', async () => {
    // This is the part a cookie alone would not fix: `boot()` signs in with the device id on
    // every launch, so if the rebind did not happen the player would be stranded again the
    // moment the session expired.
    const original = await guest(rig.app, 'device-original-0003');
    await earn(original, 4242);
    const code = await makeCode(original);

    const replacement = new Agent(rig.app);
    await replacement.post('/api/auth/recovery/redeem', { code, deviceId: 'device-replacement-0003' });
    replacement.clearCookies();

    const relogin = json<AuthResponse>(await replacement.post('/api/auth/guest', { deviceId: 'device-replacement-0003' }));
    expect(relogin.created).toBe(false);
    expect(relogin.save.gold).toBe(4242);
  });

  it('takes the account away from the old device rather than cloning it', async () => {
    const original = await guest(rig.app, 'device-original-0004');
    await earn(original, 999);
    const userId = json<AuthResponse>(await original.get('/api/auth/me')).userId;
    const code = await makeCode(original);

    const replacement = new Agent(rig.app);
    await replacement.post('/api/auth/recovery/redeem', { code, deviceId: 'device-replacement-0004' });

    // The old device id no longer opens anything: signing in with it creates a new account.
    const stale = new Agent(rig.app);
    const res = json<AuthResponse>(await stale.post('/api/auth/guest', { deviceId: 'device-original-0004' }));
    expect(res.created).toBe(true);
    expect(res.userId).not.toBe(userId);
    expect(res.save.gold).not.toBe(999);
  });

  it('does not destroy the row it displaces', async () => {
    // The displaced account keeps its save; it is merely unreachable by device id. Deleting
    // rows on an auth path is how a bug becomes permanent data loss.
    const original = await guest(rig.app, 'device-original-0005');
    const code = await makeCode(original);
    const empty = await guest(rig.app, 'device-empty-0005');
    const emptyId = json<AuthResponse>(await empty.get('/api/auth/me')).userId;

    await empty.post('/api/auth/recovery/redeem', { code, deviceId: 'device-empty-0005' });

    const displaced = await rig.store.userById(emptyId);
    expect(displaced).not.toBeNull();
    expect(await rig.store.getSave(emptyId)).not.toBeNull();
    // ...and it is parked somewhere no browser can present.
    expect(isReservedDeviceId(displaced!.deviceId)).toBe(true);
  });

  it('is idempotent when the device that already owns the account redeems its own code', async () => {
    const agent = await guest(rig.app, 'device-self-0006');
    await earn(agent, 321);
    const code = await makeCode(agent);
    const res = await agent.post('/api/auth/recovery/redeem', { code, deviceId: 'device-self-0006' });
    expect(res.statusCode).toBe(200);
    expect(json<AuthResponse>(res).save.gold).toBe(321);
  });
});

/* ------------------------------------------------------------------- refusals */

describe('what recovery must not do', () => {
  it('rejects a wrong code, and says nothing about why', async () => {
    const owner = await guest(rig.app, 'device-owner-0007');
    await makeCode(owner);

    const attacker = new Agent(rig.app);
    const wrong = await attacker.post('/api/auth/recovery/redeem', {
      code: generateCode(),
      deviceId: 'device-attacker-0007',
    });
    const malformed = await attacker.post('/api/auth/recovery/redeem', {
      code: 'NOTACODE',
      deviceId: 'device-attacker-0007',
    });

    expect(wrong.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(401);
    // A well-formed miss and a malformed string are indistinguishable, so neither can be used
    // to work out which codes exist.
    expect(json<{ error: string }>(wrong).error).toBe(API_ERRORS.badRecoveryCode);
    expect(json<{ error: string }>(malformed).error).toBe(API_ERRORS.badRecoveryCode);
  });

  it('kills the previous code when a new one is issued', async () => {
    const agent = await guest(rig.app, 'device-rotate-0008');
    const old = await makeCode(agent);
    await makeCode(agent);

    const res = await new Agent(rig.app).post('/api/auth/recovery/redeem', {
      code: old,
      deviceId: 'device-rotate-attacker-0008',
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses to abandon progress the redeeming browser already has', async () => {
    const owner = await guest(rig.app, 'device-owner-0009');
    const code = await makeCode(owner);

    const busy = await guest(rig.app, 'device-busy-0009');
    await earn(busy, 5000);

    const res = await busy.post('/api/auth/recovery/redeem', { code, deviceId: 'device-busy-0009' });
    expect(res.statusCode).toBe(409);
    expect(json<{ error: string }>(res).error).toBe(API_ERRORS.recoveryConflict);
    // Nothing moved: both accounts are exactly where they were.
    expect(json<AuthResponse>(await busy.get('/api/auth/me')).save.gold).toBe(5000);
  });

  it('lets an untouched browser recover, since there is nothing to lose', async () => {
    // The mirror of the case above, and the common one: `boot()` has already made a fresh
    // empty guest account by the time the player types their code in.
    const owner = await guest(rig.app, 'device-owner-0010');
    await earn(owner, 1234);
    const code = await makeCode(owner);

    const fresh = await guest(rig.app, 'device-fresh-0010');
    const res = await fresh.post('/api/auth/recovery/redeem', { code, deviceId: 'device-fresh-0010' });
    expect(res.statusCode).toBe(200);
    expect(json<AuthResponse>(res).save.gold).toBe(1234);
  });

  it('will not park an account on a device id the login endpoint refuses to serve', async () => {
    const owner = await guest(rig.app, 'device-owner-0011');
    const code = await makeCode(owner);

    for (const deviceId of ['wallet:evm:deadbeef', 'orphan:whatever', orphanDeviceId()]) {
      expect(isReservedDeviceId(deviceId)).toBe(true);
      const res = await new Agent(rig.app).post('/api/auth/recovery/redeem', { code, deviceId });
      // Otherwise this endpoint would be a way to strand an account somewhere /auth/guest
      // cannot reach — or worse, on a synthetic id derived from a public wallet address.
      expect(res.statusCode).toBe(400);
    }
  });

  it('requires a session to issue a code', async () => {
    const res = await new Agent(rig.app).post('/api/auth/recovery', {});
    expect(res.statusCode).toBe(401);
  });

  it('never lets one code open two accounts', async () => {
    const a = await guest(rig.app, 'device-a-0012');
    const b = await guest(rig.app, 'device-b-0012');
    const codeA = await makeCode(a);
    const codeB = await makeCode(b);
    expect(codeA).not.toBe(codeB);

    const idA = json<AuthResponse>(await a.get('/api/auth/me')).userId;
    const viaA = await new Agent(rig.app).post('/api/auth/recovery/redeem', { code: codeA, deviceId: 'device-x-0012' });
    expect(json<AuthResponse>(viaA).userId).toBe(idA);
  });
});
