/**
 * The seam between the meta screens and the battle screen.
 *
 * `findMatch()` (matchmaking) has to hand a started match to `battle.ts`, and the result
 * modal has to tell `battle.ts` to tear its loop down when the player goes HOME. Importing
 * `battle.ts` from here would make the dependency circular — `battle.ts` already imports
 * `showResult()` from `screens/result.ts` — so the direction is inverted: `battle.ts`
 * registers itself once at boot and the screens only ever call through these hooks.
 *
 * WIRING (main.ts / battle.ts, one time at boot):
 *
 *     import { setBattleStarter, setBattleExit } from './screens';
 *     setBattleStarter(startBattle);   // (session: MatchStartResponse) => void
 *     setBattleExit(stopBattle);       // () => void — cancel rAF, drop the sim
 *
 * `showScreen()` is the prototype's `go()` (L2367-2369) minus the battle teardown, which is
 * exactly what `setBattleExit` covers.
 */
import type { MatchStartResponse } from '@crown/shared';
import { $$ } from '../dom';

/** Called with the server's match envelope; the client simulates against `seed`. */
export type BattleStarter = (session: MatchStartResponse) => void;
/** Called when the player leaves the battle screen — cancel the loop, release the sim. */
export type BattleExit = () => void;

let starter: BattleStarter | null = null;
let exit: BattleExit | null = null;

export function setBattleStarter(fn: BattleStarter | null): void {
  starter = fn;
}

export function setBattleExit(fn: BattleExit | null): void {
  exit = fn;
}

export function hasBattleStarter(): boolean {
  return !!starter;
}

/** L2367-2369 — `go(id)`, without the battle-loop teardown. */
export function showScreen(id: string): void {
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
}

/**
 * Hand the match to the battle screen. Returns false when nothing registered a starter,
 * so the caller can surface it instead of leaving the player staring at a closed modal.
 */
export function startBattleSession(session: MatchStartResponse): boolean {
  if (!starter) return false;
  starter(session);
  return true;
}

/** Leave the battle screen for Home. Safe to call when no battle is running. */
export function leaveBattle(): void {
  if (exit) exit();
  showScreen('home');
}
