/**
 * Chest opening — crown-clash.html L2752-2802.
 *
 * The animation is the prototype's, beat for beat: three taps (four for magical and legend),
 * a wobble that grows with each tap, the rays, the 420 ms lid grow, a 480 ms beat, then the
 * reward cards popping in on a 120 ms stagger with a coin blip each.
 *
 * What changed is where the contents come from. `rollChest()` ran on the client in the
 * prototype; handoff §5 makes it server-only ("Server issues chest contents (seeded roll) —
 * client only animates"). The caller therefore hands in a *promise* of the roll, kicked off
 * before the modal opens so the round-trip hides behind the taps. If it is still in flight
 * when the lid finishes opening, the reveal waits for it; if it failed, the modal says so
 * instead of inventing cards.
 */
import { CARD, CHESTS, fmt } from '@crown/shared';
import type { ChestKey, ChestResult } from '@crown/shared';
import { $, must } from '../dom';
import { Art, Snd, fitCanvas, renderPortrait } from '../engine';
import { closeModal, lockModal, openModal } from '../ui/modal';
import { currentTab, setTab } from '../ui/tabs';
import { refreshHeader } from './home';
import { STR } from './strings';
import { apiMessage } from './errors';

export interface ChestFlow {
  /** Which chest to draw. Known before the roll lands — the art never depends on contents. */
  kind: ChestKey;
  /** The server's roll. Start the request before calling so it overlaps the animation. */
  result: Promise<ChestResult>;
}

type Settled = { ok: true; res: ChestResult } | { ok: false; msg: string };

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** L2752-2802 */
export function openChestFlow(flow: ChestFlow): void {
  Snd.init();
  const kind = flow.kind;
  const k = CHESTS[kind];

  // Absorb the rejection immediately: the player may never finish tapping, and an
  // unattached rejected promise would surface as an unhandled error.
  const settled: Promise<Settled> = flow.result.then(
    (res): Settled => ({ ok: true, res }),
    (err): Settled => ({ ok: false, msg: apiMessage(err, STR.chest.failed) }),
  );

  lockModal(true);
  openModal(
    '<h2 class="goldtext">' + k.n.toUpperCase() + '</h2><p class="sub">' + STR.chest.tapHint + '</p>' +
      '<div class="gachastage"><div class="rays" id="gRays"></div><canvas id="chestCv"></canvas><div class="tapme" id="tapMe">' +
      STR.chest.tap + '</div></div>' +
      '<div id="gReward"></div>' +
      '<div id="gFoot" style="margin-top:12px;display:none"><button class="btn gold" style="width:100%" id="gDone">' +
      STR.chest.done + '</button></div>',
  );

  const cv = must<HTMLCanvasElement>('#chestCv');
  const c = fitCanvas(cv, 170, 170);
  let open = 0;
  let taps = 0;
  const t0 = performance.now();
  let done = false;
  let anim = 0;
  // L2761 — the two premium chests need a fourth tap.
  const need = kind === 'legend' || kind === 'magical' ? 4 : 3;

  function draw(): void {
    const t = (performance.now() - t0) / 1000;
    c.clearRect(0, 0, 170, 170);
    c.save();
    c.translate(85, 92);
    if (!done) c.rotate(Math.sin(t * 8) * 0.02 * taps);
    Art.chest(c, kind, { s: 96, open, t });
    c.restore();
    anim = requestAnimationFrame(draw);
  }
  draw();

  cv.onclick = () => {
    if (done) return;
    taps++;
    Snd.play(300 + taps * 120, 0.09, 'square', 0.06);
    cv.classList.add('shake');
    setTimeout(() => cv.classList.remove('shake'), 260);
    if (taps < need) return;
    done = true;
    const tapMe = $('#tapMe');
    if (tapMe) tapMe.style.display = 'none';
    const rays = $('#gRays');
    if (rays) rays.classList.add('on');
    Snd.crown();
    const t1 = performance.now();
    (function grow(): void {
      open = Math.min(1, (performance.now() - t1) / 420);
      if (open < 1) requestAnimationFrame(grow);
    })();
    // The prototype revealed on a flat 480 ms timer; now the reveal is gated on *both* the
    // timer and the server's answer, so a slow network delays the pop rather than showing
    // an empty grid.
    void Promise.all([settled, delay(480)]).then(([s]) => {
      if (s.ok) showRewards(s.res);
      else showFailure(s.msg);
    });
  };

  must<HTMLButtonElement>('#gDone').onclick = () => {
    cancelAnimationFrame(anim);
    lockModal(false);
    closeModal();
    refreshHeader();
    // Re-render whichever tab is underneath so the new gold/gems/cards show up.
    setTab(currentTab());
  };

  /** L2789-2801 */
  function showRewards(res: ChestResult): void {
    const box = must('#gReward');
    box.innerHTML =
      '<div style="display:flex;gap:10px;justify-content:center;margin-top:12px;font-size:15px">' +
      '<span>' + STR.chest.gold(fmt(res.gold)) + '</span>' +
      (res.gem > 0 ? '<span>' + STR.chest.gem(res.gem) + '</span>' : '') +
      '</div><div class="rewardgrid" id="rwGrid"></div>';
    const g = must('#rwGrid');
    res.cards.forEach((cd, i) => {
      const el = document.createElement('div');
      el.className = 'rw' + (cd.rar === 'legendary' ? ' legend' : cd.rar === 'epic' ? ' epic' : '');
      el.style.animationDelay = i * 0.12 + 's';
      const cv2 = document.createElement('canvas');
      el.appendChild(cv2);
      el.insertAdjacentHTML(
        'beforeend',
        '<div class="rn">' + CARD[cd.id].n + '</div><div class="rc">' +
          (cd.isNew ? STR.chest.isNew : STR.chest.count(cd.n)) + '</div>',
      );
      g.appendChild(el);
      // Portrait render waits for the pop animation's layout so `clientWidth` is real.
      setTimeout(() => {
        renderPortrait(cv2, cd.id, el.clientWidth - 8);
        Snd.coin();
      }, i * 120);
    });
    must('#gFoot').style.display = 'block';
  }

  function showFailure(msg: string): void {
    const box = must('#gReward');
    box.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'sub';
    p.style.marginTop = '12px';
    // textContent, not innerHTML: the message can carry a server string.
    p.textContent = msg;
    box.appendChild(p);
    must('#gFoot').style.display = 'block';
  }
}
