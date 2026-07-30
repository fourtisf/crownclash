/**
 * Save store — the single client-side holder of `S`.
 *
 * Keeps the prototype's guarantee that `S` is a real object synchronously from the first
 * line of script (L782 `let S=defaultState()`, with `Sready` gating writes), so screens can
 * render before the network answers and nothing has to null-check the save.
 *
 * IndexedDB is a *cache*, not a source of truth (handoff §7: "No localStorage … IndexedDB
 * ok for offline cache"). The server's copy always wins on reconnect.
 */
import { defaultState } from '@crown/shared';
import type { SaveState } from '@crown/shared';
import { ApiFailure, api } from './client';
import { idbGet, idbSet } from './offline';

const DEVICE_KEY = 'crownclash:deviceId';
const CACHE_KEY = 'crownclash:save';
const LEGACY_KEY = 'crownclash:v1';

/** Synchronously available, exactly as the prototype guaranteed. */
export let S: SaveState = defaultState();
/** Mirrors the prototype's `Sready`: nothing persists until the real save has landed. */
export let Sready = false;

type Listener = (s: SaveState) => void;
const listeners = new Set<Listener>();

export function onSaveChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Replace the save wholesale with the server's copy and notify screens. */
export function setSave(next: SaveState): void {
  S = next;
  Sready = true;
  void idbSet(CACHE_KEY, next);
  for (const fn of listeners) fn(next);
}

/** Stable per-device id. Generated once, then reused so a guest keeps their account. */
export async function deviceId(): Promise<string> {
  const existing = await idbGet<string>(DEVICE_KEY);
  if (existing) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await idbSet(DEVICE_KEY, id);
  return id;
}

export interface BootResult {
  online: boolean;
  created: boolean;
  migrated: boolean;
  /** Whether this account already has a recovery code. False when offline — nothing to ask. */
  hasRecovery: boolean;
}

/**
 * Sign in, load the authoritative save, and perform the one-time local-save migration.
 *
 * Migration (handoff §3.2): if a legacy prototype save exists in this browser and the
 * account is brand new, POST it to `/save/migrate` where the server sanity-caps it. It runs
 * once — the legacy key is cleared on success, so a player cannot re-import to farm.
 */
export async function boot(): Promise<BootResult> {
  // Show the cached save immediately so the first paint isn't a blank home screen.
  const cached = await idbGet<SaveState>(CACHE_KEY);
  if (cached) {
    S = cached;
    for (const fn of listeners) fn(S);
  }

  const id = await deviceId();
  let auth;
  try {
    auth = await api.guest(id);
  } catch (err) {
    if (err instanceof ApiFailure && (err.isOffline || err.status >= 500)) {
      // Offline: keep playing against the cached save. Writes queue until we reconnect.
      Sready = !!cached;
      return { online: false, created: false, migrated: false, hasRecovery: false };
    }
    throw err;
  }

  let migrated = false;
  if (auth.created) {
    const legacy = await idbGet<SaveState>(LEGACY_KEY);
    if (legacy) {
      try {
        const res = await api.migrateSave(legacy);
        setSave(res.save);
        await idbSet(LEGACY_KEY, null);
        migrated = true;
      } catch {
        // A rejected migration must not block sign-in; the fresh save stands.
      }
    }
  }
  if (!migrated) setSave(auth.save);
  return { online: true, created: auth.created, migrated, hasRecovery: auth.hasRecovery };
}

/** Refresh from the server — used after reconnecting and on window focus. */
export async function refresh(): Promise<void> {
  const res = await api.loadSave();
  setSave(res.save);
}
