/**
 * Quests tab — crown-clash.html L2823-2849.
 *
 * The prototype called `checkQuests()` at the top of the render, which could roll a brand
 * new quest set client-side. Quest state is the server's now (handoff §5: rewards applied
 * server-side only), so this renders `S.quests` as-is: if the local date has rolled over,
 * the server hands back a fresh set on the next request and the tab repaints then. Rolling
 * here would show three quests the server has never heard of and every claim would fail.
 */
import { clamp, fmt } from '@crown/shared';
import { must } from '../dom';
import { Snd } from '../engine';
import { S, setSave } from '../api/store';
import { api } from '../api/client';
import { toastTop } from '../ui/toast';
import { markDots } from '../ui/tabs';
import { refreshHeader } from './home';
import { STR } from './strings';
import { apiMessage } from './errors';

/** L2823-2849 */
export function renderQuests(body: HTMLElement): void {
  body.innerHTML =
    '<div class="sect" style="margin-top:4px"><div class="secthead"><h3>' + STR.quests.title +
      '</h3><span class="pill">' + STR.quests.resets + '</span></div><div id="qList"></div></div>' +
    '<div class="sect"><div class="secthead"><h3>' + STR.quests.careerTotals + '</h3></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    '<div class="chestslot" style="padding:10px"><div class="cn">' + fmt(S.stats.depl) +
      '</div><div class="cs">' + STR.quests.troopsDeployed + '</div></div>' +
    '<div class="chestslot" style="padding:10px"><div class="cn">' + fmt(Math.round(S.stats.dmg)) +
      '</div><div class="cs">' + STR.quests.towerDamage + '</div></div>' +
    '<div class="chestslot" style="padding:10px"><div class="cn">' + fmt(S.stats.crown) +
      '</div><div class="cs">' + STR.quests.towersDestroyed + '</div></div>' +
    '<div class="chestslot" style="padding:10px"><div class="cn">' + fmt(S.stats.chests) +
      '</div><div class="cs">' + STR.quests.chestOpened + '</div></div>' +
    '</div></div><div style="height:8px"></div>';

  const L = must('#qList');
  S.quests.list.forEach((q, idx) => {
    const done = q.prog >= q.goal;
    const el = document.createElement('div');
    el.className = 'qrow';
    el.innerHTML =
      '<div class="qi">' + q.i + '</div><div class="qt"><div class="qn">' + q.n + '</div>' +
      '<div class="qbar"><i class="' + (done ? 'done' : '') + '" style="width:' +
        clamp((q.prog / q.goal) * 100, 0, 100) + '%"></i></div>' +
      '<div class="qp">' + STR.quests.progress(fmt(q.prog), fmt(q.goal), q.rw.gold, q.rw.gem) + '</div></div>';
    const b = document.createElement('button');
    b.className = 'btn qclaim ' + (q.claimed ? 'ghost' : done ? 'gold' : 'ghost');
    b.textContent = q.claimed ? STR.quests.claimed : done ? STR.quests.claim : STR.quests.notYet;
    b.disabled = q.claimed || !done;
    b.onclick = async () => {
      b.disabled = true;
      try {
        // The payout comes back from the server; the row's `q.rw` is only what we drew.
        const res = await api.claimQuest({ index: idx });
        setSave(res.save);
        Snd.coin();
        toastTop(STR.quests.reward(res.gold, res.gem));
        renderQuests(body);
        refreshHeader();
        markDots();
      } catch (err) {
        b.disabled = false;
        toastTop(apiMessage(err));
      }
    };
    el.appendChild(b);
    L.appendChild(el);
  });
}
