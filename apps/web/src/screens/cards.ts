/**
 * Cards tab — collection, card detail, upgrades, deck swap.
 * crown-clash.html L2589-2680.
 *
 * Two things move to the server: the upgrade (gold + duplicates are currency, handoff §5)
 * and the deck itself (the match validator checks every deploy against the 8 cards the
 * server has on file, so the client cannot be the one that decides what is in the deck).
 * Everything visual — frame colours, the progress sliver, the stat rows, the sort order —
 * is the prototype's.
 */
import {
  CARD, CARDS, MAX_CARD_LEVEL, RARITY, TELEMETRY, clamp, deckWarnings, fmt, matchups, ownsCard, statMul,
} from '@crown/shared';
import type { Card, DeckWarning, RarityKey } from '@crown/shared';
import { $, must } from '../dom';
import { Snd, renderPortrait } from '../engine';
import { S, setSave } from '../api/store';
import { api } from '../api/client';
import { track } from '../telemetry';
import { closeModal, openModal } from '../ui/modal';
import { toastTop } from '../ui/toast';
import { setTab } from '../ui/tabs';
import { STR } from './strings';
import { apiMessage } from './errors';

export interface CardNodeOpts {
  /** Hide the level/progress overlay — used by the "pick a slot" grid. */
  noLv?: boolean;
  /** Deck slot index; present only when the node represents a deck slot. */
  slot?: number;
}

/** Numeric card fields are optional on the shared `Card` type (spells have no `hp`). */
const num = (v: number | undefined): number => v ?? 0;

/** L2589-2606 */
export function cardNode(cid: string, opt: CardNodeOpts = {}): HTMLElement {
  const card = CARD[cid];
  const owned = ownsCard(S, cid);
  const rar = RARITY[card.r];
  const el = document.createElement('div');
  el.className = 'ccard' + (owned ? '' : ' locked');
  const fr = document.createElement('div');
  fr.className = 'frame ' + rar.cls;
  el.appendChild(fr);
  const cv = document.createElement('canvas');
  fr.appendChild(cv);
  fr.insertAdjacentHTML('beforeend', '<span class="cost">' + card.cost + '</span>');
  if (owned && !opt.noLv) {
    const st = S.cards[cid];
    const need = rar.upCards[st.lv] || 9999;
    const ready = st.cnt >= need && st.lv < MAX_CARD_LEVEL;
    fr.insertAdjacentHTML(
      'beforeend',
      '<div class="prog"><i class="' + (ready ? 'full' : '') + '" style="width:' +
        clamp((st.cnt / need) * 100, 0, 100) + '%"></i></div>',
    );
    fr.insertAdjacentHTML(
      'beforeend',
      '<div class="lv' + (ready ? ' up' : '') + '">' + STR.cards.level(st.lv, ready) + '</div>',
    );
  } else if (!owned) {
    fr.insertAdjacentHTML('beforeend', '<div class="lv">' + STR.cards.locked + '</div>');
  }
  el.onclick = () => {
    Snd.init();
    Snd.play(700, 0.05, 'triangle', 0.05);
    openCardDetail(cid, opt.slot);
  };
  // Deferred a frame so `fr.clientWidth` is the laid-out width, not 0.
  requestAnimationFrame(() => renderPortrait(cv, cid, fr.clientWidth || 70));
  return el;
}

/** L2607-2624 */
export function renderCardsTab(body: HTMLElement): void {
  body.innerHTML =
    '<div class="sect" style="margin-top:4px"><div class="secthead"><h3>' + STR.cards.battleDeck +
      '</h3><span class="pill" id="deckAvg2">Avg 0 ⚡</span></div><div class="deckrow" id="tabDeck"></div>' +
      '<div id="deckCheck"></div></div>' +
    '<div class="sect"><div class="secthead"><h3>' + STR.cards.collection +
      '</h3><span class="pill" id="colCount"></span></div><div class="cardgrid" id="colGrid"></div></div>' +
    '<div style="height:8px"></div>';
  const dr = must('#tabDeck');
  let tot = 0;
  S.deck.forEach((cid, i) => {
    tot += CARD[cid].cost;
    dr.appendChild(cardNode(cid, { slot: i }));
  });
  must('#deckAvg2').textContent = STR.home.deckAvg((tot / 8).toFixed(1));
  renderDeckCheck(must('#deckCheck'), (tot / 8).toFixed(1));
  const grid = must('#colGrid');
  // L2617-2622 — owned first, then rarity order, then elixir cost. `sort` is stable in every
  // engine we target, so equal-cost cards keep their `CARDS` declaration order.
  const order: RarityKey[] = ['common', 'rare', 'epic', 'legendary'];
  const sorted = CARDS.slice().sort((a, b) => {
    const oa = ownsCard(S, a.id) ? 0 : 1;
    const ob = ownsCard(S, b.id) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const ra = order.indexOf(a.r);
    const rb = order.indexOf(b.r);
    if (ra !== rb) return ra - rb;
    return a.cost - b.cost;
  });
  sorted.forEach((c) => grid.appendChild(cardNode(c.id)));
  must('#colCount').textContent = STR.cards.count(Object.keys(S.cards).length, CARDS.length);
}

/** L2632-2637 — the stat block. Spells read a different set of fields than troops. */
function statRows(card: Card, mul: number): string {
  const row = (k: string, v: string | number): string =>
    '<div class="statline"><span>' + k + '</span><b>' + v + '</b></div>';
  if (card.t === 'spell') {
    return (
      row(STR.cards.statDamage, Math.round(num(card.dmg) * mul)) +
      row(STR.cards.statRadius, STR.cards.tiles(num(card.radius))) +
      row(STR.cards.statTowerDamage, Math.round(num(card.dmg) * mul * (card.twr || 0.4)))
    );
  }
  return (
    row(STR.cards.statHp, Math.round(num(card.hp) * mul)) +
    row(STR.cards.statDamage, Math.round(num(card.dmg) * mul)) +
    row(STR.cards.statDps, Math.round((num(card.dmg) * mul) / num(card.hs))) +
    row(STR.cards.statRange, num(card.rg) < 1.2 ? STR.cards.melee : STR.cards.tiles(num(card.rg))) +
    row(
      STR.cards.statTargets,
      card.tg === 'both' ? STR.cards.targetsBoth : card.tg === 'build' ? STR.cards.targetsBuild : STR.cards.targetsGround,
    ) +
    (num(card.cnt) > 1 ? row(STR.cards.statCount, STR.cards.units(num(card.cnt))) : '')
  );
}

/**
 * Deck check — added by the port.
 *
 * Eight slots out of 21 cards, and the prototype gave no guidance at all: a new player could
 * lose for a week to a flier without ever being told their deck could not hit one. The holes
 * come from `deckWarnings()` in @crown/shared, which reads them off the same card data the sim
 * enforces — so this is not advice about the metagame, it is a list of things that will lose
 * matches mechanically.
 *
 * Silent when the deck is fine. A permanent green tick trains people to stop reading it.
 */
function renderDeckCheck(host: HTMLElement, avg: string): void {
  const warns = deckWarnings(S.deck);
  if (!warns.length) {
    host.innerHTML = '';
    return;
  }
  const text = (w: DeckWarning): string => (w === 'heavy' ? STR.cards.heavy(avg) : STR.cards[w]);
  host.innerHTML =
    '<div class="dcheck"><div class="dclabel">' + STR.cards.deckAdvice + '</div>' +
    warns.map((w) => '<div class="dcrow">⚠️ <span>' + text(w) + '</span></div>').join('') +
    '</div>';
}

/**
 * Counter rows — added by the port, no prototype line to cite.
 *
 * The stat block tells a player what a card *is* and nothing about what to do with it, so the
 * two questions that actually decide a match — what do I answer this with, and what answers me
 * — had no answer anywhere in the game. `matchups()` derives both from the card data using the
 * sim's own targeting and splash rules; see packages/shared/src/counters.ts for the model.
 *
 * Rendered as portraits rather than names because that is what a player has to recognise in
 * the half second a card spends on the opponent's hand bar.
 */
function matchupBlock(cid: string): string {
  const m = matchups(CARD[cid]);
  const row = (kind: 'good' | 'bad', label: string, ids: string[]): string =>
    !ids.length
      ? ''
      : '<div class="murow"><div class="mulabel ' + kind + '">' + label + '</div><div class="mus">' +
        ids
          .map(
            (id) =>
              '<button class="mu" data-mu="' + id + '"><canvas></canvas><span>' + CARD[id].n + '</span></button>',
          )
          .join('') +
        '</div></div>';
  const strong = row('good', STR.cards.strongAgainst, m.strong);
  const weak = row('bad', STR.cards.weakAgainst, m.weak);
  return strong || weak ? '<div class="mublock">' + strong + weak + '</div>' : '';
}

/** L2625-2671 */
export function openCardDetail(cid: string, slot?: number): void {
  const card = CARD[cid];
  const rar = RARITY[card.r];
  const owned = ownsCard(S, cid);
  const st = owned ? S.cards[cid] : { lv: 1, cnt: 0 };
  const need = rar.upCards[st.lv] || 0;
  const cost = rar.upCost[st.lv] || 0;
  const canUp = owned && st.lv < MAX_CARD_LEVEL && st.cnt >= need && S.gold >= cost;
  const mul = statMul(st.lv);
  const stats = statRows(card, mul);
  const typeLabel =
    card.t === 'spell' ? STR.cards.typeSpell : card.t === 'build' ? STR.cards.typeBuild : STR.cards.typeTroop;

  openModal(
    '<button class="xbtn" data-close>✕</button>' +
      '<div style="display:flex;gap:12px;align-items:center">' +
      '<div style="width:86px;flex:none"><div class="ccard" style="pointer-events:none"><div class="frame ' +
      rar.cls + '"><canvas id="cdArt"></canvas><span class="cost">' + card.cost + '</span></div></div></div>' +
      '<div style="flex:1;min-width:0"><div style="font-size:19px" class="goldtext">' + card.n + '</div>' +
      '<div style="font-size:11px;color:' + rar.c + '">' + rar.n + ' · ' + typeLabel + '</div>' +
      '<div style="font-size:11px;color:var(--txt-dim);margin-top:4px;font-weight:700;line-height:1.4">' +
      card.d + '</div></div>' +
      '</div>' +
      (owned
        ? '<div style="margin:12px 0 8px"><div style="display:flex;justify-content:space-between;font-size:12px"><span>' +
          STR.cards.levelLine(st.lv) + '</span><span>' +
          STR.cards.progress(st.cnt, st.lv < MAX_CARD_LEVEL ? String(need) : STR.cards.max) + '</span></div>' +
          '<div class="qbar" style="margin-top:5px"><i class="' + (st.cnt >= need ? 'done' : '') +
          '" style="width:' + clamp((st.cnt / Math.max(1, need)) * 100, 0, 100) + '%"></i></div></div>'
        : '<p class="sub" style="margin-top:12px">' + STR.cards.notUnlocked + '</p>') +
      '<div style="margin-top:8px">' + stats + '</div>' +
      matchupBlock(cid) +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
      (owned && st.lv < MAX_CARD_LEVEL
        ? '<button class="btn ' + (canUp ? 'gold' : 'ghost') + '" id="cdUp" style="flex:1" ' +
          (canUp ? '' : 'disabled') + '>' + STR.cards.upgrade(fmt(cost)) + '</button>'
        : '') +
      (owned && slot === undefined ? '<button class="btn green" id="cdDeck" style="flex:1">' + STR.cards.swapDeck + '</button>' : '') +
      (slot !== undefined ? '<button class="btn ghost" id="cdSwap" style="flex:1">' + STR.cards.swapSlot(slot) + '</button>' : '') +
      '</div>',
  );
  const art = $<HTMLCanvasElement>('#cdArt');
  if (art) renderPortrait(art, cid, 86);

  // Tapping a counter opens that card instead. `openModal` swaps `#modal`'s contents in place,
  // so this walks sideways through the roster rather than stacking sheets the player then has
  // to close one at a time.
  document.querySelectorAll<HTMLButtonElement>('#modal [data-mu]').forEach((b) => {
    const other = b.dataset.mu as string;
    const cv = b.querySelector('canvas');
    if (cv) requestAnimationFrame(() => renderPortrait(cv, other, 40));
    b.onclick = () => {
      Snd.play(700, 0.05, 'triangle', 0.05);
      openCardDetail(other);
    };
  });

  const up = $<HTMLButtonElement>('#cdUp');
  if (up) {
    up.onclick = async () => {
      if (!canUp) return;
      // The server re-checks cost and duplicate count and returns the authoritative save;
      // the local `canUp` above only decides whether the button looks pressable.
      up.disabled = true;
      try {
        const res = await api.upgradeCard({ cardId: cid });
      // Which cards players actually invest in — the clearest signal of what feels strong.
      track(TELEMETRY.cardUpgrade, { card: cid, level: res.level, cost: res.cost });
        setSave(res.save);
        Snd.crown();
        toastTop(STR.cards.upgraded(card.n, res.level));
        closeModal();
        setTab('cards');
      } catch (err) {
        up.disabled = false;
        toastTop(apiMessage(err));
      }
    };
  }
  const dk = $<HTMLButtonElement>('#cdDeck');
  if (dk) dk.onclick = () => pickSlot(cid);
  const sw = $<HTMLButtonElement>('#cdSwap');
  if (sw) {
    sw.onclick = () => {
      closeModal();
      // L2670 also assigned `pendingSlot = slot`, which nothing ever read — the flow works
      // because the player then taps a collection card, which opens the detail with no slot
      // and offers SWAP DECK. The dead store is not carried over.
      toastTop(STR.cards.pickFromCollection(slot as number));
    };
  }
}

/** L2673-2680 — the second-level modal that asks which slot to overwrite. */
export function pickSlot(cid: string): void {
  if (S.deck.indexOf(cid) >= 0) {
    toastTop(STR.cards.alreadyInDeck);
    return;
  }
  const m = openModal(
    '<button class="xbtn" data-close>✕</button><h2 class="goldtext">' + STR.cards.pickSlotTitle +
      '</h2><p class="sub">' + STR.cards.pickSlotSub + '</p><div class="cardgrid" id="slotGrid"></div>',
    2,
  );
  const g = must('#slotGrid', m);
  S.deck.forEach((old, i) => {
    const n = cardNode(old, { noLv: true });
    // Replaces `cardNode`'s own open-detail handler — same as the prototype.
    n.onclick = async () => {
      const deck = S.deck.slice();
      deck[i] = cid;
      try {
        const res = await api.updateProfile({ deck });
        setSave(res.save);
        Snd.coin();
        toastTop(STR.cards.addedToDeck(CARD[cid].n));
        closeModal(2);
        closeModal();
        setTab('cards');
      } catch (err) {
        toastTop(apiMessage(err));
      }
    };
    g.appendChild(n);
  });
}
