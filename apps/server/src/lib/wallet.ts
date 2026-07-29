/**
 * Wallet signature verification (handoff §3.3).
 *
 * The design goal is that a signature proves exactly one thing and can prove it exactly once:
 *
 *  1. `/api/auth/wallet/nonce` builds the **whole message** server-side and stores it with the
 *     nonce. Verification then runs against the *stored* text, never against whatever string
 *     the client posts back. A client that signs "gm" and submits a SIWE message alongside it
 *     gets nothing, because the bytes we hash are ours.
 *  2. The nonce row is consumed by a conditional update (`store.consumeNonce`), so a captured
 *     signature replayed a second later finds the row already used.
 *  3. EVM verification is `siwe` for structure (domain / nonce / expiry / address binding) and
 *     `viem` for the actual secp256k1 recovery. siwe's own `verify()` reaches for `ethers`,
 *     which this server does not depend on; splitting the two keeps the dependency graph
 *     honest and gives us the same guarantee.
 *
 * Solana has no EIP-4361 equivalent, so the message is plain text in the same layout, and
 * `tweetnacl` verifies the ed25519 signature against the base58-decoded public key.
 */
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { SiweMessage } from 'siwe';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { randomSeed } from '@crown/shared';
import { env } from './env.js';

export type WalletKind = 'evm' | 'solana';

export interface BuiltChallenge {
  nonce: string;
  message: string;
  /** Canonical form stored on `User.wallet`. */
  address: string;
  expiresAt: Date;
}

/**
 * EVM addresses are stored lower-cased so `@unique` behaves; base58 is case-significant so a
 * Solana address is stored verbatim. Getting this backwards would either let one wallet own
 * two accounts or make a legitimate re-login look like a new user.
 */
export function normalizeAddress(kind: WalletKind, address: string): string {
  return kind === 'evm' ? address.toLowerCase() : address.trim();
}

export function assertValidAddress(kind: WalletKind, address: string): void {
  if (kind === 'evm') {
    if (!isAddress(address)) throw new Error('invalid EVM address');
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(address.trim());
  } catch {
    throw new Error('invalid base58 address');
  }
  // ed25519 public keys are exactly 32 bytes. Checking here rather than leaning on
  // @solana/web3.js keeps a megabyte of RPC client out of the auth path — and `nacl.verify`
  // would reject anything that is not a real signing key anyway. It does, however, *throw*
  // on a wrong-sized key, so the guard has to exist somewhere.
  if (bytes.length !== 32) throw new Error('invalid Solana public key length');
}

/** 32 hex chars — alphanumeric and ≥8 characters, which is what EIP-4361 requires of a nonce. */
export function newNonce(): string {
  return randomSeed();
}

function solanaMessage(address: string, nonce: string, issuedAt: Date, expiresAt: Date): string {
  // Deliberately mirrors the SIWE layout so the client can render one signing UI for both
  // chains, and so the `Nonce:` line parses with the same regex.
  return [
    `${env.SIWE_DOMAIN} wants you to sign in with your Solana account:`,
    address,
    '',
    env.SIWE_STATEMENT,
    '',
    `URI: ${env.SIWE_URI}`,
    'Version: 1',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

export function buildChallenge(kind: WalletKind, rawAddress: string, now = new Date()): BuiltChallenge {
  assertValidAddress(kind, rawAddress);
  const nonce = newNonce();
  const expiresAt = new Date(now.getTime() + env.WALLET_NONCE_TTL_SEC * 1000);

  if (kind === 'evm') {
    // SIWE requires the EIP-55 checksummed form inside the message even though we store the
    // lower-cased one.
    const checksummed = getAddress(rawAddress);
    const message = new SiweMessage({
      domain: env.SIWE_DOMAIN,
      address: checksummed,
      statement: env.SIWE_STATEMENT,
      uri: env.SIWE_URI,
      version: '1',
      chainId: env.SIWE_CHAIN_ID,
      nonce,
      issuedAt: now.toISOString(),
      expirationTime: expiresAt.toISOString(),
    }).prepareMessage();
    return { nonce, message, address: normalizeAddress('evm', rawAddress), expiresAt };
  }

  const address = rawAddress.trim();
  return {
    nonce,
    message: solanaMessage(address, nonce, now, expiresAt),
    address: normalizeAddress('solana', address),
    expiresAt,
  };
}

/** Pulls the nonce out of a submitted message so the stored challenge can be looked up. */
export function extractNonce(message: string): string | null {
  const m = /^Nonce: ([A-Za-z0-9]{8,})$/m.exec(message);
  return m ? m[1] : null;
}

export interface VerifyInput {
  kind: WalletKind;
  /** The address the caller claims. */
  address: string;
  /** The message as stored at nonce-issue time — NOT the client's copy. */
  storedMessage: string;
  nonce: string;
  signature: string;
  now?: Date;
}

/**
 * Returns the canonical wallet id on success, or null on any failure. Failures are not
 * differentiated on purpose: "wrong signature" and "wrong signer" are the same 401 to the
 * caller, and the detail goes to the log instead.
 */
export async function verifyWalletSignature(input: VerifyInput): Promise<string | null> {
  const now = input.now ?? new Date();
  const expected = normalizeAddress(input.kind, input.address);

  if (input.kind === 'evm') {
    let parsed: SiweMessage;
    try {
      parsed = new SiweMessage(input.storedMessage);
    } catch {
      return null;
    }
    if (parsed.nonce !== input.nonce) return null;
    if (parsed.domain !== env.SIWE_DOMAIN) return null;
    if (parsed.uri !== env.SIWE_URI) return null;
    if (parsed.address.toLowerCase() !== expected) return null;
    if (parsed.expirationTime && new Date(parsed.expirationTime).getTime() <= now.getTime()) return null;
    if (parsed.notBefore && new Date(parsed.notBefore).getTime() > now.getTime()) return null;

    let sig = input.signature.trim();
    if (!sig.startsWith('0x')) sig = `0x${sig}`;
    if (!/^0x[0-9a-fA-F]+$/.test(sig)) return null;
    try {
      const ok = await verifyMessage({
        address: getAddress(parsed.address),
        message: input.storedMessage,
        signature: sig as `0x${string}`,
      });
      return ok ? expected : null;
    } catch {
      return null;
    }
  }

  // Solana. The message is ours, so structural checks are cheap sanity rather than security.
  if (extractNonce(input.storedMessage) !== input.nonce) return null;
  if (!input.storedMessage.includes(`\n${input.address.trim()}\n`)) return null;
  const expiry = /^Expiration Time: (.+)$/m.exec(input.storedMessage);
  if (expiry && new Date(expiry[1]).getTime() <= now.getTime()) return null;

  try {
    const pub = bs58.decode(input.address.trim());
    if (pub.length !== 32) return null;
    const sig = bs58.decode(input.signature.trim());
    if (sig.length !== 64) return null;
    const ok = nacl.sign.detached.verify(new TextEncoder().encode(input.storedMessage), sig, pub);
    return ok ? expected : null;
  } catch {
    return null;
  }
}
