/**
 * Card matchups — the "strong against / weak against" rows in the card detail sheet.
 *
 * A new player's first ten losses are almost always one of four mistakes: dropping a
 * ground-only unit on a flier, dropping a single big unit into a swarm, dropping a swarm into
 * a splash attacker, or expecting Colossus/Boar/Behemoth to defend. Nothing in the game says
 * so. `Card.d` is one line of flavour ("Cheap all-round tank.") and the stat block is six
 * numbers with no opponent in them.
 *
 * Rather than hand-write a table of opinions — which would be stale the first time a number
 * moves — every matchup here is **computed from `data.ts` using the rules `sim.ts` actually
 * applies**: the same targeting test (L325-326), the same splash and chain falloff (L520-538),
 * the same group spawn radius (L224). Change a card's damage and the advice changes with it.
 *
 * What this is: a closed-form elixir-trade estimate. What it is not: the simulator. It models
 * two squads standing still and hitting each other, so it deliberately ignores everything
 * positional — kiting, lane choice, tower support, pulling with a building. Those are the
 * skills the hint is meant to let a player get on with learning, not a replacement for them.
 *
 * Levels cancel: both sides scale by `statMul(lv)`, so every ratio below is level-independent
 * and the numbers are read straight off the card at level 1.
 */
import { CARD, CARDS, RIV_B, TOWER_POS } from './data.js';
import type { Card } from './types.js';

/**
 * Tiles a troop covers between crossing the river and reaching a crown tower. Divided by a
 * card's speed it gives the window a defender actually has, which is the difference between
 * an answer and a speed bump: Ironclad does kill a Behemoth, in thirty-seven seconds, by
 * which time the Behemoth has been hitting the tower for twenty-six of them.
 */
const DEFEND_TILES = TOWER_POS.find((t) => t.team === 0 && t.kind === 'princess')!.y - RIV_B;

/** sim.ts L525 — splash hits the focused target at full damage and everything else at 85%. */
const SPLASH_FALLOFF = 0.85;
/** sim.ts L536 — a chain arc lands at 55%. */
const CHAIN_FALLOFF = 0.55;

/**
 * Worth listing only past this much of an elixir swing. Below ~0.75 the two cards are trading
 * roughly evenly and calling either one a counter would be telling the player something false.
 */
const MIN_SWING = 0.75;

/** Three each. A longer list is a table, and nobody reads a table on a phone mid-match. */
const MAX_ROWS = 3;

const bodies = (c: Card): number => c.cnt ?? 1;
const squadHp = (c: Card): number => (c.hp ?? 0) * bodies(c);

/** sim.ts L325-326, verbatim in intent: build-seekers ignore troops, ground-only misses air. */
function canAttack(a: Card, b: Card): boolean {
  if (a.t === 'spell') return true;
  const tg = a.tg ?? 'ground';
  if (tg === 'build') return b.t === 'build';
  if (b.fly) return tg === 'both';
  return true;
}

/**
 * How many of `a`'s bodies can be hitting `b` at the same moment.
 *
 * Ranged units all fire from wherever they are standing, so the whole squad contributes. Melee
 * units have to physically fit around the target, and the sim keeps same-layer units apart
 * (L490), so the cap is how many discs of radius `ra` fit on a ring of radius `ra + rb`. This
 * is what stops ten skeletons from all landing on one Sprite.
 */
function engaged(a: Card, b: Card): number {
  const n = bodies(a);
  if ((a.rg ?? 0) >= 1.5) return n;
  const ra = a.rad ?? 0.3;
  const rb = b.rad ?? 0.3;
  const ring = Math.floor((Math.PI * (ra + rb)) / ra);
  return Math.max(1, Math.min(n, ring));
}

/**
 * Extra bodies caught alongside the focused one.
 *
 * Separation keeps unit centres about `2 * rad` apart, so the most that fit inside a splash
 * disc of radius `s` is the area ratio. That is an upper bound, and it is closest to true in
 * the moment that matters: a group lands inside a 0.95-tile ring (sim.ts L224), which every
 * splash radius in the game covers, so splash is at its best exactly when it is being used to
 * answer a fresh drop.
 */
function splashExtras(a: Card, b: Card): number {
  const s = a.splash ?? 0;
  if (!s) return 0;
  const rb = b.rad ?? 0.3;
  return Math.min(bodies(b) - 1, Math.floor((s / (2 * rb)) ** 2));
}

/** Sustained damage per second that `a` puts into a full squad of `b`. */
function dps(a: Card, b: Card): number {
  if (!canAttack(a, b)) return 0;
  const single = (a.dmg ?? 0) / (a.hs || 1);
  if (!single) return 0;
  let multi = 1;
  if (a.splash) multi += SPLASH_FALLOFF * splashExtras(a, b);
  else if (a.chain) multi += CHAIN_FALLOFF * Math.min(bodies(b) - 1, a.chain);
  return single * engaged(a, b) * multi;
}

/**
 * What a spell erases outright, in elixir. Coverage is not modelled because there is nothing
 * to model: the smallest radius in the game is 2.5 tiles and the widest spawn ring is 0.95
 * (sim.ts L224), so a spell put on a group that has just landed hits all of it.
 *
 * Scored gross rather than net, which is the one place this file departs from elixir
 * bookkeeping, and deliberately. Every spell here costs as much as the squads it deletes —
 * Volley is 3 and so is Bone Horde — so a net-swing rule concludes that no spell in the game
 * counters anything. True as bookkeeping, useless as advice, and it ignores the half of a
 * spell's value that is not a trade at all: it lands instantly, cannot be blocked, and chips
 * the tower on the way (`twr`). So a spell is credited with what it kills, and only when it
 * kills outright — chip damage that leaves the squad walking is not an answer.
 */
function spellSwing(a: Card, b: Card): number {
  const hpEach = b.hp ?? 0;
  if (!hpEach) return 0;
  return (a.dmg ?? 0) >= hpEach ? b.cost : 0;
}

/**
 * A building cannot walk out to meet anything, so anything that outranges it hits it from a
 * tile it can never answer. Turret reaches 5.5 and Sharpshooter reaches 6.4 — that 0.9 of a
 * tile is the whole matchup, and it is the only place range decides a fight outright.
 *
 * Range is not modelled between two mobile units on purpose: how much free fire the longer
 * arm gets depends entirely on how far apart they started, which is a placement decision this
 * file has no business guessing at.
 */
function outranged(shooter: Card, target: Card): boolean {
  return !target.sp && (shooter.rg ?? 0) > (target.rg ?? 0);
}

/**
 * Share of credit an answer keeps for arriving on time.
 *
 * A trade that resolves before `b` would have reached a tower counts in full; one that takes
 * twice as long counts for half, because half the damage got through. Buildings never walk
 * anywhere, so nothing about killing one is urgent and they score undiscounted.
 */
function inTime(b: Card, killB: number): number {
  const sp = b.sp ?? 0;
  if (!sp || !Number.isFinite(killB)) return sp ? 0 : 1;
  const window = DEFEND_TILES / sp;
  return Math.min(1, window / killB);
}

/**
 * How good an answer `a` is to `b`, in elixir.
 *
 * The elixir swing of the trade, discounted by whether it lands in time to matter. Positive
 * means `a` counters `b`; the size is roughly the elixir `a` comes out ahead by.
 *
 * Damage is constant on both sides, which slightly flatters the larger squad — real focus fire
 * thins a horde and its output falls with it. The melee cap in `engaged` pulls the other way,
 * so the two errors argue rather than compound.
 */
export function advantage(a: Card, b: Card): number {
  if (a.id === b.id) return 0;
  if (a.t === 'spell') return b.t === 'spell' ? 0 : spellSwing(a, b);
  // You cannot fight a spell, so a troop is never "strong against" one; the reverse direction
  // is where the interesting half of that pairing lives.
  if (b.t === 'spell') return 0;

  const da = outranged(b, a) ? 0 : dps(a, b);
  const db = outranged(a, b) ? 0 : dps(b, a);
  if (!da && !db) return 0;
  // `a` cannot touch `b` at all: it is spent for nothing. This is the ground-troop-versus-
  // flier case, and it is the single most common way a new player loses a card.
  if (!da) return -a.cost;

  const killB = squadHp(b) / da;
  // `b` cannot touch `a`, so nothing wears `a` down — Colossus and Behemoth walk straight past
  // whatever is hitting them, because they only ever look for buildings.
  const killA = db ? squadHp(a) / db : Infinity;

  const swing = (() => {
    if (killB <= killA) {
      // `a` wins with `1 - killB/killA` of its health left, so that is the share it kept.
      const lost = db ? killB / killA : 0;
      // ...unless the corpse takes it with it. Behemoth's death blast is 340 in 2.2 tiles, and
      // it applies just as much to the free win as to the fought one: Bone Horde is still the
      // right answer to a Behemoth, but it does not walk away from it.
      const blast = b.deathDmg ?? 0;
      const inBlast = blast > 0 && (a.rg ?? 0) <= (b.deathRad ?? 0);
      const wiped = inBlast && blast >= (a.hp ?? 0) * (1 - lost);
      return b.cost - a.cost * (wiped ? 1 : lost);
    }
    // `a` dies, having removed the share of `b` it got through first.
    return b.cost * (killA / killB) - a.cost;
  })();

  return swing > 0 ? swing * inTime(b, killB) : swing;
}

export interface Matchups {
  /** Card ids this card beats, best trade first. */
  strong: string[];
  /** Card ids that beat this card, worst trade first. */
  weak: string[];
}

const cache = new Map<string, Matchups>();

/** Deterministic: ties break on cost then id, so the list never reshuffles between renders. */
function rank(scored: { id: string; cost: number; v: number }[]): string[] {
  return scored
    .filter((s) => s.v >= MIN_SWING)
    .sort((x, y) => y.v - x.v || x.cost - y.cost || (x.id < y.id ? -1 : 1))
    .slice(0, MAX_ROWS)
    .map((s) => s.id);
}

/** Both lists for one card. Computed once — 21 cards is 441 matchups of arithmetic. */
export function matchups(card: Card): Matchups {
  const hit = cache.get(card.id);
  if (hit) return hit;
  const strong: { id: string; cost: number; v: number }[] = [];
  const weak: { id: string; cost: number; v: number }[] = [];
  for (const other of CARDS) {
    if (other.id === card.id) continue;
    strong.push({ id: other.id, cost: other.cost, v: advantage(card, other) });
    weak.push({ id: other.id, cost: other.cost, v: advantage(other, card) });
  }
  const out: Matchups = { strong: rank(strong), weak: rank(weak) };
  cache.set(card.id, out);
  return out;
}

/* ------------------------------------------------------------------ deck check */

export type DeckWarning = 'noAir' | 'noWin' | 'noSpell' | 'noCheap' | 'heavy';

/**
 * What is structurally missing from a deck.
 *
 * Eight slots out of 21 cards is a real decision and the game offered no guidance on it at
 * all, so a new player could sit at 700 trophies for a week wondering why they kept losing to
 * a card they had no answer to. These are not opinions about the metagame — each one is a
 * mechanical hole that `sim.ts` will punish every single match:
 *
 *  - **noAir** is the big one. `canHit` (L326) makes a ground-only unit physically unable to
 *    touch a flier, so a deck without a single `tg:'both'` card or damaging spell literally
 *    cannot remove Wisps or a Drakeling. It watches them hit the tower.
 *  - **noWin** — nothing that seeks buildings and nothing that survives the walk. Chip damage
 *    can win on crowns, but a deck with no way to threaten a tower has to be told so.
 *  - **noSpell** — a spell is the only thing that clears a landed swarm instantly.
 *  - **noCheap** / **heavy** — elixir regenerates at 1 per 2.8 s and caps at 10. A deck with
 *    no 2-cost card, or a high average, spends most of the match unable to answer anything.
 *
 * Ordered by how badly each one loses matches, so the first warning is the one worth fixing.
 */
export function deckWarnings(deck: string[]): DeckWarning[] {
  const cards = deck.map((id) => CARD[id]).filter(Boolean);
  if (cards.length < 2) return [];
  const out: DeckWarning[] = [];

  const hitsAir = cards.some((c) => (c.t === 'spell' && (c.dmg ?? 0) > 0) || (c.t !== 'spell' && c.tg === 'both'));
  if (!hitsAir) out.push('noAir');

  // A win condition is either a build-seeker — which ignores defenders entirely — or a tank
  // with enough health to reach a tower through them.
  const hasWin = cards.some((c) => c.tg === 'build' || (c.hp ?? 0) >= 1500);
  if (!hasWin) out.push('noWin');

  if (!cards.some((c) => c.t === 'spell')) out.push('noSpell');

  const avg = cards.reduce((a, c) => a + c.cost, 0) / cards.length;
  if (!cards.some((c) => c.cost <= 2)) out.push('noCheap');
  // 4.2 is the point past which a full hand costs more than the elixir bar holds.
  if (avg > 4.2) out.push('heavy');

  return out;
}
