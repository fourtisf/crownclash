/**
 * Client telemetry.
 *
 * There was none, and that is a problem you can only fix in advance: data not collected on
 * day one is gone forever. Without it you cannot tell how many players quit mid-tutorial,
 * which of the 21 cards nobody ever plays, or which arena is the wall — and you cannot
 * balance 21 cards on a hunch.
 *
 * Three rules:
 *  - **Never block the game.** Every send is fire-and-forget and every failure is swallowed.
 *    A dead analytics endpoint must not cost a player their match.
 *  - **Never send anything a player typed.** Names, wallet addresses and chat-shaped data
 *    stay out. What goes over the wire is what happened, not who it happened to.
 *  - **Batch.** One request per ~15 s, plus a flush when the tab hides — which on mobile is
 *    usually the last moment there is, so it uses `sendBeacon` to survive the page dying.
 */
import { API_PREFIX, TELEMETRY } from '@crown/shared';
import type { TelemetryEvent } from '@crown/shared';

const FLUSH_MS = 15_000;
/** Matches the server's per-batch cap; a longer queue is trimmed oldest-first. */
const MAX_QUEUE = 40;

const BASE = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';
const ENDPOINT = `${BASE}${API_PREFIX}/telemetry`;

/** Groups a page load. Not persisted — a new load is a new session by definition. */
const session = (() => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
})();

let queue: TelemetryEvent[] = [];
let timer = 0;
let enabled = true;

/** Turn everything off — used by the E2E suite so tests do not pollute real numbers. */
export function setTelemetryEnabled(on: boolean): void {
  enabled = on;
}

function send(useBeacon: boolean): void {
  if (!queue.length) return;
  const body = JSON.stringify({ session, events: queue });
  queue = [];
  try {
    // `sendBeacon` is the only transport the browser promises to finish once the page is
    // going away, which is exactly when the most interesting event (they left) is emitted.
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* telemetry must never throw into the caller */
  }
}

/** Record an event. Safe to call from anywhere, including error handlers. */
export function track(name: string, props?: Record<string, string | number | boolean | null>): void {
  if (!enabled) return;
  queue.push({ name, t: Date.now(), props });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (!timer) {
    timer = window.setTimeout(() => {
      timer = 0;
      send(false);
    }, FLUSH_MS);
  }
}

/**
 * Start collecting. Installs the global error handlers too, because an uncaught exception on
 * a player's phone is otherwise completely invisible — the app just stops and nobody hears.
 */
export function initTelemetry(): void {
  track(TELEMETRY.appOpen, {
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    // Coarse only: enough to spot "every crash is on one browser", not to identify anyone.
    ua: /android/i.test(navigator.userAgent) ? 'android' : /iphone|ipad/i.test(navigator.userAgent) ? 'ios' : 'desktop',
  });

  window.addEventListener('error', (e) => {
    track(TELEMETRY.clientError, {
      msg: String(e.message).slice(0, 200),
      // File and line are enough to find it in the sourcemap without shipping a stack.
      src: String(e.filename || '').slice(-80),
      line: e.lineno || 0,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | undefined;
    track(TELEMETRY.clientError, { msg: String(r?.message ?? r ?? 'unhandled rejection').slice(0, 200), kind: 'promise' });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send(true);
  });
  window.addEventListener('pagehide', () => send(true));
}
