/**
 * Shop tab — crown-clash.html L2683-2717.
 *
 * `SHOP` itself lives in `@crown/shared` (data.ts) because the server prices the purchase;
 * the client sends an index, never a price. The published drop-rate table stays exactly
 * where it was: handoff §7 requires the rates remain visible next to the gacha.
 */
import { CHESTS, SHOP, fmt } from '@crown/shared';
import type { ChestKey } from '@crown/shared';
import { must } from '../dom';
import { Art, Snd, fitCanvas } from '../engine';
import { S, setSave } from '../api/store';
import { api } from '../api/client';
import { toastTop } from '../ui/toast';
import { setTab } from '../ui/tabs';
import { STR } from './strings';
import { apiMessage } from './errors';
import { openChestFlow } from './chest';

/** L2691-2717 */
export function renderShop(body: HTMLElement): void {
  body.innerHTML =
    '<div class="sect" style="margin-top:4px"><div class="secthead"><h3>' + STR.shop.title +
      '</h3><span class="pill">' + STR.shop.balance(fmt(S.gold), fmt(S.gem)) +
      '</span></div><div class="shopgrid" id="shopGrid"></div></div>' +
    '<div class="sect"><div class="secthead"><h3>' + STR.shop.dropRates + '</h3></div>' +
    '<div style="font-size:12px;color:var(--txt-dim);font-weight:700;line-height:1.9;padding:10px 12px;border-radius:14px;background:#131a3d;border:1.5px solid #0a1028">' +
    '<div style="color:#b9c6dd">' + STR.shop.rateCommon + '</div><div style="color:#ff9d3c">' + STR.shop.rateRare + '</div>' +
    '<div style="color:#c060ff">' + STR.shop.rateEpic + '</div><div style="color:#3ff0e0">' + STR.shop.rateLegendary + '</div>' +
    '<div style="margin-top:6px;color:#67759f">' + STR.shop.guarantees + '</div></div></div>' +
    '<div style="height:8px"></div>';

  const g = must('#shopGrid');
  SHOP.forEach((it, index) => {
    // The gold pack has no chest definition; only the chest rows read `CHESTS`.
    const k = it.kind === 'gold' ? null : CHESTS[it.kind as ChestKey];
    const el = document.createElement('div');
    el.className = 'shopitem';
    const cv = document.createElement('canvas');
    el.appendChild(cv);
    el.insertAdjacentHTML(
      'beforeend',
      '<div class="si">' + (it.label || (k ? k.n : '')) + '</div><div class="sd">' +
        (it.gold ? STR.shop.goldPackDesc : k ? STR.shop.chestDesc(k.cards, k.gold[0], k.gold[1]) : '') + '</div>',
    );
    const b = document.createElement('button');
    const has = (it.cur === 'gold' ? S.gold : S.gem) >= it.price;
    b.className = 'btn ' + (has ? (it.cur === 'gold' ? 'gold' : 'green') : 'ghost');
    b.disabled = !has;
    b.textContent = STR.shop.price(it.cur, fmt(it.price));
    b.onclick = async () => {
      // Affordability is re-checked server-side; `has` above only styles the button.
      b.disabled = true;
      try {
        const res = await api.buy({ index });
        setSave(res.save);
        if (res.gold) {
          Snd.coin();
          toastTop(STR.shop.goldBought(fmt(res.gold)));
          setTab('shop');
        } else if (res.chest) {
          // Already rolled by the server; the flow just animates it.
          openChestFlow({ kind: res.chest.kind, result: Promise.resolve(res.chest.result) });
        } else {
          setTab('shop');
        }
      } catch (err) {
        b.disabled = false;
        toastTop(apiMessage(err));
      }
    };
    el.appendChild(b);
    g.appendChild(el);
    requestAnimationFrame(() => {
      const c = fitCanvas(cv, 80, 80);
      c.translate(40, 38);
      // The gold pack borrows the golden chest's art (L2716).
      Art.chest(c, it.gold ? 'golden' : it.kind, { s: 60 });
    });
  });
}
