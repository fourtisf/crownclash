/**
 * Battle simulation — the port of crown-clash.html §6 (L1379-2053).
 *
 * Two rules govern this file:
 *
 * 1. **Deterministic.** Given the same seed and the same deploy log it produces the same
 *    result, every time, on any machine. The server re-runs it to decide match outcomes
 *    (handoff §3.3, §5), so a single unseeded `Math.random()` here would let honest matches
 *    be voided at random. Every gameplay roll comes off `this.rng`.
 * 2. **Headless.** No DOM, no audio, no particles. Visual consequences leave as `SimEvent`s
 *    which the client replays into the prototype's exact FX; the server drops them.
 *
 * Everything else — targeting, movement, damage, the ordering of the update passes, even the
 * quirks — is a straight transcription. Where behaviour looks like a bug, there's a comment
 * saying so and it is kept anyway.
 */
import {
  AH, AW, BRIDGE, CARD, DT, ELIX_MAX, ELIX_RATE, ELIX_START, MATCH_SECONDS, OVERTIME_SECONDS,
  RIV_B, RIV_T, TICK_HZ, TOWER_DEF, TOWER_POS, AI_DECKS,
} from './data.js';
import { Rng } from './rng.js';
import { clamp, dist, lerp, statMul, towerMul } from './util.js';
import type {
  Card, DeployLogEntry, MatchOutcome, MatchPhase, MatchStats, PendingSpell, Projectile,
  SimConfig, SimEvent, TargetKind, Unit,
} from './types.js';

/** Live battle state. Field names mirror the prototype's `B` so ported code reads the same. */
export interface BattleState {
  uid: number;
  /** Seconds remaining in the current phase. Derived from `phaseTick`, never accumulated. */
  t: number;
  /** Ticks elapsed since the match started. */
  tick: number;
  /** Ticks elapsed within the current phase. */
  phaseTick: number;
  /** Length of the current phase in ticks. */
  phaseTicks: number;
  phase: MatchPhase;
  over: boolean;
  units: Unit[];
  projs: Projectile[];
  spells: PendingSpell[];
  elix: [number, number];
  elixRate: number;
  mult: number;
  time: number;
  crowns: [number, number];
  myDeck: string[];
  aiDeck: string[];
  hand: string[];
  queue: string[];
  aiHand: string[];
  aiQueue: string[];
  aiLvl: number;
  myLvl: number;
  myCardLevels: Record<string, number>;
  ai: { timer: number; agg: number; skill: number };
  stat: MatchStats;
  endResult: MatchOutcome | null;
  endInstant: boolean;
}

export class Sim {
  readonly state: BattleState;
  readonly rng: Rng;
  /** Events produced by the tick currently being executed. Drained by `tick()`. */
  private events: SimEvent[] = [];

  constructor(cfg: SimConfig) {
    this.rng = new Rng(cfg.seed);

    const aiDeck = (AI_DECKS[clamp(cfg.aiDeckIndex, 0, AI_DECKS.length - 1)] || AI_DECKS[0]).slice();
    const B: BattleState = {
      uid: 1,
      t: MATCH_SECONDS,
      tick: 0,
      phaseTick: 0,
      phaseTicks: MATCH_SECONDS * TICK_HZ,
      phase: 'normal',
      over: false,
      units: [],
      projs: [],
      spells: [],
      elix: [ELIX_START, ELIX_START],
      elixRate: ELIX_RATE,
      mult: 1,
      time: 0,
      crowns: [0, 0],
      myDeck: cfg.myDeck.slice(),
      aiDeck,
      hand: [],
      queue: [],
      aiHand: [],
      aiQueue: [],
      aiLvl: cfg.aiLevel,
      myLvl: cfg.myKingLevel,
      myCardLevels: { ...cfg.myCardLevels },
      // L1448 — AI aggression/skill scale with the arena the player has reached.
      ai: {
        timer: 1.2,
        agg: 0.35 + cfg.aiDeckIndex * 0.06,
        skill: clamp(0.3 + cfg.aiDeckIndex * 0.11, 0.3, 0.95),
      },
      stat: { depl: 0, elix: 0, dmg: 0, crown: 0 },
      endResult: null,
      endInstant: false,
    };
    this.state = B;

    // L1452-1454 — shuffle order matters: player deck first, then AI deck. Swapping these
    // changes both opening hands for a given seed.
    const d = this.rng.shuffle(B.myDeck);
    B.hand = d.slice(0, 4);
    B.queue = d.slice(4);
    const e = this.rng.shuffle(B.aiDeck);
    B.aiHand = e.slice(0, 4);
    B.aiQueue = e.slice(4);

    // L1456-1466 — towers. Note towerMul (1.085), not statMul (1.10). See util.ts.
    for (const tp of TOWER_POS) {
      const def = TOWER_DEF[tp.kind];
      const lv = tp.team === 0 ? cfg.myKingLevel : cfg.aiLevel;
      const m = towerMul(lv);
      B.units.push({
        uid: this.nextUid(), team: tp.team, kind: 'tower', twKind: tp.kind, side: tp.side, cid: null, card: null,
        x: tp.x, y: tp.y, hp: def.hp * m, maxHp: def.hp * m, dmg: def.dmg * m, hs: def.hs, rg: def.rg, rad: def.rad,
        sp: 0, tg: 'both', fly: 0, splash: 0, atkCd: 0, deploy: 0, target: null, walk: 0, atkAnim: 0, flash: 0,
        dead: false, active: tp.kind !== 'king', proj: 'arrow', lvl: lv,
        stun: 0, charged: 0, chargeRun: 0, dashed: 0, life: 0, retarget: 0, face: 1,
      });
    }
  }

  private nextUid(): number {
    return this.state.uid++;
  }

  private emit(ev: SimEvent): void {
    this.events.push(ev);
  }

  /* ------------------------------------------------------------------ helpers */

  /** L1665 */
  towerAlive(team: 0 | 1, side: string): boolean {
    return this.state.units.some((u) => u.kind === 'tower' && u.team === team && u.side === side && !u.dead);
  }

  /** L1666 — card stats scale on the card's own level. */
  private statOf(card: Card, lvl: number, key: keyof Card): number {
    return ((card[key] as number) || 0) * statMul(lvl);
  }

  /**
   * L1668-1682 — deploy legality.
   *
   * Discrepancy D2: the buffer is `RIV_B + 1.1` (y ≥ 16.95), not the handoff's 15.85, and a
   * dead enemy princess opens a forward zone at y ≥ 8.4 on that lane. The server validator
   * calls this same function, so loosening it here would void legitimate matches.
   */
  canDeployAt(team: 0 | 1, x: number, y: number, card: Card): boolean {
    if (card.t === 'spell') return x >= 0 && x <= AW && y >= 0 && y <= AH;
    if (x < 0.7 || x > AW - 0.7 || y < 0.7 || y > AH - 0.7) return false;
    if (team === 0) {
      if (y >= RIV_B + 1.1) return true;
      if (!this.towerAlive(1, 'L') && x < AW / 2 && y >= 8.4) return true;
      if (!this.towerAlive(1, 'R') && x >= AW / 2 && y >= 8.4) return true;
      return false;
    } else {
      if (y <= RIV_T - 1.1) return true;
      if (!this.towerAlive(0, 'L') && x < AW / 2 && y <= AH - 8.4) return true;
      if (!this.towerAlive(0, 'R') && x >= AW / 2 && y <= AH - 8.4) return true;
      return false;
    }
  }

  /* ------------------------------------------------------------- spawn/deploy */

  /** L1684-1698 */
  private spawnTroop(cid: string, team: 0 | 1, x: number, y: number, lvl: number): Unit | null {
    const card = CARD[cid];
    if (!card) return null;
    const u: Unit = {
      uid: this.nextUid(), team, kind: card.t === 'build' ? 'build' : 'troop', cid, card, lvl,
      x: clamp(x, 0.5, AW - 0.5), y: clamp(y, 0.5, AH - 0.5),
      hp: this.statOf(card, lvl, 'hp'), maxHp: this.statOf(card, lvl, 'hp'), dmg: this.statOf(card, lvl, 'dmg'),
      hs: card.hs || 0, rg: card.rg || 0, rad: card.rad || 0, sp: card.sp || 0, tg: (card.tg || 'ground') as TargetKind,
      fly: card.fly ? 1 : 0, splash: card.splash || 0, proj: card.proj || null,
      atkCd: this.rng.rnd(0, 0.25), deploy: 1.0, target: null, walk: this.rng.rnd(0, 6), atkAnim: 0, flash: 0,
      dead: false, stun: 0, charged: 0, chargeRun: 0, dashed: 0, life: card.life || 0, retarget: 0,
      face: team === 0 ? -1 : 1,
    };
    this.state.units.push(u);
    return u;
  }

  /** L1700-1715 — spawn ring is a visual, so it leaves as an event instead of a state array. */
  private deployCard(cid: string, team: 0 | 1, x: number, y: number, lvl: number): void {
    const card = CARD[cid];
    if (card.t === 'spell') {
      this.castSpell(cid, team, x, y, lvl);
      return;
    }
    const n = card.cnt || 1;
    if (n === 1) {
      this.spawnTroop(cid, team, x, y, lvl);
      this.emit({ k: 'deploy', cid, team, x, y, count: 1, spread: (card.rad || 0.3) });
    } else {
      const R = n <= 3 ? 0.55 : 0.95;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + this.rng.rnd(0, 0.6);
        const rr2 = n <= 3 ? R : R * (i % 2 ? 0.55 : 1);
        this.spawnTroop(cid, team, x + Math.cos(ang) * rr2, y + Math.sin(ang) * rr2, lvl);
      }
      this.emit({ k: 'deploy', cid, team, x, y, count: n, spread: R + 0.3 });
    }
  }

  /** L1717-1721 — jolt lands almost instantly; everything else telegraphs for 0.62 s. */
  private castSpell(cid: string, team: 0 | 1, x: number, y: number, lvl: number): void {
    const card = CARD[cid];
    this.state.spells.push({ cid, card, team, x, y, lvl, t: 0, dur: card.id === 'jolt' ? 0.18 : 0.62, done: false });
    this.emit({ k: 'spellCast', cid, team, x, y });
  }

  /** L1723-1754 */
  private applySpell(sp: PendingSpell): void {
    const card = sp.card;
    const dmg = this.statOf(card, sp.lvl, 'dmg');
    const R = card.radius || 0;
    this.state.units.forEach((u) => {
      if (u.dead || u.team === sp.team) return;
      if (dist(u, sp) > R + u.rad * 0.5) return;
      const mul = u.kind === 'tower' ? card.twr || 0.4 : 1;
      this.hurt(u, dmg * mul, sp.team);
      if (card.stun) u.stun = Math.max(u.stun, card.stun);
      if (card.knock && u.kind === 'troop' && !u.fly) {
        const a = Math.atan2(u.y - sp.y, u.x - sp.x);
        u.x = clamp(u.x + Math.cos(a) * 0.55, 0.5, AW - 0.5);
        u.y = clamp(u.y + Math.sin(a) * 0.55, 0.5, AH - 0.5);
      }
    });
    this.emit({ k: 'spellImpact', cid: card.id, team: sp.team, x: sp.x, y: sp.y, radius: R });
  }

  /* -------------------------------------------------------------- damage/death */

  /**
   * L1756-1765.
   *
   * `B.stat.dmg += Math.min(amount, u.hp + amount)` caps the credited damage at the tower's
   * remaining HP — overkill on the killing blow doesn't inflate the "tower damage" quest.
   * (`u.hp` has already been decremented at that point, hence the `+ amount`.)
   */
  private hurt(u: Unit, amount: number, byTeam: 0 | 1): void {
    if (u.dead) return;
    u.hp -= amount;
    u.flash = 1;
    if (u.kind === 'tower' && byTeam === 0) this.state.stat.dmg += Math.min(amount, u.hp + amount);
    if (u.kind === 'tower' && u.twKind === 'king') u.active = true;
    this.emit({ k: 'hit', x: u.x, y: u.y - u.rad - 0.4, amount, byTeam, rad: u.rad });
    if (u.hp <= 0) {
      u.hp = 0;
      this.killUnit(u, byTeam);
    }
  }

  /** L1767-1795 */
  private killUnit(u: Unit, byTeam: 0 | 1): void {
    if (u.dead) return;
    u.dead = true;
    if (u.kind === 'tower') {
      this.state.crowns[byTeam]++;
      if (u.team === 1) this.state.stat.crown++;
      this.emit({ k: 'towerDown', x: u.x, y: u.y, team: u.team, byTeam });
      // Losing any tower on a side activates that side's King Tower.
      this.state.units.forEach((t) => {
        if (t.kind === 'tower' && t.team === u.team && t.twKind === 'king') t.active = true;
      });
      if (u.twKind === 'king') this.endBattle(byTeam === 0 ? 'win' : 'lose', true);
      else if (this.state.crowns[byTeam] >= 3) this.endBattle(byTeam === 0 ? 'win' : 'lose', true);
      return;
    }
    this.emit({ k: 'death', x: u.x, y: u.y, team: u.team, rad: u.rad });
    const card = u.card;
    if (card && card.deathDmg) {
      this.emit({ k: 'deathBlast', x: u.x, y: u.y, radius: card.deathRad || 0 });
      this.state.units.forEach((e) => {
        if (!e.dead && e.team !== u.team && dist(e, u) <= (card.deathRad || 0) + e.rad * 0.5) {
          this.hurt(e, this.statOf(card, u.lvl, 'deathDmg') * (e.kind === 'tower' ? 0.5 : 1), u.team);
        }
      });
    }
    if (card && card.split) {
      for (let i = 0; i < card.split; i++) {
        this.spawnTroop('behemoth_mini', u.team, u.x + (i ? -0.5 : 0.5), u.y + this.rng.rnd(-0.3, 0.3), u.lvl);
      }
    }
  }

  /* ------------------------------------------------------------------ targeting */

  /** L1797-1802 */
  private canHit(u: Unit, e: Unit): boolean {
    if (e.dead) return false;
    if (u.tg === 'build') return e.kind === 'tower' || e.kind === 'build';
    if (e.fly && u.tg === 'ground') return false;
    return true;
  }

  /**
   * L1803-1832.
   *
   * Sight is 6 tiles for troops, the tower's own range for towers, and unlimited for
   * building-targeting units (they beeline). Towers get a +1.2 distance penalty so troops
   * standing next to one still prefer a nearby enemy troop. An inactive King Tower is
   * skipped while any other unit on its team survives.
   */
  private findTarget(u: Unit): Unit | null {
    let best: Unit | null = null;
    let bd = 1e9;
    const sight = u.kind === 'tower' ? u.rg : u.tg === 'build' ? 999 : 6.0;
    for (const e of this.state.units) {
      if (e.team === u.team || e.dead) continue;
      if (e.kind === 'tower' && e.twKind === 'king' && !e.active && u.tg !== 'build') {
        const anyOther = this.state.units.some(
          (o) => o.team === e.team && !o.dead && (o.kind !== 'tower' || o.twKind !== 'king'),
        );
        if (anyOther) continue;
      }
      if (!this.canHit(u, e)) continue;
      if (u.kind === 'tower' && e.kind === 'tower') continue;
      let d = dist(u, e) - e.rad;
      if (e.kind === 'tower') d += 1.2;
      if (d > sight) continue;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    // Nothing in sight: troops walk toward the nearest tower regardless of distance.
    if (!best && u.kind !== 'tower' && u.kind !== 'build') {
      let bt: Unit | null = null;
      let btd = 1e9;
      for (const e of this.state.units) {
        if (e.team === u.team || e.dead || e.kind !== 'tower') continue;
        if (e.twKind === 'king' && !e.active) {
          const alive = this.state.units.some(
            (o) => o.team === e.team && !o.dead && o.kind === 'tower' && o.twKind !== 'king',
          );
          if (alive) continue;
        }
        const d = dist(u, e);
        if (d < btd) {
          btd = d;
          bt = e;
        }
      }
      best = bt;
    }
    return best;
  }

  /** L1834-1847 — ground units route via the nearer bridge when crossing the river. */
  private moveGoal(u: Unit, t: Unit): { x: number; y: number } {
    if (u.fly) return { x: t.x, y: t.y };
    const meBot = u.y > 15;
    const crossing = (u.y > RIV_B && t.y < RIV_T) || (u.y < RIV_T && t.y > RIV_B);
    if (!crossing) return { x: t.x, y: t.y };
    const bx = Math.abs(u.x - BRIDGE[0]) < Math.abs(u.x - BRIDGE[1]) ? BRIDGE[0] : BRIDGE[1];
    if (meBot) {
      if (u.y > RIV_B + 0.35) return { x: bx, y: RIV_B + 0.2 };
      return { x: bx, y: RIV_T - 0.6 };
    } else {
      if (u.y < RIV_T - 0.35) return { x: bx, y: RIV_T - 0.2 };
      return { x: bx, y: RIV_B + 0.6 };
    }
  }

  /* --------------------------------------------------------------- update passes */

  /** L1849-1911 */
  private updateUnits(dt: number): void {
    const arr = this.state.units;
    // for...of over a live array on purpose: `killUnit` can push Behemoth shards mid-pass and
    // the prototype visited them in the same tick. Snapshotting `arr` here would change when
    // a shard's deploy timer starts.
    for (const u of arr) {
      if (u.dead) continue;
      if (u.flash > 0) u.flash = Math.max(0, u.flash - dt * 4);
      if (u.atkAnim > 0) u.atkAnim = Math.max(0, u.atkAnim - dt / Math.max(0.25, u.hs * 0.5));
      if (u.deploy > 0) {
        u.deploy -= dt;
        continue;
      }
      if (u.stun > 0) {
        u.stun -= dt;
        continue;
      }
      if (u.life) {
        u.life -= dt;
        if (u.life <= 0) {
          this.killUnit(u, u.team === 0 ? 1 : 0);
          continue;
        }
      }
      u.retarget -= dt;
      if (!u.target || u.target.dead || u.retarget <= 0) {
        u.target = this.findTarget(u);
        u.retarget = 0.3;
      }
      const t = u.target;
      if (!t) continue;
      const d = dist(u, t);
      const reach = u.rg + t.rad + u.rad * 0.35;
      if (d <= reach) {
        u.atkCd -= dt;
        if (u.atkCd <= 0) {
          u.atkCd = u.hs;
          u.atkAnim = 1;
          let dmg = u.dmg;
          if (u.card && u.card.charge && u.charged) {
            dmg *= u.card.charge;
            u.charged = 0;
            u.chargeRun = 0;
            this.emit({ k: 'charged', x: t.x, y: t.y });
          }
          if (u.proj) this.spawnProj(u, t, dmg);
          else {
            this.dealHit(u, t, dmg);
            this.emit({ k: 'melee', x: t.x, y: t.y });
          }
        }
        u.chargeRun = 0;
      } else {
        const g = this.moveGoal(u, t);
        const dx = g.x - u.x;
        const dy = g.y - u.y;
        const m = Math.hypot(dx, dy) || 1;
        let sp = u.sp;
        if (u.card && u.card.charge) {
          u.chargeRun += sp * dt;
          if (u.chargeRun > 3.2) {
            u.charged = 1;
            sp *= 1.6;
          }
        }
        if (u.card && u.card.dash && !u.dashed && d < 4.2 && d > 1.2) {
          u.dashed = 1;
          const k = (d - 1.0) / d;
          this.emit({ k: 'dash', x: u.x, y: u.y });
          u.x += dx * k * 0.9;
          u.y += dy * k * 0.9;
        }
        if (sp > 0) {
          u.x += (dx / m) * sp * dt;
          u.y += (dy / m) * sp * dt;
          u.walk += dt * sp * 4.6;
          u.face = dx < 0 ? -1 : 1;
        }
      }
    }

    // L1892-1909 — soft separation, then the river guard that funnels swimmers onto a bridge.
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (a.dead || a.sp === 0 || a.kind !== 'troop' || a.deploy > 0) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (b.dead || b.kind !== 'troop' || b.deploy > 0) continue;
        if (!!a.fly !== !!b.fly) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = (a.rad + b.rad) * 0.92;
        if (d < min && d > 0.0001) {
          const push = ((min - d) / 2) * 0.55;
          const nx = dx / d;
          const ny = dy / d;
          if (b.sp > 0) {
            b.x += nx * push;
            b.y += ny * push;
          }
          if (a.sp > 0) {
            a.x -= nx * push;
            a.y -= ny * push;
          }
        }
      }
      a.x = clamp(a.x, 0.45, AW - 0.45);
      a.y = clamp(a.y, 0.45, AH - 0.45);
      if (!a.fly && a.y > RIV_T && a.y < RIV_B) {
        const bx = Math.abs(a.x - BRIDGE[0]) < Math.abs(a.x - BRIDGE[1]) ? BRIDGE[0] : BRIDGE[1];
        if (Math.abs(a.x - bx) > 0.85) a.x = lerp(a.x, bx, Math.min(1, dt * 7));
      }
    }

    this.state.units = this.state.units.filter((u) => !u.dead || u.kind === 'tower');
  }

  /** L1913-1928 — splash hits everything near the target at 85%; chain arcs at 55%. */
  private dealHit(u: Unit, t: Unit, dmg: number): void {
    if (u.splash) {
      this.state.units.forEach((e) => {
        if (!e.dead && e.team !== u.team && this.canHit(u, e) && dist(e, t) <= u.splash + e.rad * 0.4) {
          this.hurt(e, dmg * (e === t ? 1 : 0.85), u.team);
        }
      });
      this.emit({ k: 'splash', x: t.x, y: t.y, radius: u.splash });
    } else if (u.card && u.card.chain) {
      this.hurt(t, dmg, u.team);
      let n = 0;
      const chain = u.card.chain;
      this.state.units.forEach((e) => {
        if (n >= chain) return;
        if (!e.dead && e !== t && e.team !== u.team && this.canHit(u, e) && dist(e, t) < 3.2) {
          n++;
          this.hurt(e, dmg * 0.55, u.team);
          this.emit({ k: 'chain', x: e.x, y: e.y - e.rad });
        }
      });
    } else {
      this.hurt(t, dmg, u.team);
    }
  }

  /** L1930-1936 */
  private spawnProj(u: Unit, t: Unit, dmg: number): void {
    this.state.projs.push({
      x: u.x, y: u.y - u.rad * 1.1, tx: t.x, ty: t.y - t.rad * 0.5, target: t,
      sp: u.proj === 'lightning' ? 26 : 11, dmg, team: u.team, kind: u.proj!, owner: u, t: 0,
    });
    this.emit({ k: 'shoot', kind: u.proj! });
  }

  /** L1937-1957 — homing while the target lives; splash-on-arrival otherwise. */
  private updateProjs(dt: number): void {
    for (const p of this.state.projs) {
      if (p.dead) continue;
      if (p.target && !p.target.dead) {
        p.tx = p.target.x;
        p.ty = p.target.y - p.target.rad * 0.5;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      p.t += dt;
      if (d < 0.28 || p.t > 3) {
        p.dead = true;
        if (p.target && !p.target.dead) this.dealHit(p.owner, p.target, p.dmg);
        else {
          this.state.units.forEach((e) => {
            if (!e.dead && e.team !== p.team && dist(e, { x: p.tx, y: p.ty }) < 0.6) this.hurt(e, p.dmg, p.team);
          });
        }
        this.emit({ k: 'projHit', x: p.x, y: p.y, kind: p.kind });
        continue;
      }
      p.x += (dx / d) * p.sp * dt;
      p.y += (dy / d) * p.sp * dt;
      p.ang = Math.atan2(dy, dx);
    }
    this.state.projs = this.state.projs.filter((p) => !p.dead);
  }

  /** L1959-1966 — spent spells linger 0.5 s so the client can finish drawing them. */
  private updateSpells(dt: number): void {
    for (const sp of this.state.spells) {
      if (sp.done) continue;
      sp.t += dt;
      if (sp.t >= sp.dur) {
        sp.done = true;
        this.applySpell(sp);
      }
    }
    this.state.spells = this.state.spells.filter((s) => !s.done || s.t < s.dur + 0.5);
  }

  /* -------------------------------------------------------------------- ending */

  /**
   * L2037-2046.
   *
   * Discrepancy D10: the tiebreak compares the *lowest surviving tower HP fraction* per
   * side, not total HP lost as handoff §2 describes.
   */
  private timeUp(): void {
    const B = this.state;
    if (B.phase === 'normal') {
      if (B.crowns[0] !== B.crowns[1]) {
        this.endBattle(B.crowns[0] > B.crowns[1] ? 'win' : 'lose', false);
        return;
      }
      B.phase = 'over';
      B.phaseTick = 0;
      B.phaseTicks = OVERTIME_SECONDS * TICK_HZ;
      B.t = OVERTIME_SECONDS;
      this.emit({ k: 'phase', phase: 'over' });
    } else {
      let lo0 = 1e9;
      let lo1 = 1e9;
      B.units.forEach((u) => {
        if (u.kind === 'tower' && !u.dead) {
          if (u.team === 0) lo0 = Math.min(lo0, u.hp / u.maxHp);
          else lo1 = Math.min(lo1, u.hp / u.maxHp);
        }
      });
      this.endBattle(lo1 < lo0 ? 'win' : lo0 < lo1 ? 'lose' : 'draw', false);
    }
  }

  /** L2047-2053 */
  private endBattle(res: MatchOutcome, instant: boolean): void {
    if (this.state.over) return;
    this.state.over = true;
    this.state.endResult = res;
    this.state.endInstant = instant;
    this.emit({ k: 'end', result: res, instant });
  }

  /* ---------------------------------------------------------------- play inputs */

  /**
   * L2288-2296 — play card `i` from the player's hand. Returns false if it was illegal, and
   * on the server a false here voids the match (handoff §5).
   */
  playHand(i: number, x: number, y: number): boolean {
    const B = this.state;
    const cid = B.hand[i];
    const card = CARD[cid];
    if (!card || B.elix[0] < card.cost || !this.canDeployAt(0, x, y, card)) return false;
    B.elix[0] -= card.cost;
    B.stat.elix += card.cost;
    // Verbatim: spells have no `cnt`, so casting one counts as 1 toward the "deploy troops"
    // quest. Odd, but it's what the prototype credits.
    B.stat.depl += card.cnt || 1;
    this.deployCard(cid, 0, x, y, this.myCardLevel(cid));
    B.hand[i] = B.queue.shift()!;
    B.queue.push(cid);
    return true;
  }

  /** Convenience for replay: play by card id, resolving the hand slot. */
  playCardId(cid: string, x: number, y: number): boolean {
    const i = this.state.hand.indexOf(cid);
    if (i < 0) return false;
    return this.playHand(i, x, y);
  }

  private myCardLevel(cid: string): number {
    return this.state.myCardLevels[cid] || 1;
  }

  /** L1982-1990 — AI plays hand slot `i`, retrying once clamped into its own half. */
  aiPlay(i: number, x: number, y: number): boolean {
    const B = this.state;
    const cid = B.aiHand[i];
    const card = CARD[cid];
    if (!card || B.elix[1] < card.cost) return false;
    if (!this.canDeployAt(1, x, y, card)) {
      y = clamp(y, 1.2, RIV_T - 1.2);
      if (!this.canDeployAt(1, x, y, card)) return false;
    }
    B.elix[1] -= card.cost;
    this.deployCard(cid, 1, x, y, B.aiLvl);
    B.aiHand[i] = B.aiQueue.shift()!;
    B.aiQueue.push(cid);
    return true;
  }

  /* ---------------------------------------------------------------------- tick */

  /**
   * Advance one fixed step. `aiStep` is injected so `ai.ts` can stay a separate module
   * without a circular import; pass `null` for a sim with no AI opponent (Phase 2 PvP).
   */
  tick(aiStep: ((sim: Sim, dt: number) => void) | null): SimEvent[] {
    this.events = [];
    const B = this.state;
    if (B.over) return this.events;

    const dt = DT;
    B.tick++;
    B.phaseTick++;
    // The clock is *derived*, not accumulated. Subtracting an inexact 1/30 seven thousand
    // times leaves the match 33 ms long and costs an extra tick per phase; deriving from the
    // integer counter makes regulation exactly 5400 ticks and the x2 window exactly the last
    // 1800. Deterministic either way — this one is just correct.
    B.time = B.tick / TICK_HZ;
    B.t = (B.phaseTicks - B.phaseTick) / TICK_HZ;
    // L2352 — phase check precedes the clock check, so overtime is x3 (D9).
    B.mult = B.phase === 'over' ? 3 : B.t <= 60 ? 2 : 1;
    B.elix[0] = Math.min(ELIX_MAX, B.elix[0] + B.elixRate * B.mult * dt);
    B.elix[1] = Math.min(ELIX_MAX, B.elix[1] + B.elixRate * B.mult * dt);

    if (aiStep) aiStep(this, dt);
    this.updateUnits(dt);
    this.updateProjs(dt);
    this.updateSpells(dt);
    if (B.t <= 0) this.timeUp();

    return this.events;
  }

  /** Stable fingerprint of the finished match — used by the determinism suite and audits. */
  hash(): string {
    const B = this.state;
    const parts: (string | number)[] = [B.endResult || 'none', B.crowns[0], B.crowns[1], B.tick, Math.round(B.stat.dmg), B.stat.crown, B.stat.depl, B.stat.elix];
    for (const u of B.units) {
      if (u.kind !== 'tower') continue;
      parts.push(`${u.team}${u.side}:${u.dead ? 'x' : Math.round(u.hp)}`);
    }
    const s = parts.join('|');
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

/** Free-function form of `towerAlive` for the renderer's facade. */
export function towerAlive(state: { units: Unit[] }, team: 0 | 1, side: string): boolean {
  return state.units.some((u) => u.kind === 'tower' && u.team === team && u.side === side && !u.dead);
}

/** Free-function form of `canDeployAt` for the renderer's facade (same rules as Sim's). */
export function canDeployAt(state: { units: Unit[] }, team: 0 | 1, x: number, y: number, card: Card): boolean {
  if (card.t === 'spell') return x >= 0 && x <= AW && y >= 0 && y <= AH;
  if (x < 0.7 || x > AW - 0.7 || y < 0.7 || y > AH - 0.7) return false;
  if (team === 0) {
    if (y >= RIV_B + 1.1) return true;
    if (!towerAlive(state, 1, 'L') && x < AW / 2 && y >= 8.4) return true;
    if (!towerAlive(state, 1, 'R') && x >= AW / 2 && y >= 8.4) return true;
    return false;
  }
  if (y <= RIV_T - 1.1) return true;
  if (!towerAlive(state, 0, 'L') && x < AW / 2 && y <= AH - 8.4) return true;
  if (!towerAlive(state, 0, 'R') && x >= AW / 2 && y <= AH - 8.4) return true;
  return false;
}

/** Ticks a whole match headlessly, applying a deploy log. Used by the server and by tests. */
export function runMatch(
  cfg: SimConfig,
  deployLog: DeployLogEntry[],
  aiStep: ((sim: Sim, dt: number) => void) | null,
  opts: { maxTicks?: number; onIllegal?: (entry: DeployLogEntry, reason: string) => void } = {},
): { sim: Sim; illegal: { entry: DeployLogEntry; reason: string } | null } {
  const sim = new Sim(cfg);
  const maxTicks = opts.maxTicks ?? Math.ceil((MATCH_SECONDS + OVERTIME_SECONDS + 5) * (1 / DT));
  const byTick = new Map<number, DeployLogEntry[]>();
  for (const e of deployLog) {
    const list = byTick.get(e.t);
    if (list) list.push(e);
    else byTick.set(e.t, [e]);
  }
  let illegal: { entry: DeployLogEntry; reason: string } | null = null;

  while (!sim.state.over && sim.state.tick < maxTicks) {
    const pending = byTick.get(sim.state.tick);
    if (pending) {
      for (const entry of pending) {
        if (!sim.playCardId(entry.cardId, entry.x, entry.y)) {
          const reason = sim.state.hand.indexOf(entry.cardId) < 0 ? 'card-not-in-hand' : 'illegal-deploy';
          illegal = { entry, reason };
          opts.onIllegal?.(entry, reason);
          return { sim, illegal };
        }
      }
    }
    sim.tick(aiStep);
  }
  return { sim, illegal };
}
