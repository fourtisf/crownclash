/**
 * Daily-login tab — crown-clash.html L2852-2887.
 *
 * The 7-day grid, the streak pill and the wallet card underneath are the prototype's. The
 * claim itself is a server call: it owns the streak arithmetic (`last === yesterday`), the
 * day index and the payout, so two devices cannot both claim day 4.
 */
import { LOGIN_REWARDS, loginReady } from '@crown/shared';
import { $, must } from '../dom';
import { Snd } from '../engine';
import { S, setSave } from '../api/store';
import { api } from '../api/client';
import { toastTop } from '../ui/toast';
import { markDots } from '../ui/tabs';
import { refreshHeader } from './home';
import { openChestFlow } from './chest';
import { openWallet } from './wallet';
import { STR, esc } from './strings';
import { apiMessage } from './errors';

/** L2853-2874 */
export function renderLogin(body: HTMLElement): void {
  const ready = loginReady(S);
  body.innerHTML =
    '<div class="sect" style="margin-top:4px"><div class="secthead"><h3>' + STR.login.title +
      '</h3><span class="pill">' + STR.login.streak(S.login.streak) + '</span></div>' +
    '<div class="days" id="dayGrid"></div>' +
    '<button class="btn ' + (ready ? 'gold' : 'ghost') + '" id="claimDay" style="width:100%;margin-top:12px" ' +
      (ready ? '' : 'disabled') + '>' +
      (ready ? STR.login.claimDay(S.login.day) : STR.login.alreadyClaimed) + '</button></div>' +
    '<div class="sect"><div class="secthead"><h3>' + STR.login.connectWallet + '</h3></div>' +
    '<div style="padding:12px;border-radius:14px;background:#131a3d;border:1.5px solid #0a1028">' +
    (S.wallet
      ? '<div class="addr">' + esc(S.wallet) + '</div><div class="hint" style="margin-top:8px">' +
        STR.login.linked(esc(STR.wallet.kindLabel(S.walletKind || ''))) + '</div>'
      : '<div class="hint">' + STR.login.pitch + '</div>') +
    '</div>' +
    (S.wallet ? '' : '<button class="btn green" id="lWallet" style="width:100%;margin-top:10px">' + STR.login.connectButton + '</button>') +
    '</div>' +
    '<div style="height:8px"></div>';

  const g = must('#dayGrid');
  LOGIN_REWARDS.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'day' + (i < S.login.day ? ' claimed' : '') + (i === S.login.day && ready ? ' today' : '');
    el.innerHTML =
      '<div class="dl">' + STR.login.day(i) + '</div><div class="di">' + r.i + '</div><div class="dv">' + r.n + '</div>';
    g.appendChild(el);
  });

  const b = $<HTMLButtonElement>('#claimDay');
  if (b) b.onclick = () => void claimLogin(body, b);
  const w = $<HTMLButtonElement>('#lWallet');
  if (w) w.onclick = () => openWallet();
}

/** L2875-2887 */
async function claimLogin(body: HTMLElement, btn: HTMLButtonElement): Promise<void> {
  if (!loginReady(S)) return;
  btn.disabled = true;
  try {
    const res = await api.claimLogin();
    setSave(res.save);
    refreshHeader();
    Snd.coin();
    markDots();
    if (res.chest) {
      // Day 3, 6 and 7 pay a chest; the server has already rolled and granted it.
      openChestFlow({ kind: res.chest.kind, result: Promise.resolve(res.chest.result) });
    } else {
      toastTop(STR.login.claimedToast(res.reward.n));
      renderLogin(body);
    }
  } catch (err) {
    btn.disabled = false;
    toastTop(apiMessage(err));
  }
}
