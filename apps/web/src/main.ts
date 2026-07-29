/**
 * Entry point — crown-clash.html L2982-3013.
 *
 * The prototype's `init()` read a local key-value save and started rendering. This one signs
 * in, pulls the authoritative save from the server, runs the one-time local-save migration,
 * and only then paints. The offline path still works: `boot()` falls back to the IndexedDB
 * cache so a player on a dead connection sees their account instead of a spinner.
 */
import { ApiFailure, api } from './api/client';
import { drainQueue, queueIntent } from './api/offline';
import { S, boot, onSaveChange, refresh, setSave } from './api/store';
import { initBattle, sizeArena, startBattle, stopBattle } from './battle';
import { $, $$, must } from './dom';
import { Snd, setSfxEnabled } from './engine';
import { bindModals, closeModal, openModal } from './ui/modal';
import { toastTop } from './ui/toast';
import { markDots, setTab } from './ui/tabs';
import { drawMiniArena, initLanding, refreshHeader, renderChests } from './screens/home';
import { findMatch } from './screens/matchmaking';
import { showResult } from './screens/result';
import type { DeployLogEntry } from '@crown/shared';

/** L2367-2370 — screen switcher. Leaving the battle screen tears the loop down. */
function go(id: string): void {
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  if (id !== 'battle') stopBattle();
}

/**
 * Match finished: hand the log to the server, which re-simulates it and decides the result.
 *
 * Whatever the client believes happened is irrelevant here — the response's `result` and
 * `rewards` are what the player is shown and what their save becomes. If the request fails we
 * queue it: the match was real, and a dropped connection at the final whistle should not cost
 * someone their trophies.
 */
async function finishMatch(matchId: string, deployLog: DeployLogEntry[]): Promise<void> {
  try {
    const res = await api.matchFinish({ matchId, deployLog });
    setSave(res.save);
    markDots();
    showResult(res, { onHome: () => { go('home'); setTab('home'); }, onAgain: () => void findMatch(startBattle) });
  } catch (err) {
    if (err instanceof ApiFailure && (err.isOffline || err.status >= 500)) {
      await queueIntent('match', { matchId, deployLog });
      toastTop('Offline — result will sync when you reconnect');
    } else {
      toastTop('Match could not be verified');
    }
    go('home');
    setTab('home');
  }
}

/** Replay anything that failed to send while offline. */
async function flushQueue(): Promise<void> {
  const sent = await drainQueue(async (intent) => {
    if (intent.kind === 'match') {
      const p = intent.payload as { matchId: string; deployLog: DeployLogEntry[] };
      const res = await api.matchFinish(p);
      setSave(res.save);
    } else if (intent.kind === 'profile') {
      const res = await api.updateProfile(intent.payload as Record<string, unknown>);
      setSave(res.save);
    }
  });
  if (sent > 0) {
    toastTop(sent === 1 ? '1 result synced' : `${sent} results synced`);
    markDots();
  }
}

/** L2998-3009 — first-run explainer. */
function welcome(): void {
  openModal(
      '<h2 class="goldtext">CROWN CLASH</h2><p class="sub">Real-time arena battler</p>' +
        '<div style="font-size:12.5px;color:#c3cdec;font-weight:700;line-height:1.75;padding:0 4px">' +
        '<div>⚡ <b>Elixir</b> isi ulang otomatis — maks 10.</div>' +
        '<div>🃏 Tap a card, then tap the arena to deploy.</div>' +
        '<div>🏰 Destroy enemy towers. King Tower down = instant win.</div>' +
        '<div>⏱️ 3 menit. Menit terakhir elixir jadi <b>2×</b>.</div>' +
        '<div>🎁 Win chests → collect cards → level them up.</div>' +
        '</div>' +
      '<button class="btn gold big" id="wGo" style="width:100%;margin-top:14px">GO!</button>',
  );
  const go2 = $('#wGo');
  if (go2) go2.onclick = () => closeModal();
}

async function init(): Promise<void> {
  bindModals();
  initBattle({ onFinish: (id, log) => void finishMatch(id, log), go });

  // The `#homeBody` (BATTLE) and `#navbar` delegates live in screens/home.ts and ui/tabs.ts,
  // each bound once behind its own guard. main.ts used to bind its own copies too, which meant
  // two handlers raced on every tap and both modules had to defend against the other. One
  // owner each is simpler and removes the coupling.

  let result: Awaited<ReturnType<typeof boot>>;
  try {
    result = await boot();
  } catch {
    toastTop('Could not reach the server — playing from your last saved state');
    result = { online: false, created: false, migrated: false };
  }

  setSfxEnabled(S.sfx);
  onSaveChange((s) => setSfxEnabled(s.sfx));

  initLanding(() => {
    Snd.init();
    if (Snd.ctx && Snd.ctx.state === 'suspended') void Snd.ctx.resume();
    Snd.crown();
  });

  refreshHeader();
  setTab('home');
  markDots();

  if (result.migrated) toastTop('Local progress imported');
  if (!S.seen) {
    S.seen = true;
    // Persist the dismissal server-side so the explainer does not reappear on another device.
    void api.updateProfile({ seen: true }).catch(() => undefined);
    setTimeout(welcome, 300);
  }
  if (result.online) void flushQueue();

  // L2996 — refresh the chest timers and notification dots every 30 s while on Home.
  setInterval(() => {
    const active = $$('.navbtn.on')[0];
    if (active && active.dataset.tab === 'home') {
      renderChests();
    }
    markDots();
  }, 30000);

  // Reconcile with the server whenever the tab regains focus — another device may have
  // played, and the free-chest timer is server-side.
  window.addEventListener('online', () => void flushQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refresh().then(() => { refreshHeader(); markDots(); }).catch(() => undefined);
      void flushQueue();
    }
  });
}

/* L3010-3012 — keep the arena sized through rotation and resize. */
if (typeof ResizeObserver !== 'undefined') {
  try {
    const wrap = $('#arenaWrap');
    if (wrap) new ResizeObserver(() => sizeArena()).observe(wrap);
  } catch {
    /* ResizeObserver unavailable; the resize listener below still covers most cases */
  }
}
window.addEventListener('resize', () => {
  try {
    sizeArena();
    const m = $<HTMLCanvasElement>('#arenaMini');
    if (m && m.clientWidth > 10) drawMiniArena(m);
  } catch {
    /* a resize during teardown must never break the app */
  }
});
window.addEventListener('orientationchange', () => setTimeout(() => sizeArena(), 250));

void init();
