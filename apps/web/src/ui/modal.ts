/** Modal + toast plumbing — crown-clash.html L2371-2393. */
import { $, must } from '../dom';

/**
 * L2371-2377 — two stacked overlays. `which === 2` is the inner one (used when a modal has
 * to open another, e.g. card detail → pick a deck slot).
 */
export function openModal(html: string, which?: 1 | 2): HTMLElement {
  const ovl = must(which === 2 ? '#ovl2' : '#ovl');
  const m = must(which === 2 ? '#modal2' : '#modal');
  m.innerHTML = html;
  ovl.classList.add('on');
  m.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => {
    b.onclick = () => closeModal(which);
  });
  return m;
}

export function closeModal(which?: 1 | 2): void {
  must(which === 2 ? '#ovl2' : '#ovl').classList.remove('on');
}

/**
 * `lock` suppresses backdrop-dismiss. The prototype used it for the matchmaking modal, the
 * chest-opening flow and the result screen — places where dismissing would strand the player
 * mid-transaction.
 */
export function lockModal(locked: boolean, which?: 1 | 2): void {
  const ovl = must(which === 2 ? '#ovl2' : '#ovl');
  ovl.dataset.lock = locked ? '1' : '';
}

let bound = false;

/**
 * Bind the backdrop-dismiss handlers exactly once.
 *
 * The prototype attached these at module scope so they were inherently one-shot; the meta
 * screens re-render constantly, so binding is explicit here. (See B1 in the extraction plan
 * for what happens when a listener is attached inside a render function.)
 */
export function bindModals(): void {
  if (bound) return;
  bound = true;
  must('#ovl').addEventListener('click', (e) => {
    const ovl = $('#ovl');
    if ((e.target as HTMLElement).id === 'ovl' && ovl && !ovl.dataset.lock) closeModal();
  });
  must('#ovl2').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'ovl2') closeModal(2);
  });
}
