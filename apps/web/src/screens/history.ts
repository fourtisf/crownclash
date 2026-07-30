/**
 * Battle log — recent matches, and replays of them.
 *
 * Every finished match was already written to the database to justify a payout: the seed, the
 * `SimConfig` frozen at start, the AI deck and level, and the full deploy log. The sim is
 * deterministic, so those rows are a replay archive that has existed since the first commit
 * with nothing reading it. This screen is the reader.
 *
 * A voided match is still listed. It happened, the player remembers playing it, and quietly
 * omitting it would be more confusing than showing it greyed out.
 */
import type { MatchHistoryResponse, MatchSummary } from '@crown/shared';
import { api } from '../api/client';
import { Snd } from '../engine';
import { startReplay } from '../battle';
import { toastTop } from '../ui/toast';
import { STR, esc } from './strings';
import { apiMessage } from './errors';

/**
 * Cached like the leaderboard, and for the same reason: Home is the most-visited screen and
 * this must not put a request on its critical path. Invalidated when a match finishes.
 */
let cache: { at: number; data: MatchHistoryResponse } | null = null;
const TTL_MS = 60_000;

export function invalidateHistory(): void {
  cache = null;
}

async function load(): Promise<MatchHistoryResponse> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = await api.matchHistory();
  cache = { at: Date.now(), data };
  return data;
}

/** `12m ago`, `3h ago`, `2d ago`. Short enough to sit in a row on a phone. */
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function row(m: MatchSummary): string {
  const cls = m.result === 'win' ? 'win' : m.result === 'lose' ? 'lose' : 'draw';
  return (
    '<div class="hrow ' + cls + (m.replayable ? '' : ' dead') + '" data-match="' + esc(m.matchId) + '">' +
    '<div class="hres">' + STR.replay.result(m.result) + '</div>' +
    '<div class="hmid">' +
    '<div class="hopp">' + esc(m.opponentAvatar) + ' ' + esc(m.opponentName) + '</div>' +
    '<div class="hsub">' + esc(m.crowns[0] + '–' + m.crowns[1]) + ' 👑 · ' + esc(ago(m.at)) + '</div>' +
    '</div>' +
    '<div class="hdelta">' + STR.replay.delta(m.trophyDelta) + '</div>' +
    '<div class="hplay">' + (m.replayable ? STR.replay.watch : '·') + '</div>' +
    '</div>'
  );
}

/**
 * Render the Home block.
 *
 * Fails quietly, like the leaderboard: a battle log that cannot load should leave Home looking
 * normal rather than put an error where the player expects their chests.
 */
export async function renderHistoryBlock(host: HTMLElement): Promise<void> {
  try {
    const data = await load();
    if (!data.matches.length) {
      host.innerHTML = '<div class="hint" style="padding:6px 2px">' + STR.replay.empty + '</div>';
      return;
    }
    host.innerHTML = data.matches.slice(0, 5).map(row).join('');
  } catch {
    host.innerHTML = '<div class="hint" style="padding:6px 2px">' + STR.replay.unavailable + '</div>';
  }
}

/** Fetch one replay and hand it to the battle screen. */
export async function watchReplay(matchId: string): Promise<void> {
  Snd.init();
  toastTop(STR.replay.loading);
  try {
    const data = await api.matchReplay(matchId);
    startReplay(data);
  } catch (err) {
    toastTop(apiMessage(err, STR.replay.failed));
  }
}
