/**
 * Home tab + header — crown-clash.html L2396-2586.
 *
 * Three prototype behaviours are deliberately restructured here:
 *
 *  - **B1 (bug fix).** The prototype called `$('#homeBody').addEventListener('click', …)`
 *    from *inside* `refreshHome()` (L2538), so the Nth visit to Home attached the Nth
 *    BATTLE handler and fired `findMatch()` N times. Bound once, behind a guard.
 *  - **Landing.** The prototype nested the whole landing-page bootstrap inside
 *    `refreshHome()` as an IIFE (L2451-2536), re-running canvas work and re-appending the
 *    card fan on every Home render. It moved to `landing.ts` and runs once at boot.
 *  - **Chests.** Contents and the free-chest timer are server state now. The client asks,
 *    the server rolls, `setSave()` applies the answer; the tap animation only plays what it
 *    was given (handoff §5).
 */
import { ARENAS, CARD, CHESTS, arenaFor, clamp, fmt, hms, nowMs , TELEMETRY } from '@crown/shared';
import type { ChestKey } from '@crown/shared';
import { $, must } from '../dom';
import { Art, Snd, fitCanvas } from '../engine';
import { S, onSaveChange, setSave } from '../api/store';
import { api } from '../api/client';
import { track } from '../telemetry';
import { STR } from './strings';
import { cardNode } from './cards';
import { openChestFlow } from './chest';
import { findMatch } from './matchmaking';
import { bindLeaderboardEntry, openLeaderboard, renderLeaderboardBlock } from './leaderboard';
import { openSettings } from './settings';
import { openWallet } from './wallet';

export { initLanding } from './landing';

/* ------------------------------------------------------------------ template */

let cachedHomeHtml: string | null = null;

/**
 * L2405 — the prototype captured `#homeBody`'s markup into `HOME_HTML` during `init()` and
 * restored it whenever the Home tab was re-entered. Captured lazily on first use instead, so
 * no boot-order contract leaks into `main.ts`; `setTab()` calls this before it can ever
 * overwrite the element.
 */
export function homeTemplate(): string {
  if (cachedHomeHtml === null) cachedHomeHtml = must('#homeBody').innerHTML;
  return cachedHomeHtml;
}

/* -------------------------------------------------------------------- header */

let headerBound = false;

function bindHeaderOnce(): void {
  if (headerBound) return;
  headerBound = true;
  // L2932-2933 — module-scope in the prototype, so still one-shot here.
  must('#walletBtn').onclick = () => {
    Snd.init();
    openWallet();
  };
  must('#avatarBox').onclick = () => openSettings();
  // The save is authoritative and can change without the screen asking (match rewards,
  // wallet bonus, another tab's claim). Repainting the header on every change is cheap and
  // removes a whole class of "the gold counter is stale" bugs the prototype lived with.
  onSaveChange(() => refreshHeader());
}

/** L2399-2406 */
export function refreshHeader(): void {
  bindHeaderOnce();
  must('#hName').textContent = S.name;
  must('#hLvl').textContent = String(S.lvl);
  must('#hTro').textContent = String(S.trophies);
  must('#hGold').textContent = fmt(S.gold);
  must('#hGem').textContent = fmt(S.gem);
  const avatarText = must('#avatarBox').firstChild;
  if (avatarText) avatarText.textContent = S.avatar;
  const w = must('#walletBtn');
  if (S.wallet) {
    w.classList.add('linked');
    w.textContent = '🟢';
    w.title = S.wallet;
  } else {
    w.classList.remove('linked');
    w.textContent = '🔗';
    w.title = 'Connect wallet';
  }
}

/* ---------------------------------------------------------------- mini arena */

/** L2422-2440 — the blurred arena thumbnail behind the BATTLE card. */
export function drawMiniArena(cv: HTMLCanvasElement | null): void {
  if (!cv) return;
  const w = cv.clientWidth || 320;
  const h = cv.clientHeight || 180;
  const c = fitCanvas(cv, w, h);
  const { a } = arenaFor(S.trophies);
  c.fillStyle = a.g2;
  c.fillRect(0, 0, w, h);
  c.fillStyle = a.g1;
  for (let y = 0; y < h; y += 22) for (let x = ((y / 22) % 2) * 22; x < w; x += 44) c.fillRect(x, y, 22, 22);
  const rg = c.createLinearGradient(0, h * 0.45, 0, h * 0.55);
  rg.addColorStop(0, '#2f6fa8');
  rg.addColorStop(0.5, '#4fb0e8');
  rg.addColorStop(1, '#2f6fa8');
  c.fillStyle = rg;
  c.fillRect(0, h * 0.45, w, h * 0.1);
  [w * 0.2, w * 0.7].forEach((bx) => {
    c.fillStyle = '#8a6234';
    c.fillRect(bx, h * 0.42, w * 0.1, h * 0.16);
    c.strokeStyle = 'rgba(52,32,12,.55)';
    c.lineWidth = 1.4;
    for (let i = 1; i < 5; i++) {
      c.beginPath();
      c.moveTo(bx, h * 0.42 + h * 0.16 * (i / 5));
      c.lineTo(bx + w * 0.1, h * 0.42 + h * 0.16 * (i / 5));
      c.stroke();
    }
  });
  const spots: [number, number, 0 | 1][] = [
    [0.22, 0.2, 1],
    [0.78, 0.2, 1],
    [0.22, 0.8, 0],
    [0.78, 0.8, 0],
  ];
  spots.forEach((p) => {
    c.save();
    c.translate(w * p[0], h * p[1]);
    Art.tower(c, 'princess', p[2], { s: h * 0.095 });
    c.restore();
  });
}

/* ---------------------------------------------------------------------- home */

let homeBound = false;

/**
 * B1 — bound once for the lifetime of the page, not once per Home render.
 *
 * The prototype bound this *inside* `refreshHome()`, so every visit to the Home tab attached
 * another BATTLE handler and the Nth visit fired `findMatch()` N times. This module is the
 * sole owner of the delegate; `findMatch()` also holds a synchronous `searching` guard, so a
 * double tap cannot stack two matchmaking modals either.
 */
function bindHomeOnce(): void {
  if (homeBound) return;
  homeBound = true;
  must('#homeBody').addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && typeof target.closest === 'function' && target.closest('#lbMore')) {
      void openLeaderboard();
      return;
    }
    // `#btnBattle` lives inside the markup `setTab('home')` re-injects, so the listener has
    // to sit on the container and delegate — that part of the prototype was right.
    if (target && typeof target.closest === 'function' && target.closest('#btnBattle')) void findMatch();
  });
}

/** L2442-2545 — everything except the landing IIFE, which moved to `landing.ts`. */
export function refreshHome(): void {
  bindHomeOnce();
  refreshHeader();
  const { a, i } = arenaFor(S.trophies);
  must('#hArenaN').textContent = String(i + 1);
  must('#hArenaName').textContent = a.n;
  const nxt = ARENAS[i + 1];
  const lo = a.t;
  const hi = nxt ? nxt.t : a.t + 600;
  must('#hTroBar').style.width = clamp(((S.trophies - lo) / (hi - lo)) * 100, 3, 100) + '%';
  must('#hTroNow').textContent = STR.home.trophies(S.trophies);
  must('#hTroNext').textContent = nxt ? STR.home.nextArena(nxt.t) : STR.home.topArena;
  must('#stWin').textContent = String(S.wins);
  must('#stLose').textContent = String(S.losses);
  must('#stBest').textContent = String(S.best);
  drawMiniArena($<HTMLCanvasElement>('#arenaMini'));

  /* deck */
  const dr = must('#homeDeck');
  dr.innerHTML = '';
  let tot = 0;
  S.deck.forEach((cid) => {
    tot += CARD[cid].cost;
    dr.appendChild(cardNode(cid));
  });
  must('#deckAvg').textContent = STR.home.deckAvg((tot / 8).toFixed(1));
  renderChests();

  // Fire-and-forget: the board is nice to have, and Home must paint without waiting on it.
  const lb = $('#lbBlock');
  if (lb) void renderLeaderboardBlock(lb);
  bindLeaderboardEntry();
}

/* -------------------------------------------------------------------- chests */

/**
 * Open a chest the server owns.
 *
 * The request goes out *before* the modal so the network round-trip overlaps the three or
 * four taps of the opening animation — by the time the lid is up the contents are usually
 * already in hand. The client never rolls; it only animates what came back (handoff §5).
 */
function openServerChest(kind: ChestKey, source: 'free' | 'pending', index?: number): void {
  openChestFlow({
    kind,
    result: api.openChest({ source, index }).then((r) => {
      track(TELEMETRY.chestOpen, {
        kind: r.kind,
        source,
        gold: r.result.gold,
        gem: r.result.gem,
        cards: r.result.cards.reduce((a, c) => a + c.n, 0),
      });
      setSave(r.save);
      return r.result;
    }),
  });
}

/** L2547-2582 */
export function renderChests(): void {
  const row = $('#chestRow');
  if (!row) return;
  row.innerHTML = '';

  /* peti gratis */
  const left = Math.max(0, S.freeChestAt - nowMs());
  const free = document.createElement('div');
  free.className = 'chestslot';
  const fc = document.createElement('canvas');
  free.appendChild(fc);
  free.insertAdjacentHTML(
    'beforeend',
    '<div class="cn">' + STR.chests.free + '</div><div class="cs">' +
      (left > 0 ? STR.chests.countdown(hms(left)) : STR.chests.ready) + '</div>',
  );
  const fb = document.createElement('button');
  fb.className = 'btn go ' + (left > 0 ? 'ghost' : 'green');
  fb.textContent = left > 0 ? STR.chests.locked : STR.chests.open;
  fb.disabled = left > 0;
  fb.onclick = () => {
    // The prototype set `S.freeChestAt = nowMs() + 3h` here. The server owns that timer now;
    // disabling the button is only there to stop a double-tap racing the 1-per-2s limit.
    fb.disabled = true;
    openServerChest('wooden', 'free');
  };
  free.appendChild(fb);
  row.appendChild(free);
  requestAnimationFrame(() => {
    const c = fitCanvas(fc, 74, 74);
    c.translate(37, 34);
    Art.chest(c, 'wooden', { s: 56 });
  });

  /* peti tertunda */
  if (S.pendingChests.length) {
    S.pendingChests.slice(0, 3).forEach((k, idx) => {
      const el = document.createElement('div');
      el.className = 'chestslot';
      const cv = document.createElement('canvas');
      el.appendChild(cv);
      el.insertAdjacentHTML(
        'beforeend',
        '<div class="cn">' + CHESTS[k].n + '</div><div class="cs">' + STR.chests.battleReward + '</div>',
      );
      const b = document.createElement('button');
      b.className = 'btn go green';
      b.textContent = STR.chests.open;
      b.onclick = () => {
        // The prototype spliced by value (`indexOf(k)`), which popped the *first* chest of
        // that kind rather than the one tapped. Only the first three are rendered and the
        // slice preserves order, so the rendered index is the real queue index — send that.
        b.disabled = true;
        openServerChest(k, 'pending', idx);
      };
      el.appendChild(b);
      row.appendChild(el);
      requestAnimationFrame(() => {
        const c = fitCanvas(cv, 74, 74);
        c.translate(37, 34);
        Art.chest(c, k, { s: 56 });
      });
    });
  } else {
    const el = document.createElement('div');
    el.className = 'chestslot';
    const cv = document.createElement('canvas');
    el.appendChild(cv);
    el.insertAdjacentHTML(
      'beforeend',
      '<div class="cn">' + STR.chests.emptySlot + '</div><div class="cs">' + STR.chests.winABattle + '</div>',
    );
    const b = document.createElement('button');
    b.className = 'btn go gold';
    b.textContent = STR.chests.play;
    b.onclick = () => void findMatch();
    el.appendChild(b);
    row.appendChild(el);
    requestAnimationFrame(() => {
      const c = fitCanvas(cv, 74, 74);
      c.translate(37, 34);
      c.globalAlpha = 0.3;
      Art.chest(c, 'silver', { s: 56 });
    });
  }
  must('#chestHint').textContent = S.pendingChests.length
    ? STR.chests.waiting(S.pendingChests.length)
    : STR.chests.hintNone;
}
