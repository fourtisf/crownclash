/**
 * Economy simulation — what card levels does a real player actually have at N trophies?
 *
 * This exists to answer one question with evidence instead of intuition: `aiLevelFor` gives
 * the AI one card level per 240 trophies, which is *linear*, while every card level costs
 * roughly double the last, which makes player power *logarithmic* in resources. Those two
 * curves diverge. The only open question is where they cross, and that depends entirely on how
 * fast chests actually arrive — which is a property of the economy, not of anyone's opinion.
 *
 * So this plays the game. It uses the real `applyMatchRewards`, `rollChest`, `grantChest`,
 * `claimQuest`, `claimLogin` and `upgradeCard` out of @crown/shared rather than a model of
 * them, because a model of the economy is exactly the thing that would be wrong.
 *
 * Usage:  node --import tsx tools/economy-sim.mjs [winRate] [matchesPerDay]
 */
import {
  CARD,
  MAX_CARD_LEVEL,
  RARITY,
  Rng,
  applyMatchRewards,
  claimLogin,
  claimQuest,
  checkQuests,
  defaultState,
  grantChest,
  dayKey,
  questsReady,
  rollChest,
  upgradeCard,
  aiLevelFor,
  arenaFor,
} from '../packages/shared/src/index.js';

const WIN_RATE = Number(process.argv[2] ?? 0.55);
const MATCHES_PER_DAY = Number(process.argv[3] ?? 25);
/** The 3-hour chest, if the player claims every one they are awake for. Generous. */
const FREE_CHESTS_PER_DAY = 6;
const DAYS = 400;

const rng = new Rng(20260730);
const START_MS = Date.UTC(2026, 0, 1);

/**
 * Spend everything spendable, cheapest upgrade first.
 *
 * Cheapest-first is the correct model of a rational player *and* the most favourable one: it
 * maximises total levels gained per gold, so whatever this reports is an upper bound on how
 * well a real player does. If the AI outpaces this, it outpaces everybody.
 */
function spend(s) {
  for (;;) {
    let best = null;
    let bestCost = Infinity;
    for (const cid of s.deck) {
      const st = s.cards[cid];
      if (!st || st.lv >= MAX_CARD_LEVEL) continue;
      const rar = RARITY[CARD[cid].r];
      const need = rar.upCards[st.lv] ?? Infinity;
      const cost = rar.upCost[st.lv] ?? Infinity;
      if (st.cnt >= need && s.gold >= cost && cost < bestCost) {
        best = cid;
        bestCost = cost;
      }
    }
    if (!best) return;
    upgradeCard(s, best);
  }
}

/** Average level across the eight cards actually being played. */
function deckLevel(s) {
  const lv = s.deck.map((cid) => s.cards[cid]?.lv ?? 1);
  return lv.reduce((a, b) => a + b, 0) / lv.length;
}

const s = defaultState();
let day = 0;
/** trophies → the deck level the player had when they first got there. */
const marks = [];
const ARENA_MARKS = [300, 700, 1200, 1800, 2600, 3600];
let nextMark = 0;

for (day = 1; day <= DAYS; day++) {
  // Login streak + daily quests, on a real advancing clock so the streak logic behaves.
  const now = START_MS + day * 864e5;
  checkQuests(rng, s, dayKey(new Date(now)));
  const login = claimLogin(s, now);
  if (login?.chest) grantChest(s, rollChest(rng, login.chest));

  for (let i = 0; i < MATCHES_PER_DAY; i++) {
    const win = rng.random() < WIN_RATE;
    applyMatchRewards(rng, s, win ? 'win' : 'lose', { depl: 14, dmg: 2400, crown: win ? 2 : 1, elix: 60 });
    // Chests are opened as they arrive — the queue caps at 4 and a full queue silently drops
    // the reward, so a player who lets it fill earns strictly less than this.
    for (const c of s.pendingChests.splice(0)) grantChest(s, rollChest(rng, c));
  }
  for (let i = 0; i < FREE_CHESTS_PER_DAY; i++) grantChest(s, rollChest(rng, 'wooden'));

  while (questsReady(s)) {
    let claimed = false;
    for (let i = 0; i < s.quests.list.length; i++) {
      const q = s.quests.list[i];
      if (!q.claimed && q.prog >= q.goal && claimQuest(s, i)) claimed = true;
    }
    if (!claimed) break;
  }

  spend(s);

  while (nextMark < ARENA_MARKS.length && s.trophies >= ARENA_MARKS[nextMark]) {
    marks.push({ trophies: ARENA_MARKS[nextMark], day, deck: deckLevel(s), king: s.lvl });
    nextMark++;
  }
  if (nextMark >= ARENA_MARKS.length) break;
}

console.log(`win rate ${(WIN_RATE * 100).toFixed(0)}%, ${MATCHES_PER_DAY} matches/day, cheapest-first upgrades\n`);
console.log('arena reached      day   player deck lv   AI card lv   gap   AI stat advantage');
for (const m of marks) {
  const ai = aiLevelFor(m.trophies);
  const gap = ai - m.deck;
  // Both HP and damage scale by statMul, so the combat advantage is the square of the ratio.
  const adv = Math.pow(1.1, gap) ** 2;
  const name = arenaFor(m.trophies).a.n;
  console.log(
    `${String(m.trophies).padStart(5)} ${name.padEnd(17)} ${String(m.day).padStart(4)}` +
      `   ${m.deck.toFixed(2).padStart(8)}   ${String(ai).padStart(10)}   ${gap.toFixed(2).padStart(5)}` +
      `   ${adv.toFixed(2)}x`,
  );
}
if (nextMark < ARENA_MARKS.length) {
  console.log(`\nnever reached ${ARENA_MARKS.slice(nextMark).join(', ')} in ${DAYS} days`);
}
