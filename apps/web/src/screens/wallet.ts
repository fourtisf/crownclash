/**
 * Wallet linking — crown-clash.html L2890-2931.
 *
 * The modal, the three options and the copy are the prototype's. The *flow* is not:
 *
 *   Prototype: try `window.ethereum` / `window.solana`, and **on any failure fabricate a
 *   random hex address** so the demo kept moving (L2917-2920). That address was then stored
 *   as the player's wallet and the +100 💎 bonus was granted client-side.
 *
 *   Here: address → `POST /auth/wallet/nonce` → sign the returned message
 *   (`personal_sign` for EVM, `signMessage` for Solana) → `POST /auth/wallet/link`. The
 *   server verifies the signature, owns the +100 💎 grant and sets airdrop eligibility
 *   (handoff §3.3). A fabricated address cannot produce a signature, so the fallback is not
 *   just undesirable — it is unimplementable. With no wallet extension the modal says so.
 *
 * WalletConnect keeps its row but rides the injected EVM provider: in-app wallet browsers
 * (and the WalletConnect-compatible extensions) all expose EIP-1193 at `window.ethereum`.
 * Wiring the real WalletConnect SDK is a dependency decision, not a porting one.
 */
import { must } from '../dom';
import { Snd } from '../engine';
import { S, setSave } from '../api/store';
import { api } from '../api/client';
import { closeModal, openModal } from '../ui/modal';
import { toastTop } from '../ui/toast';
import { setTab } from '../ui/tabs';
import { refreshHeader } from './home';
import { STR, esc } from './strings';
import { apiMessage } from './errors';
import type { WalletLinkResponse } from '@crown/shared';

/* ------------------------------------------------------------ provider types */

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface SolanaProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    solana?: SolanaProvider;
  }
}

/** A failure we can explain to the player, as opposed to an unexpected throw. */
class WalletError extends Error {}

/** EIP-1193 user-rejection code, used by MetaMask and Phantom alike. */
const USER_REJECTED = 4001;

function isRejection(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === USER_REJECTED;
}

/* ---------------------------------------------------------------- encodings */

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** `personal_sign` takes the message as hex; a raw string works in MetaMask but not everywhere. */
function toHexMessage(msg: string): string {
  return '0x' + Array.from(utf8(msg), (b) => b.toString(16).padStart(2, '0')).join('');
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Base58-encode a Solana signature.
 *
 * `signMessage` hands back 64 raw bytes and the Solana ecosystem's wire format for
 * signatures is base58 — that is what `tweetnacl`/`@solana/web3.js` on the server will
 * expect to `bs58.decode()`. Hand-rolled because it is 15 lines and pulling a dependency in
 * for it is not worth the install.
 */
function base58(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let leading = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) leading += '1';
  let out = '';
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return leading + out;
}

/* --------------------------------------------------------------- link flows */

function applyLink(res: WalletLinkResponse): void {
  setSave(res.save);
  if (res.bonusGranted) {
    // L2924 — the toast is the prototype's; the +100 💎 itself is now granted server-side.
    toastTop(STR.wallet.connected);
    Snd.coin();
  }
  refreshHeader();
  closeModal();
  setTab('login');
}

async function linkEvm(missing: string): Promise<void> {
  const eth = window.ethereum;
  if (!eth) throw new WalletError(missing);
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[] | undefined;
  const address = accounts && accounts[0];
  if (!address) throw new WalletError(STR.wallet.noAccount);
  const { message } = await api.walletNonce({ address, kind: 'evm' });
  const signature = (await eth.request({
    method: 'personal_sign',
    params: [toHexMessage(message), address],
  })) as string;
  if (!signature) throw new WalletError(STR.wallet.signFailed);
  // `message` is echoed so the server verifies the exact bytes it issued, not a rebuild.
  applyLink(await api.walletLink({ address, kind: 'evm', signature, message }));
}

async function linkSolana(): Promise<void> {
  const sol = window.solana;
  if (!sol || typeof sol.connect !== 'function') throw new WalletError(STR.wallet.noPhantom);
  const conn = await sol.connect();
  const address = conn.publicKey.toString();
  const { message } = await api.walletNonce({ address, kind: 'solana' });
  const signed = await sol.signMessage(utf8(message), 'utf8');
  if (!signed || !signed.signature) throw new WalletError(STR.wallet.signFailed);
  applyLink(await api.walletLink({ address, kind: 'solana', signature: base58(signed.signature), message }));
}

/* -------------------------------------------------------------------- modal */

/** L2890-2931 */
export function openWallet(): void {
  if (S.wallet) {
    openModal(
      '<button class="xbtn" data-close>✕</button><h2 class="goldtext">' + STR.wallet.title +
        '</h2><p class="sub">' + esc(STR.wallet.kindLabel(S.walletKind || '')) + '</p>' +
        '<div class="addr">' + esc(S.wallet) + '</div>' +
        '<div class="hint" style="margin:12px 0">' + STR.wallet.localNote + '</div>' +
        '<button class="btn ghost" id="wDisc" style="width:100%">' + STR.wallet.disconnect + '</button>',
    );
    const disc = must<HTMLButtonElement>('#wDisc');
    disc.onclick = async () => {
      disc.disabled = true;
      try {
        // Unlinking clears airdrop eligibility server-side; the local save is whatever
        // comes back, never a locally-nulled field.
        const res = await api.walletUnlink();
        setSave(res.save);
        refreshHeader();
        closeModal();
        setTab('home');
      } catch (err) {
        disc.disabled = false;
        toastTop(apiMessage(err, STR.wallet.unlinkFailed));
      }
    };
    return;
  }

  const m = openModal(
    '<button class="xbtn" data-close>✕</button><h2 class="goldtext">' + STR.wallet.connectTitle +
      '</h2><p class="sub">' + STR.wallet.bonusSub + '</p>' +
      '<button class="wopt" data-w="MetaMask"><span class="wi">🦊</span><span>' + STR.wallet.metamask +
        '<small>' + STR.wallet.metamaskSub + '</small></span></button>' +
      '<button class="wopt" data-w="Phantom"><span class="wi">👻</span><span>' + STR.wallet.phantom +
        '<small>' + STR.wallet.phantomSub + '</small></span></button>' +
      '<button class="wopt" data-w="WalletConnect"><span class="wi">🔗</span><span>' + STR.wallet.walletconnect +
        '<small>' + STR.wallet.walletconnectSub + '</small></span></button>' +
      '<div class="hint" style="margin-top:10px">' + STR.wallet.needExtension + '</div>',
  );

  m.querySelectorAll<HTMLButtonElement>('.wopt').forEach((b) => {
    b.onclick = async () => {
      const kind = b.dataset.w;
      // Disable the whole row set: two concurrent connect prompts confuse every extension.
      const all = m.querySelectorAll<HTMLButtonElement>('.wopt');
      all.forEach((x) => (x.disabled = true));
      try {
        if (kind === 'Phantom') await linkSolana();
        else if (kind === 'MetaMask') await linkEvm(STR.wallet.noMetaMask);
        else await linkEvm(STR.wallet.noInjected);
      } catch (err) {
        all.forEach((x) => (x.disabled = false));
        if (err instanceof WalletError) toastTop(err.message);
        else if (isRejection(err)) toastTop(STR.wallet.cancelled);
        else toastTop(apiMessage(err, STR.wallet.linkFailed));
      }
    };
  });
}
