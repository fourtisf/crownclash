/**
 * Account recovery.
 *
 * Everything a player earns hangs off one random device id in this browser's IndexedDB. Clear
 * site data, replace the phone, or let the browser evict storage, and the account is gone —
 * still on the server, with nothing left to prove it was theirs. Linking a wallet was the only
 * way back, which is no answer at all for a player who does not have one.
 *
 * A recovery code fixes that, and the hard part is not the cryptography — it is getting anyone
 * to write down twenty characters before they need them. So the code is offered at the one
 * moment a player has just been given a reason to care: immediately after their first win.
 */
import type { AuthResponse, RecoveryCreateResponse } from '@crown/shared';
import { $, must } from '../dom';
import { api } from '../api/client';
import { S, deviceId, setSave } from '../api/store';
import { Snd } from '../engine';
import { closeModal, openModal } from '../ui/modal';
import { toastTop } from '../ui/toast';
import { STR, esc } from './strings';
import { apiMessage } from './errors';

/** Mirrors `AuthResponse.hasRecovery`; kept here so the nag knows whether it is needed. */
let hasCode = false;

export function setHasRecovery(v: boolean): void {
  hasCode = v;
}

export function hasRecovery(): boolean {
  return hasCode;
}

/** Copy helper. `navigator.clipboard` is absent over plain http, so the fallback matters. */
async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through — a blocked clipboard is not an error worth showing */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Show a freshly issued code.
 *
 * `level` exists because this can be reached from inside the settings sheet, which is already
 * a modal — the code has to land on top of it rather than replace it.
 */
function showCode(res: RecoveryCreateResponse, level?: 1 | 2): void {
  hasCode = true;
  const m = openModal(
    '<h2 class="goldtext">' + STR.recovery.savedTitle + '</h2>' +
      '<p class="sub">' + STR.recovery.savedSub + '</p>' +
      '<div class="rcode" id="rcCode">' + esc(res.code) + '</div>' +
      '<button class="btn gold" id="rcCopy" style="width:100%">' + STR.recovery.copy + '</button>' +
      '<div class="rcwarn">' + STR.recovery.warning + '</div>' +
      '<button class="btn ghost" id="rcDone" style="width:100%;margin-top:8px">' + STR.recovery.done + '</button>',
    level,
  );
  const btn = must<HTMLButtonElement>('#rcCopy', m);
  btn.onclick = async () => {
    const ok = await copy(res.code);
    btn.textContent = ok ? STR.recovery.copied : STR.recovery.copyFailed;
    if (ok) Snd.coin();
  };
  must('#rcDone', m).onclick = () => closeModal(level);
}

/**
 * Issue (or rotate) a code and show it.
 *
 * Rotation is behind a confirm because it is destructive in a way that looks harmless: the
 * code on the piece of paper in the player's drawer stops working the moment a new one exists.
 */
export async function createRecoveryCode(level?: 1 | 2): Promise<void> {
  try {
    const res = await api.createRecovery();
    showCode(res, level);
  } catch (err) {
    toastTop(apiMessage(err, STR.recovery.createFailed));
  }
}

/** Entry point from Settings. Explains first, then offers the code. */
export function openRecovery(level: 1 | 2 = 2): void {
  const m = openModal(
    '<button class="xbtn" data-close>✕</button><h2 class="goldtext">' + STR.recovery.title + '</h2>' +
      '<p class="sub">' + (hasCode ? STR.recovery.subHas : STR.recovery.subNone) + '</p>' +
      '<div class="rcwarn">' + STR.recovery.explain + '</div>' +
      '<button class="btn ' + (hasCode ? 'ghost' : 'gold') + '" id="rcMake" style="width:100%;margin-top:10px">' +
      (hasCode ? STR.recovery.rotate : STR.recovery.create) + '</button>',
    level,
  );
  const make = must<HTMLButtonElement>('#rcMake', m);
  make.onclick = async () => {
    if (hasCode && !window.confirm(STR.recovery.rotateConfirm)) return;
    make.disabled = true;
    await createRecoveryCode(level);
    make.disabled = false;
  };
}

/**
 * Redeem a code. Opened from the landing page, before the player has committed to anything.
 *
 * On success the whole app has to be re-pointed at the recovered account: the response carries
 * its save, and the device id is written to IndexedDB so the *next* launch signs in as them
 * too — a session cookie alone would strand the player again when it expired.
 */
export function openRedeem(level: 1 | 2 = 1): void {
  const m = openModal(
    '<button class="xbtn" data-close>✕</button><h2 class="goldtext">' + STR.recovery.redeemTitle + '</h2>' +
      '<p class="sub">' + STR.recovery.redeemSub + '</p>' +
      '<input class="inputbox rcinput" id="rcIn" maxlength="29" autocapitalize="characters" ' +
      'autocomplete="off" spellcheck="false" placeholder="' + STR.recovery.placeholder + '">' +
      '<div class="rcerr" id="rcErr" hidden></div>' +
      '<button class="btn gold" id="rcGo" style="width:100%;margin-top:10px">' + STR.recovery.redeem + '</button>',
    level,
  );
  // This is the one modal that opens while the landing page is still covering the screen, so
  // it has to out-rank it (see `.abovelanding` in ui.css). Given back on close, because the
  // first-run welcome modal deliberately waits *underneath* the landing and would otherwise
  // inherit the elevation and cover the PLAY button.
  const ovl = must(level === 2 ? '#ovl2' : '#ovl');
  ovl.classList.add('abovelanding');
  const watcher = new MutationObserver(() => {
    if (ovl.classList.contains('on')) return;
    watcher.disconnect();
    ovl.classList.remove('abovelanding');
  });
  watcher.observe(ovl, { attributes: true, attributeFilter: ['class'] });

  const input = must<HTMLInputElement>('#rcIn', m);
  const err = must('#rcErr', m);
  const go = must<HTMLButtonElement>('#rcGo', m);
  input.focus();

  const fail = (msg: string): void => {
    err.textContent = msg;
    err.hidden = false;
  };

  go.onclick = async () => {
    const code = input.value.trim();
    if (!code) return;
    go.disabled = true;
    err.hidden = true;
    try {
      // This browser's device id is already in IndexedDB — `boot()` made one before the
      // landing page rendered. Redemption points *it* at the recovered account, so there is
      // nothing to write back here: the binding the next launch needs is the one we just sent.
      const res: AuthResponse = await api.redeemRecovery(code, await deviceId());
      setSave(res.save);
      hasCode = res.hasRecovery;
      Snd.crown();
      // Reload rather than patch the running app. Every screen, the header, the deck and the
      // battle bridge were all built around a different account; re-booting is the only way to
      // be sure none of it is left over, and this happens once in an account's life.
      window.setTimeout(() => window.location.reload(), 900);
      closeModal(level);
      toastTop(STR.recovery.redeemed(res.save.name));
    } catch (e) {
      go.disabled = false;
      fail(apiMessage(e, STR.recovery.redeemFailed));
    }
  };

  input.onkeydown = (e) => {
    if (e.key === 'Enter') go.click();
  };
}

/**
 * Offer the code after a first win, once.
 *
 * Deliberately not on first launch: a player who has not yet earned anything has no reason to
 * copy down a code, and asking then trains them to dismiss it. `S.recoveryAsked` makes it a
 * one-time prompt — Settings is where it lives permanently.
 */
export function maybePromptRecovery(): void {
  if (hasCode || S.recoveryAsked || S.wins < 1) return;
  // Marked immediately, and locally, so a dismissed prompt does not come back on the next
  // match while the request is still in flight.
  S.recoveryAsked = true;
  void api.updateProfile({ recoveryAsked: true }).catch(() => undefined);

  const m = openModal(
    '<h2 class="goldtext">' + STR.recovery.promptTitle + '</h2>' +
      '<p class="sub">' + STR.recovery.promptSub + '</p>' +
      '<div class="rcwarn">' + STR.recovery.explain + '</div>' +
      '<button class="btn gold" id="rcYes" style="width:100%;margin-top:10px">' + STR.recovery.create + '</button>' +
      '<button class="btn ghost" id="rcNo" style="width:100%;margin-top:8px">' + STR.recovery.later + '</button>',
  );
  must<HTMLButtonElement>('#rcYes', m).onclick = () => void createRecoveryCode();
  must('#rcNo', m).onclick = () => closeModal();
}

/** Wire the landing page's "I have a code" link. Bound once, like everything else there. */
let bound = false;
export function bindRecoveryEntry(): void {
  if (bound) return;
  bound = true;
  const link = $('#lpRecover');
  if (link) link.onclick = () => openRedeem();
}
