/**
 * Bottom nav + tab routing — crown-clash.html L2407-2419 and L2973-2978.
 *
 * The five meta tabs all share one container, `#homeBody`. Home is restored from a snapshot
 * of the markup that shipped in `index.html`; the other four render themselves into the same
 * element. That is the prototype's design and it stays, because the CSS (`.homebody`
 * scroll/padding) is written against exactly that one element.
 */
import { $$, must } from '../dom';
import { Snd } from '../engine';
import { S } from '../api/store';
import { loginReady, nowMs, questsReady } from '@crown/shared';
import { homeTemplate, refreshHome } from '../screens/home';
import { renderCardsTab } from '../screens/cards';
import { renderShop } from '../screens/shop';
import { renderQuests } from '../screens/quests';
import { renderLogin } from '../screens/login';

export type TabName = 'home' | 'cards' | 'shop' | 'quest' | 'login';

const TABS: readonly TabName[] = ['home', 'cards', 'shop', 'quest', 'login'];

function isTab(v: string | undefined): v is TabName {
  return !!v && (TABS as readonly string[]).includes(v);
}

let bound = false;

/**
 * L2415-2418 — the navbar delegate.
 *
 * Bound once, lazily, from `setTab()`. The prototype bound it at module scope, which was
 * inherently one-shot; doing it here keeps that property without requiring `main.ts` to
 * remember an extra init call. (Contrast B1 in docs/EXTRACTION-PLAN.md: the prototype's
 * `#homeBody` handler *was* inside a render function and multiplied on every visit.)
 */
function ensureBound(): void {
  if (bound) return;
  bound = true;
  // Snapshot the pristine home markup before anything can overwrite `#homeBody`.
  homeTemplate();
  must('#navbar').addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const b = target && target.closest<HTMLElement>('.navbtn');
    if (!b) return;
    // No `.on` guard: L2415-2418 re-renders on every tap, including the active tab, and the
    // chest timers on Home are worth refreshing that way.
    Snd.init();
    Snd.play(660, 0.05, 'triangle', 0.05);
    const name = b.dataset.tab;
    if (isTab(name)) setTab(name);
  });
}

/** The tab currently marked `.on`. Home is the fallback, matching the initial markup. */
export function currentTab(): TabName {
  const on = $$('.navbtn').find((b) => b.classList.contains('on'));
  const name = on?.dataset.tab;
  return isTab(name) ? name : 'home';
}

/**
 * L2408-2414
 *
 * Takes a plain `string` rather than `TabName` because the call sites read it straight off
 * `dataset.tab`, exactly as the prototype did. An unrecognised name toggles the nav (nothing
 * matches, so every button clears) and renders nothing — the prototype's if/else chain
 * behaved identically.
 */
export function setTab(name: TabName | string): void {
  ensureBound();
  $$('.navbtn').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  const body = must('#homeBody');
  body.scrollTop = 0;
  if (name === 'home') {
    body.innerHTML = homeTemplate();
    refreshHome();
  } else if (name === 'cards') renderCardsTab(body);
  else if (name === 'shop') renderShop(body);
  else if (name === 'quest') renderQuests(body);
  else if (name === 'login') renderLogin(body);
}

/**
 * L2973-2978 — the unread dots on the nav buttons.
 *
 * The prototype's `questsReady()` called `checkQuests()` first, which could roll a fresh
 * quest set client-side. Quests are server state now (handoff §5), so this only *reads*:
 * if the local date rolled over, the server hands back a new set on the next request and the
 * dot appears then. Rolling here would show three quests that the server has never seen.
 */
export function markDots(): void {
  $$('.navbtn').forEach((b) => {
    const d = b.querySelector('.dot');
    if (d) d.remove();
  });
  const add = (tab: TabName): void => {
    const b = $$('.navbtn').find((x) => x.dataset.tab === tab);
    if (b && !b.querySelector('.dot')) {
      const s = document.createElement('span');
      s.className = 'dot';
      b.appendChild(s);
    }
  };
  if (questsReady(S)) add('quest');
  if (loginReady(S)) add('login');
  if (S.pendingChests.length || nowMs() >= S.freeChestAt) add('home');
}
