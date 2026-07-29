/**
 * Post-match result modal — crown-clash.html L2939-2970.
 *
 * The prototype computed the entire payout here: trophy delta, gold, XP, quest bumps, the
 * win-chest roll and the pending-queue push (L2940-2954). None of that survives on the
 * client. `POST /match/finish` re-simulates the deploy log against the match's seed, decides
 * the result itself and applies the rewards; this module renders `MatchFinishResponse` and
 * nothing else (handoff §5 — "Client-claimed results are ignored").
 *
 * The banner, the crown row, the trophy delta line, the chest canvas and the two buttons are
 * the prototype's markup unchanged.
 */
import { CHESTS } from '@crown/shared';
import type { MatchFinishResponse } from '@crown/shared';
import { $, must } from '../dom';
import { Art, fitCanvas } from '../engine';
import { setSave } from '../api/store';
import { closeModal, lockModal, openModal } from '../ui/modal';
import { markDots, setTab } from '../ui/tabs';
import { leaveBattle } from './battleBridge';
import { refreshHeader } from './home';
import { findMatch } from './matchmaking';
import { STR } from './strings';

export interface ResultActions {
  /** HOME. Defaults to tearing the battle down and returning to the Home tab. */
  onHome?: () => void;
  /** PLAY AGAIN. Defaults to re-entering matchmaking. */
  onAgain?: () => void;
}

/**
 * L2939-2970
 *
 * @param actions Lets the host decide where the two buttons lead — `main.ts` routes them
 *                through its own `go()` so the battle teardown stays in one place. Omitted,
 *                the modal does the equivalent itself.
 */
export function showResult(res: MatchFinishResponse, actions: ResultActions = {}): void {
  // Idempotent: `battle.ts` may already have applied it. Doing it here too guarantees the
  // header, the dots and whichever tab we land on all read post-match numbers.
  setSave(res.save);

  const r = res.rewards;
  const c0 = res.crowns[0];
  const c1 = res.crowns[1];
  const banner = res.result === 'win' ? STR.result.win : res.result === 'lose' ? STR.result.lose : STR.result.draw;
  const chest = r.chest;

  lockModal(true);
  openModal(
    '<div class="resbanner goldtext" style="' + (res.result === 'lose' ? 'filter:grayscale(.6)' : '') + '">' +
      banner + '</div>' +
      '<div class="crowbig"><div><div class="cv">' + STR.result.crownsMe(c0) + '</div><div class="cl">' +
      STR.result.you + '</div></div>' +
      '<div style="align-self:center;color:#67759f">' + STR.result.vs + '</div>' +
      '<div><div class="cv">' + STR.result.crownsThem(c1) + '</div><div class="cl">' + STR.result.rival +
      '</div></div></div>' +
      '<div class="deltarow"><span>' + STR.result.trophyBefore(r.trophiesBefore) + '<b style="color:' +
      (r.delta >= 0 ? '#5fe698' : '#ff8a8a') + '">' + r.trophiesAfter + '</b></span><span>' +
      STR.result.goldDelta(r.gold) + '</span></div>' +
      (chest
        ? '<div style="text-align:center"><canvas id="resChest" style="width:110px;height:110px"></canvas><div style="font-size:13px">' +
          STR.result.chestEarned(CHESTS[chest].n) + '</div></div>'
        : '') +
      // No prototype equivalent — a match the server refused to validate pays nothing, and
      // silently showing a zero delta would look like a bug.
      (res.voided ? '<div class="hint" style="margin-top:10px" id="resVoid"></div>' : '') +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button class="btn ghost" id="resHome" style="flex:1">' + STR.result.home + '</button>' +
      '<button class="btn gold" id="resAgain" style="flex:1">' + STR.result.again + '</button></div>',
  );

  if (res.voided) {
    // textContent: the reason string comes from the server.
    const v = $('#resVoid');
    if (v) v.textContent = STR.result.voided(res.voided.reason);
  }
  if (chest) {
    const cv = $<HTMLCanvasElement>('#resChest');
    if (cv) {
      const c = fitCanvas(cv, 110, 110);
      c.translate(55, 52);
      Art.chest(c, chest, { s: 74 });
    }
  }

  refreshHeader();
  markDots();

  must<HTMLButtonElement>('#resHome').onclick = () => {
    lockModal(false);
    closeModal();
    if (actions.onHome) {
      actions.onHome();
      return;
    }
    // `leaveBattle()` is the prototype's `go('home')` — it also lets the battle screen cancel
    // its rAF and drop the sim, which `go()` did inline.
    leaveBattle();
    setTab('home');
  };
  must<HTMLButtonElement>('#resAgain').onclick = () => {
    lockModal(false);
    closeModal();
    if (actions.onAgain) actions.onAgain();
    else void findMatch();
  };
}
