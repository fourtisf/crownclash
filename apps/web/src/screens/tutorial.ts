/**
 * First-match coach marks.
 *
 * The prototype dropped a brand-new player straight into a real 3-minute match after a
 * five-line text modal. This walks them through the three things they actually have to *do*
 * — wait for elixir, pick a card, drop it on their own half — and then explains what winning
 * looks like.
 *
 * Two deliberate constraints:
 *
 *  - **It never pauses the match.** The simulation is what the server re-runs from the deploy
 *    log; stopping it would be safe for the log (ticks, not wall clock) but would leave the
 *    tutorial fighting the elixir timer, since steps 1 and 3 wait on game state that only
 *    advances while the sim runs. The first match is against the weakest AI in the game
 *    (Training Camp, skill 0.3) over a full 180 seconds, so there is ample slack.
 *  - **It never blocks input.** Every step advances on the action it is asking for, or on a
 *    timeout, and SKIP is always available. A tutorial that can trap a player is worse than
 *    no tutorial.
 */
import { TELEMETRY } from '@crown/shared';
import { $ } from '../dom';
import { track } from '../telemetry';

export interface CoachStep {
  /** Selector for the element to ring, if any. */
  target?: string;
  text: string;
  /** Advance after this many ms regardless. */
  after?: number;
  /** Minimum dwell so a step cannot flash past before it can be read. */
  minMs?: number;
}

const STEPS: CoachStep[] = [
  {
    target: '#elixBar',
    text: 'This is your <b>elixir</b>. It refills on its own — every card costs some to play.',
    after: 7000,
    minMs: 2500,
  },
  {
    target: '#handRow',
    text: 'Tap a <b>card</b> to pick it. The number in the corner is what it costs.',
    minMs: 1200,
  },
  {
    target: '#arenaWrap',
    text: 'Now tap <b>your half</b> of the arena — the green zone — to send them in.',
    minMs: 1200,
  },
  {
    text: 'They fight on their own. Knock down an enemy tower to take a <b>crown</b>.',
    after: 6000,
    minMs: 3000,
  },
  {
    text: 'Take the <b>King Tower</b> in the middle and you win instantly. Good luck!',
    after: 6000,
    minMs: 3000,
  },
];

type Ctx = {
  /** Current player elixir. */
  elixir: () => number;
  /** True once a card is selected in the hand. */
  selected: () => boolean;
  /** Number of cards deployed so far. */
  deployed: () => number;
};

let active = false;
let rafId = 0;
let onDone: (() => void) | null = null;

function setTarget(sel: string | undefined): void {
  document.querySelectorAll('.coach-target').forEach((el) => el.classList.remove('coach-target'));
  if (!sel) return;
  const el = $(sel);
  if (el) el.classList.add('coach-target');
}

function hide(): void {
  const box = $('#coach');
  if (box) box.classList.remove('on');
  setTarget(undefined);
}

/** Tear everything down. Safe to call twice, and called on every battle exit. */
export function stopTutorial(): void {
  if (!active) return;
  active = false;
  cancelAnimationFrame(rafId);
  rafId = 0;
  hide();
  const done = onDone;
  onDone = null;
  done?.();
}


/**
 * Begin the walkthrough. `finished` fires once, whether the player completed it or skipped —
 * either way they have seen it and it should not come back.
 */
export function startTutorial(ctx: Ctx, finished: () => void): void {
  const box = $('#coach');
  const textEl = $('#coachText');
  const stepEl = $('#coachStep');
  const skipEl = $('#coachSkip');
  if (!box || !textEl || !stepEl || !skipEl) return;

  active = true;
  onDone = finished;

  // Capture the counts at the moment each step begins, so "the player deployed something"
  // means *since this step started* rather than at any point in the match.
  let i = 0;
  let stepStart = performance.now();
  let baseDeployed = ctx.deployed();

  const show = (): void => {
    const s = STEPS[i];
    stepStart = performance.now();
    baseDeployed = ctx.deployed();
    stepEl.textContent = `STEP ${i + 1} OF ${STEPS.length}`;
    textEl.innerHTML = s.text;
    setTarget(s.target);
    box.classList.add('on');
    // Emitted per step so the drop-off point is visible. "Players quit during onboarding" is
    // useless; "60% never get past step 3, the one that asks them to tap the arena" is a fix.
    track(TELEMETRY.tutorialStep, { step: i + 1, of: STEPS.length });
  };

  const advance = (): void => {
    i++;
    if (i >= STEPS.length) {
      stopTutorial();
      return;
    }
    show();
  };

  const ready = (): boolean => {
    const s = STEPS[i];
    const elapsed = performance.now() - stepStart;
    if (elapsed < (s.minMs ?? 0)) return false;
    // Step-specific conditions live here rather than in STEPS so the data stays serialisable
    // and the context stays a narrow interface.
    if (i === 0 && ctx.elixir() >= 3) return true;
    if (i === 1 && ctx.selected()) return true;
    if (i === 2 && ctx.deployed() > baseDeployed) return true;
    if (s.after && elapsed >= s.after) return true;
    return false;
  };

  const tick = (): void => {
    if (!active) return;
    if (ready()) advance();
    if (active) rafId = requestAnimationFrame(tick);
  };

  skipEl.onclick = () => stopTutorial();
  show();
  rafId = requestAnimationFrame(tick);
}
