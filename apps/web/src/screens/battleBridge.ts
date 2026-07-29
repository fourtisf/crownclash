/**
 * The bit of `go()` (crown-clash.html L2367-2369) the meta screens need.
 *
 * `main.ts` owns the app-level `go()` and hands it to `battle.ts`, but two meta screens have
 * to move between screens on their own: the result modal's HOME button, and any caller of
 * `findMatch()` that did not come through `main.ts`. Rather than duplicate the teardown,
 * this module composes the two pieces that matter — switch the screen, stop the battle loop.
 *
 * `battle.ts` imports nothing from `screens/`, so depending on it here is a straight edge,
 * not a cycle.
 */
import { $$ } from '../dom';
import { stopBattle } from '../battle';

/** L2367-2368 — toggle the `.on` screen. */
export function showScreen(id: string): void {
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
}

/**
 * L2369 — leave the battle screen for Home, releasing the render loop and the sim.
 * Safe to call when no battle is running.
 */
export function leaveBattle(): void {
  stopBattle();
  showScreen('home');
}
