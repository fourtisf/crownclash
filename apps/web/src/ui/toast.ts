/** Floating toasts — crown-clash.html L2386-2393 and L2056-2059. */
import { $, must } from '../dom';

/**
 * L2386-2393 — the top-of-screen toast used for level-ups, purchases and errors.
 *
 * Built lazily and reused. The inline styles are the prototype's, kept rather than moved to
 * styles.css so the extracted stylesheet stays a byte-exact slice of the original.
 */
export function toastTop(msg: string): void {
  let el = document.getElementById('__t') as (HTMLElement & { _t?: number }) | null;
  if (!el) {
    el = document.createElement('div') as HTMLElement & { _t?: number };
    el.id = '__t';
    el.style.cssText =
      'position:absolute;left:50%;top:14%;transform:translateX(-50%);z-index:99;background:linear-gradient(180deg,#ffd964,#e08a10);color:#4a2a00;padding:10px 16px;border-radius:14px;font-size:14px;box-shadow:0 6px 18px rgba(0,0,0,.5);pointer-events:none;max-width:90%;text-align:center';
    must('#app').appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  el.style.transition = 'none';
  clearTimeout(el._t);
  el._t = window.setTimeout(() => {
    el!.style.transition = 'opacity .5s';
    el!.style.opacity = '0';
  }, 1500);
}

/** L2056-2059 — the in-arena banner ("TOWER DOWN!", "VICTORY!"). */
export function setToast(t: string): void {
  const el = $('#bToast');
  if (!el) return;
  if (!t) {
    el.classList.remove('show');
    el.textContent = '';
    return;
  }
  el.textContent = t;
  el.classList.remove('show');
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add('show');
}
