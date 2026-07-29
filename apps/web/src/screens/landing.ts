/**
 * Landing page — crown-clash.html L2451-2536.
 *
 * The prototype ran all of this as an IIFE *inside* `refreshHome()`, so every return to the
 * Home tab re-rendered four logo canvases, re-ran the hero backdrop twice on timers, and
 * appended another four cards to the fan (which is `position:absolute`, so the duplicates
 * stacked invisibly and leaked canvases). It is a boot-time job: `main.ts` calls
 * `initLanding(onEnter)` once and this module refuses to run twice.
 *
 * Everything drawn here comes from the live art engine — that is the point of the
 * "LIVE ENGINE RENDER" badge, and handoff §6 lists the hero backdrop, the scene and the card
 * fan as keepers.
 */
import { AH, AW, CARD } from '@crown/shared';
import { $, $$ } from '../dom';
import { Art, Snd, buildArenaBG, ell, fitCanvas, getArenaBG, renderPortrait, setArenaTrophies } from '../engine';
import { S } from '../api/store';

let started = false;

/**
 * @param onEnter Called once the player commits (PLAY NOW / ENTER THE ARENA), right as the
 *                landing starts its 440 ms fade — early enough that the app behind it can
 *                warm up while the fade runs.
 */
export function initLanding(onEnter: () => void): void {
  const lp = $('#landing');
  if (!lp || started) return;
  started = true;

  // L2453 — the landing is the one place that always draws at full quality; the battle
  // renderer drops `hq` when the field gets busy.
  Art.hq = true;

  const logo = (el: HTMLCanvasElement | null, size: number): void => {
    if (!el) return;
    try {
      const c = fitCanvas(el, size, size);
      c.save();
      c.translate(size / 2, size * 0.57);
      Art.logo(c, size * 0.4);
      c.restore();
    } catch {
      /* a canvas that is not laid out yet simply skips this pass */
    }
  };
  logo($<HTMLCanvasElement>('#lpLogo'), 172);
  logo($<HTMLCanvasElement>('#lpLogo2'), 84);

  /* ------------------------------------------------------------ hero backdrop */
  function heroBg(): void {
    const cv = $<HTMLCanvasElement>('#lpBg');
    if (!cv) return;
    try {
      const hero = cv.parentElement;
      const w = (hero && hero.clientWidth) || 430;
      const h = (hero && hero.clientHeight) || 720;
      const c = fitCanvas(cv, w, h);
      const gy = h * 0.64;
      const gg = c.createLinearGradient(0, gy, 0, h);
      gg.addColorStop(0, 'rgba(18,36,92,0)');
      gg.addColorStop(0.3, '#13235c');
      gg.addColorStop(1, '#0a1130');
      c.fillStyle = gg;
      c.fillRect(0, gy - 20, w, h - gy + 20);
      for (let i = 0; i < 4; i++) {
        c.fillStyle = 'rgba(130,170,255,' + (0.055 - i * 0.011) + ')';
        c.fillRect(0, gy + (h - gy) * (0.16 + i * 0.2), w, 2.5);
      }
      const T = (x: number, y: number, kind: 'princess' | 'king', team: 0 | 1, s2: number): void => {
        c.save();
        c.translate(x, y);
        Art.tower(c, kind, team, { s: s2, dmgFlash: 0 });
        c.restore();
      };
      T(w * 0.13, h * 0.94, 'princess', 1, h * 0.06);
      T(w * 0.87, h * 0.94, 'princess', 1, h * 0.06);
      T(w * 0.5, h * 0.995, 'king', 1, h * 0.074);
      const tg = c.createLinearGradient(0, gy - h * 0.16, 0, h);
      tg.addColorStop(0, 'rgba(12,20,54,0)');
      tg.addColorStop(0.55, 'rgba(12,20,54,.46)');
      tg.addColorStop(1, 'rgba(7,11,30,.92)');
      c.fillStyle = tg;
      c.fillRect(0, gy - h * 0.16, w, h - gy + h * 0.16);
      const lg = c.createRadialGradient(w * 0.5, gy + 26, 8, w * 0.5, gy + 26, w * 0.55);
      lg.addColorStop(0, 'rgba(255,207,63,.10)');
      lg.addColorStop(1, 'rgba(255,207,63,0)');
      c.fillStyle = lg;
      c.fillRect(0, gy - 50, w, h - gy + 50);
    } catch {
      /* ignore — a failed decorative pass must never block the PLAY button */
    }
  }
  requestAnimationFrame(heroBg);
  // The second pass at 450 ms is the prototype's fix for webfont/layout settling changing
  // the hero's measured height after the first paint.
  setTimeout(heroBg, 450);

  /* ---------------------------------------------- kipas kartu asli dari engine */
  try {
    const box = $('#lpCards');
    if (box) {
      const fan: [string, string, number][] = [
        ['voidblade', '-16deg', 3],
        ['blademaster', '-5deg', 4],
        ['stormtitan', '5deg', 4],
        ['drakeling', '16deg', 3],
      ];
      fan.forEach((it) => {
        const w = document.createElement('div');
        const cv = document.createElement('canvas');
        w.style.setProperty('--r', it[1]);
        w.style.zIndex = String(it[2]);
        w.appendChild(cv);
        box.appendChild(w);
        requestAnimationFrame(() => renderPortrait(cv, it[0], 132));
      });
    }
  } catch {
    /* ignore */
  }

  /* --------- gameplay shot: arena + tower + pasukan digambar engine beneran --- */
  function lpScene(): void {
    const cv = $<HTMLCanvasElement>('#lpScene');
    if (!cv) return;
    try {
      // The sliced `buildArenaBG` reads its own module-local `S.trophies` for the palette,
      // so the arena has to be selected before the build (engine.ts exposes the setter).
      setArenaTrophies(S.trophies);
      buildArenaBG();
      const bg = getArenaBG();
      if (!bg) return;
      const parent = cv.parentElement;
      const w = cv.clientWidth || (parent ? parent.clientWidth - 20 : 0) || 276;
      const sc2 = w / AW;
      const h = AH * sc2;
      const c = fitCanvas(cv, w, h);
      c.drawImage(bg, 0, 0, w, h);
      const P = (x: number, y: number): [number, number] => [x * sc2, y * sc2];
      const towers: [number, number, 'princess' | 'king', 0 | 1][] = [
        [3.3, 6.6, 'princess', 1],
        [14.7, 6.6, 'princess', 1],
        [9, 2.9, 'king', 1],
        [3.3, 23.4, 'princess', 0],
        [14.7, 23.4, 'princess', 0],
        [9, 27.1, 'king', 0],
      ];
      towers.forEach((t) => {
        const pp = P(t[0], t[1]);
        c.save();
        c.translate(pp[0], pp[1] + (t[2] === 'king' && t[3] === 1 ? 0.4 * sc2 : 0));
        Art.tower(c, t[2], t[3], { s: sc2 * (t[2] === 'king' ? 1.34 : 1.46), dmgFlash: 0 });
        c.restore();
      });
      const m = P(13.5, 12.1);
      c.fillStyle = 'rgba(255,170,60,.15)';
      c.beginPath();
      c.ellipse(m[0], m[1], 2.0 * sc2, 1.35 * sc2, 0, 0, 6.3);
      c.fill();
      c.strokeStyle = 'rgba(255,210,90,.9)';
      c.setLineDash([6, 5]);
      c.lineWidth = 2.2;
      c.stroke();
      c.setLineDash([]);
      const u2 = (
        id: string,
        team: 0 | 1,
        x: number,
        y: number,
        o: { flip?: boolean; t?: number; walk?: number; atk?: number } = {},
      ): void => {
        const cd = CARD[id];
        if (!cd) return;
        const pp = P(x, y);
        c.save();
        c.translate(pp[0], pp[1]);
        ell(c, 0, 0, 0.5 * sc2, 0.22 * sc2, 'rgba(0,0,0,.3)');
        c.strokeStyle = team === 0 ? 'rgba(70,160,255,.75)' : 'rgba(255,90,90,.75)';
        c.lineWidth = Math.max(1.4, 0.05 * sc2);
        c.beginPath();
        c.ellipse(0, 0, 0.55 * sc2, 0.24 * sc2, 0, 0, 6.3);
        c.stroke();
        if (o.flip) c.scale(-1, 1);
        Art.unit(c, cd, { s: sc2, t: o.t || 0.4, walk: o.walk || 0, atk: o.atk || 0 });
        c.restore();
      };
      u2('warden', 1, 4.15, 13.4, { atk: 0.5 });
      u2('ironclad', 0, 4.0, 15.0, { atk: 0.4 });
      u2('archers', 0, 5.2, 17.4, { walk: 1, t: 0.8 });
      u2('sprites', 1, 13.3, 12.8, { walk: 1 });
      u2('drakeling', 1, 14.3, 13.9, { t: 1.1 });
      u2('voidblade', 0, 13.8, 16.9, { walk: 1, t: 0.5 });
      const a1 = P(5.2, 16.8);
      const a2 = P(4.5, 14.2);
      c.strokeStyle = '#f2e6c8';
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(a1[0], a1[1]);
      c.lineTo(a2[0], a2[1]);
      c.stroke();
      c.font = '900 ' + 0.62 * sc2 + 'px "Lilita One",sans-serif';
      c.textAlign = 'center';
      c.lineWidth = 4;
      c.strokeStyle = '#22140b';
      let dp = P(4.35, 12.5);
      c.strokeText('-146', dp[0], dp[1]);
      c.fillStyle = '#ffd24a';
      c.fillText('-146', dp[0], dp[1]);
      dp = P(13.9, 15.7);
      c.strokeText('-92', dp[0], dp[1]);
      c.fillStyle = '#ff8a8a';
      c.fillText('-92', dp[0], dp[1]);
    } catch {
      /* ignore */
    }
  }
  requestAnimationFrame(lpScene);
  setTimeout(lpScene, 450);

  /* ---------------------------------------------------------------- aset fitur */
  try {
    $$<HTMLCanvasElement>('#landing .lp-feat canvas').forEach((cv) => {
      const c = fitCanvas(cv, 76, 76);
      if (cv.dataset.art === 'chest') {
        c.save();
        c.translate(38, 34);
        Art.chest(c, 'golden', { s: 58, open: 0.5, t: 1 });
        c.restore();
      } else {
        c.save();
        c.translate(38, 66);
        Art.tower(c, 'king', 0, { s: 28, dmgFlash: 0 });
        c.restore();
      }
    });
  } catch {
    /* ignore */
  }

  /* -------------------------------------------------------------------- enter */
  const enter = (): void => {
    // This click is the user gesture that unlocks WebAudio; everything after it can play.
    Snd.init();
    if (Snd.ctx && Snd.ctx.state === 'suspended') void Snd.ctx.resume();
    Snd.crown();
    lp.classList.add('gone');
    setTimeout(() => lp.remove(), 440);
    onEnter();
  };
  const p1 = $<HTMLButtonElement>('#lpPlay');
  const p2 = $<HTMLButtonElement>('#lpPlay2');
  if (p1) p1.onclick = enter;
  if (p2) p2.onclick = enter;
}
