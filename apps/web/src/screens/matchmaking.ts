/**
 * Matchmaking modal — crown-clash.html L1407-1433.
 *
 * The UX is unchanged: a locked modal, the opponent avatar shuffling every 110 ms, "Opponent
 * found!" at ~900 ms, then ~780 ms of victory-lap before the battle screen takes over.
 *
 * What drives it changed. The prototype invented the opponent locally
 * (`pick(AI_NAMES)`, `S.trophies + rndi(-45,45)`). Now `POST /match/start` returns the
 * match id, the seed, the AI deck index and level, and the opponent's name/avatar/trophies —
 * because the server re-simulates the match from that same seed and deck when the deploy log
 * comes back (handoff §3.3). If the client picked the opponent, the re-sim could not agree.
 *
 * The 900 ms is a floor, not a timer: if the request is slower the shuffle keeps running,
 * and if it is faster the reveal still waits so the beat feels the same on every connection.
 */
import { AI_AVATARS } from '@crown/shared';
import type { MatchStartResponse } from '@crown/shared';
import { $ } from '../dom';
import { Snd } from '../engine';
import { S } from '../api/store';
import { api } from '../api/client';
import { startBattle } from '../battle';
import { closeModal, lockModal, openModal } from '../ui/modal';
import { toastTop } from '../ui/toast';
import { STR, esc } from './strings';
import { apiMessage } from './errors';

/** What `findMatch` hands the started match to. `battle.ts`'s `startBattle` is the default. */
export type BattleStarter = (session: MatchStartResponse) => void;

/** Guards against the BATTLE button being tapped twice (the endpoint is 1-per-10s). */
let searching = false;

const pickAvatar = (): string => AI_AVATARS[Math.floor(Math.random() * AI_AVATARS.length)];
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * L1407-1433
 *
 * @param starter Overridable so `main.ts` can inject its own battle entry point (and so a
 *                test can assert what the server returned without opening the arena). Left
 *                out, the match goes straight to `battle.ts`.
 */
export async function findMatch(starter: BattleStarter = startBattle): Promise<void> {
  if (searching) return;
  searching = true;

  Snd.init();
  if (Snd.ctx && Snd.ctx.state === 'suspended') void Snd.ctx.resume();

  lockModal(true);
  openModal(
    '<h2 class="goldtext">' + STR.mm.title + '</h2><p class="sub" id="mmSub">' + STR.mm.connecting + '</p>' +
      '<div style="display:flex;align-items:center;justify-content:space-around;margin:18px 0">' +
      '<div style="text-align:center"><div style="width:62px;height:62px;border-radius:16px;display:grid;place-items:center;font-size:30px;background:linear-gradient(160deg,#3f8bff,#16307a);box-shadow:inset 0 2px 0 rgba(255,255,255,.35)">' +
      esc(S.avatar) + '</div>' +
      '<div style="font-size:12px;margin-top:6px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      esc(S.name) + '</div>' +
      '<div style="font-size:11px;color:var(--gold)">' + STR.mm.trophies(S.trophies) + '</div></div>' +
      '<div class="goldtext" style="font-size:26px">' + STR.mm.vs + '</div>' +
      '<div style="text-align:center" id="mmOpp"><div id="mmAv" style="width:62px;height:62px;border-radius:16px;display:grid;place-items:center;font-size:26px;background:linear-gradient(160deg,#5a6488,#22283f);animation:pulse .5s infinite">?</div>' +
      '<div style="font-size:12px;margin-top:6px" id="mmName">' + STR.mm.unknownName + '</div>' +
      '<div style="font-size:11px;color:var(--gold)" id="mmTro">' + STR.mm.unknownTrophies + '</div></div>' +
      '</div>',
  );
  Snd.play(500, 0.08, 'triangle', 0.05);

  const tick = window.setInterval(() => {
    const av = $('#mmAv');
    if (av) av.textContent = pickAvatar();
  }, 110);

  try {
    // Both legs run together: the shuffle is a floor on the perceived wait, not a delay
    // added on top of the request.
    const [session] = await Promise.all([api.matchStart(), delay(900)]);
    clearInterval(tick);

    const av = $('#mmAv');
    if (av) {
      av.textContent = session.aiAvatar;
      av.style.animation = 'none';
      av.style.background = 'linear-gradient(160deg,#ff6a6a,#8f1f1f)';
    }
    const nm = $('#mmName');
    if (nm) nm.textContent = session.aiName;
    const tr = $('#mmTro');
    if (tr) tr.textContent = STR.mm.trophies(session.aiTrophies);
    const sub = $('#mmSub');
    if (sub) sub.textContent = STR.mm.found;
    Snd.crown();

    await delay(780);
    lockModal(false);
    closeModal();
    starter(session);
  } catch (err) {
    clearInterval(tick);
    lockModal(false);
    closeModal();
    toastTop(apiMessage(err, STR.mm.failed));
  } finally {
    searching = false;
  }
}
