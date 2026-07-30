/**
 * Leaderboard.
 *
 * `/api/leaderboard` has worked since the server was written, and `api.leaderboard()` was
 * already in the client — but nothing ever called it, so no player could see a ranking. That
 * left the game with no visible goal past the arena you are currently in: trophies went up,
 * and nothing anywhere said what they were for.
 *
 * Two surfaces, one fetch each:
 *  - a compact top-5 block on Home, so it is seen without being sought;
 *  - the full top-100 in a modal, opened from that block or from the trophy count.
 */
import { fmt } from '@crown/shared';
import type { LeaderboardEntry, LeaderboardResponse } from '@crown/shared';
import { $, must } from '../dom';
import { api } from '../api/client';
import { S } from '../api/store';
import { Snd } from '../engine';
import { openModal } from '../ui/modal';
import { STR, esc } from './strings';
import { apiMessage } from './errors';

/**
 * Cached across tab switches. The board barely moves minute to minute, and re-fetching on
 * every visit to Home would put a request on the critical path of the most-used screen.
 */
let cache: { at: number; data: LeaderboardResponse } | null = null;
const TTL_MS = 60_000;

async function load(force = false): Promise<LeaderboardResponse> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = await api.leaderboard();
  cache = { at: Date.now(), data };
  return data;
}

/** One row. `me` is highlighted so a player can find themselves in a list of a hundred. */
function row(e: LeaderboardEntry, me: boolean): string {
  const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : String(e.rank);
  return (
    '<div class="lbrow' + (me ? ' me' : '') + '">' +
    '<div class="lbrank">' + medal + '</div>' +
    '<div class="lbav">' + esc(e.avatar) + '</div>' +
    '<div class="lbname">' + esc(e.name) + '</div>' +
    '<div class="lbtro">🏆 ' + fmt(e.trophies) + '</div>' +
    '</div>'
  );
}

/**
 * Render the Home block into `host`.
 *
 * Fails quietly: a leaderboard that cannot load should leave the Home screen looking normal,
 * not put an error where a player expects their chests.
 */
export async function renderLeaderboardBlock(host: HTMLElement): Promise<void> {
  try {
    const data = await load();
    const top = data.entries.slice(0, 5);
    if (!top.length) {
      host.innerHTML = '<div class="hint" style="padding:6px 2px">' + STR.leaderboard.empty + '</div>';
      return;
    }
    // Pin the player's own row whenever it is not already in the slice being shown — asking
    // whether `rank > 5` is not the same question. The top-100 is cached server-side
    // (`LEADERBOARD_TTL_SEC`) while rank is computed live, so a player who climbed in the last
    // few seconds gets a real rank and an entry list that has not caught up yet. Reading it as
    // "rank 1, so no need to pin" dropped them off their own leaderboard entirely.
    const shown = top.some((e) => e.me);
    const mine = data.me && !shown ? '<div class="lbsep"></div>' + row(data.me, true) : '';
    host.innerHTML = top.map((e) => row(e, !!e.me)).join('') + mine;
  } catch {
    host.innerHTML = '<div class="hint" style="padding:6px 2px">' + STR.leaderboard.unavailable + '</div>';
  }
}

/** Full top-100 in a modal. */
export async function openLeaderboard(): Promise<void> {
  Snd.init();
  const m = openModal(
    '<button class="xbtn" data-close>✕</button><h2 class="goldtext">' + STR.leaderboard.title + '</h2>' +
      '<p class="sub">' + STR.leaderboard.sub + '</p>' +
      '<div id="lbList" class="lblist"><div class="hint" style="padding:14px 0">' + STR.leaderboard.loading + '</div></div>',
  );
  const list = $('#lbList', m);
  if (!list) return;
  try {
    const data = await load(true);
    if (!data.entries.length) {
      list.innerHTML = '<div class="hint" style="padding:14px 0">' + STR.leaderboard.empty + '</div>';
      return;
    }
    // Same rule as the Home block: pin the player's row only when the list does not already
    // contain it. Matching on rank as well would double it up whenever the cached entry and
    // the live rank disagree, which is precisely when the cache is doing its job.
    const inTop = data.entries.some((e) => e.me);
    list.innerHTML =
      data.entries.map((e) => row(e, !!e.me)).join('') +
      (data.me && !inTop ? '<div class="lbsep"></div>' + row(data.me, true) : '');
    // Bring the player's own row into view rather than making them hunt for it.
    const meRow = list.querySelector('.lbrow.me');
    if (meRow) meRow.scrollIntoView({ block: 'center' });
  } catch (err) {
    list.innerHTML = '<div class="hint" style="padding:14px 0">' + esc(apiMessage(err)) + '</div>';
  }
}

/** Invalidate after a match, so a rank change is visible on the next Home render. */
export function invalidateLeaderboard(): void {
  cache = null;
}

/** Wire the trophy readout in the top bar as a second way in. Bound once. */
let bound = false;
export function bindLeaderboardEntry(): void {
  if (bound) return;
  bound = true;
  const tro = must('.ptro');
  tro.style.cursor = 'pointer';
  tro.addEventListener('click', () => void openLeaderboard());
}
