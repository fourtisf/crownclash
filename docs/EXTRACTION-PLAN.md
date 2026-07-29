# Crown Clash — Extraction Plan

Produced after a full read of `reference/crown-clash.html` (3,016 lines). This is the
contract for the port: what moves where, what must stay byte-identical, and where the
prototype **contradicts the handoff doc** (`docs/HANDOFF.md`).

**Governing rule:** the prototype is the spec. Where §2 of the handoff describes a number
that the HTML does not actually implement, the HTML wins and the deviation is recorded
here.

---

## 0. Source map — every line of the prototype accounted for

| HTML lines | Content | Destination |
|---|---|---|
| 1–8 | `<head>`, viewport, Google Fonts | `apps/web/index.html` |
| 9–493 | `<style>` block | `apps/web/src/styles.css` — **sliced verbatim by script** |
| 495–646 | app markup (landing, home, battle, modals) | `apps/web/index.html` + `apps/web/src/ui/templates.ts` |
| 655–666 | util (`$`, `clamp`, `lerp`, `rnd`, `rndi`, `pick`, `dist`, `fmt`, `nowMs`, `dayKey`) | split: pure math → `shared/src/util.ts`; DOM `$`/`$$` → `web/src/dom.ts` |
| 668–682 | `Store` shim + `persist()` | `web/src/api/save.ts` (server-backed) + `web/src/api/offline.ts` (IndexedDB) |
| 685–690 | `RARITY` | `shared/src/data.ts` — **verbatim** |
| 691 | `SPD` | `shared/src/data.ts` — **verbatim** |
| 694–741 | `CARDS`, `CARD` index | `shared/src/data.ts` — **verbatim** |
| 743–752 | `ARENAS`, `arenaFor()` | `shared/src/data.ts` — **verbatim** |
| 754–760 | `CHESTS` | `shared/src/data.ts` — **verbatim** |
| 762–779 | `QUEST_POOL`, `LOGIN_REWARDS` | `shared/src/data.ts` — **verbatim** |
| 782–797 | `defaultState()`, `ownsCard`, `cardLevel`, `statMul` | `shared/src/state.ts` |
| 802–1337 | art engine (`shade`…`renderPortrait`) | `apps/web/src/art.ts` — **sliced verbatim by script** |
| 1342–1374 | `Snd` | `apps/web/src/sound.ts` — verbatim |
| 1379–1403 | arena geometry, `TOWER_DEF`, `TOWER_POS`, `behemoth_mini`, `AI_DECKS`, `AI_NAMES` | `shared/src/data.ts` — **verbatim** |
| 1407–1433 | `findMatch()` matchmaking modal | `apps/web/src/screens/matchmaking.ts` |
| 1437–1475 | `startBattle()` | split: sim init → `shared/src/sim.ts`; DOM/HUD → `web/src/screens/battle.ts` |
| 1478–1662 | `buildArenaBG()`, `sizeArena()` | `apps/web/src/arenaBg.ts` — **sliced verbatim** |
| 1665–1911 | battle helpers, `canDeployAt`, spawn/deploy/spell, `hurt`, `killUnit`, targeting, movement, `updateUnits` | `shared/src/sim.ts` — logic verbatim, FX calls become emitted events |
| 1913–1977 | `dealHit`, projectiles, spells, `updateFX` | `shared/src/sim.ts` (logic) + `web/src/fx.ts` (particles) |
| 1980–2034 | AI | `shared/src/ai.ts` — verbatim, RNG rebound to seeded stream |
| 2037–2053 | `timeUp()`, `endBattle()` | `shared/src/sim.ts` |
| 2056–2226 | `render()` and helpers | `apps/web/src/render.ts` — **sliced verbatim** |
| 2229–2296 | battle HUD, hand, elixir | `apps/web/src/screens/battle.ts` |
| 2299–2361 | input binding + rAF `loop()` | `apps/web/src/screens/battle.ts` (loop becomes fixed-step accumulator) |
| 2367–2393 | screen switching, modals, `xpNeed`, `addXp`, `toastTop` | `web/src/ui/*` + `shared/src/progression.ts` (`xpNeed`, `addXp`) |
| 2396–2586 | header, tabs, home, chests | `apps/web/src/screens/home.ts` |
| 2589–2680 | card nodes, collection, card detail, deck swap | `apps/web/src/screens/cards.ts` |
| 2683–2717 | `SHOP`, `renderShop` | `SHOP` → `shared/src/data.ts`; UI → `web/src/screens/shop.ts` |
| 2720–2802 | `pickRarity`, `rollChest`, `grantChest`, `openChest` | roll/grant → `shared/src/economy.ts` (**server-authoritative**); tap-to-open UI → `web/src/screens/chest.ts` |
| 2805–2849 | quests | `shared/src/economy.ts` + `web/src/screens/quests.ts` |
| 2852–2887 | login rewards | `shared/src/economy.ts` + `web/src/screens/login.ts` |
| 2890–2936 | wallet + settings | `apps/web/src/screens/wallet.ts` (now calls SIWE / Solana verify endpoints) |
| 2939–2970 | `showResult()` | reward math → `shared/src/economy.ts` (server); UI → `web/src/screens/result.ts` |
| 2973–3013 | `markDots`, `init`, `welcome`, resize hooks | `apps/web/src/main.ts` |

---

## 1. Verbatim-extraction strategy (drift is impossible by construction)

Three tiers, strongest first:

1. **Script-sliced files.** `styles.css`, `art.ts`, `arenaBg.ts`, `render.ts` are produced by
   `tools/extract.mjs`, which slices exact line ranges out of `reference/crown-clash.html`
   and wraps them with a generated header + import/export prelude. Byte-for-byte by
   construction. `pnpm extract:check` re-runs the slice and fails if the committed file's
   body differs.
2. **Constant diff test** (handoff §1, §9). `packages/shared/test/data-parity.test.ts`
   regex-extracts `RARITY`, `SPD`, `CARDS`, `ARENAS`, `CHESTS`, `QUEST_POOL`,
   `LOGIN_REWARDS`, `TOWER_DEF`, `TOWER_POS`, `AI_DECKS`, `AI_NAMES`, `SHOP`,
   `behemoth_mini`, and the arena scalars from the HTML, evaluates them in a sandbox, and
   deep-equals them against `data.ts`. Any "improved" number fails CI.
3. **Behavioural golden test.** A recorded 180 s AI-vs-AI match hash, pinned in
   `packages/shared/test/__snapshots__/`, so sim refactors can't silently change outcomes.

---

## 2. Determinism plan

The prototype's loop is variable-`dt` rAF with `dt = min(0.05, elapsed)`. That can never be
re-simulated. The port makes the sim a **fixed-step pure function**:

- `TICK_HZ = 30`, `DT = 1/30`. The prototype already clamped `dt` to `0.05` (20 Hz worst
  case), so 30 Hz sits inside the range the prototype was tuned at and is strictly closer to
  the typical 60 Hz frame it actually ran at.
- Client runs an accumulator (`while (acc >= DT) sim.tick()`) and **renders interpolated**
  between the last two states, so the felt smoothness is unchanged.
- Phase 2's server loop broadcasts snapshots at 10 Hz (every 3rd tick); the sim itself stays
  at 30 Hz on both ends. (Handoff §3 says "server runs the sim at 20Hz" — recorded as a
  deviation: one tick rate must be shared by client and server or re-sim breaks, and 30 Hz
  is the better of the two.)
- **All** gameplay randomness moves onto one seeded `mulberry32` stream: deck shuffles,
  `atkCd: rnd(0,.25)`, `walk: rnd(0,6)`, multi-unit deploy spread, behemoth split jitter, and
  every AI decision (`Math.random()` and `rnd()` inside `aiUpdate`).
- **Presentation randomness stays off the sim stream.** Particles, floats, screen shake and
  sound are not simulation state. `sim.tick()` returns an event list
  (`hit`, `death`, `towerDown`, `spellImpact`, `deploy`, `crown`, `phase`); `web/src/fx.ts`
  replays those events into exactly the particle bursts the prototype spawned, using an
  unsynchronised client RNG. Visually identical, and the server never allocates a particle.

---

## 3. Prototype-vs-handoff discrepancies (prototype wins — these are the ones that matter)

| # | Handoff §2 says | `crown-clash.html` actually does | Resolution |
|---|---|---|---|
| **D1** | "all hp/dmg × `1.10^(level-1)` (cards use card level, **towers use King Level**)" | Cards use `statMul = 1.10^(lv-1)` (L797). **Towers use `Math.pow(1.085, lv-1)`** (L1459) — a different base. | Ship two functions: `statMul()` = 1.10, `towerMul()` = 1.085. Both pinned by the parity test. Using 1.10 for towers would inflate a level-13 King Tower by ~24%. |
| **D2** | "Deploy: own half only (**y > 15.85** for team 0)" | `canDeployAt` requires `y >= RIV_B + 1.1` = **y ≥ 16.95**, plus a forward zone `y ≥ 8.4` on a lane whose enemy princess is dead (L1668–1682). | Port `canDeployAt` verbatim. The 1.1-tile buffer and the destroyed-tower push zone are both real mechanics; the server validator uses the same function, so a "spec-correct" 15.85 would void legitimate matches. |
| **D3** | "1s deploy delay with spawn ring" | `deploy: 1.0` counts down but the unit is **also skipped by the separation pass** while deploying, and `atkCd` starts at `rnd(0,.25)` — so first swing lands at 1.0–1.25 s. | Verbatim. |
| **D4** | Card list order implies `jolt` is a rare | `jolt` is declared inside the rare block but is `r:'common'`, cost 2 (L724). | Verbatim — it is a common. Affects chest pools and upgrade costs. |
| **D5** | "Chests: … legend 14 / 400–800 / 0–10" | Matches. But `rollChest` computes `types = clamp(round(cards/3.2), 2, 6)` and the **guarantee only applies to `i === 0`** — a legendary chest yields exactly one guaranteed legendary, the rest roll normally (L2726–2742). | Verbatim, and moved server-side. |
| **D6** | "Arenas … (HTML lists Frozen Peak at 1200 — copy as-is)" | Confirmed: index 3 = Frozen Peak @ 1200. Handoff is right that the array is the authority. | Verbatim. |
| **D7** | Trophy floor 0 | `Math.max(0, …)` confirmed (L2942). `best` tracked. | Verbatim. |
| **D8** | — (not mentioned) | **AI level** is `clamp(1 + floor(trophies/240), 1, 13)` (L1440), and AI *deck* index is the **arena index**, clamped to `AI_DECKS.length-1` = 5. Arena 7 (Legendary) reuses deck 5. | Verbatim; recorded so it isn't "fixed". |
| **D9** | — | Overtime uses `B.t = 60` while `B.mult` is chosen by `phase === 'over' ? 3 : (t <= 60 ? 2 : 1)`. Phase check precedes the time check, so OT is ×3 not ×2. | Verbatim. |
| **D10** | — | `timeUp()` tiebreak compares **lowest surviving tower HP fraction**, not total HP lost as §2 states. `lo1 < lo0 → win`. | Verbatim (`hp/maxHp` minimum). |

### Prototype bugs being fixed in the port (with rationale)

| # | Bug | Fix |
|---|---|---|
| **B1** | `refreshHome()` calls `$('#homeBody').addEventListener('click', …)` **inside the function** (L2538). Every visit to the Home tab attaches another BATTLE handler, so the *n*th visit fires `findMatch()` *n* times. | Bind once at init. Pure leak; no gameplay meaning. |
| **B2** | `B` object literal declares `sc:` twice (L1443 `sc:10`, L1445 `sc:12`) and an unused `uid0:0`. | Single `sc`, set by `sizeArena()` before first render. |
| **B3** | `render()` L2158 reads `if (dp<=0 && u.hp<u.maxHp || u.kind==='tower')` — precedence makes towers always draw a bar even mid-deploy. | Kept as-is: it is the observed visual and towers never deploy. Documented, not changed. |
| **B4** | `Store` silently swallows every error and falls back to an in-memory map, so a failed save looks identical to a successful one. | Server save with explicit failure surfacing + IndexedDB offline queue. |
| **B5** | *New in the port.* §5 voids a match with two deploys inside 300 ms, but nothing stopped the client from recording them — two 2-cost cards at 10 elixir is well inside that window, so an honest fast player would have their match voided. | The client enforces the same floor in `playHand` and refuses the tap (with the prototype's "can't afford" buzz) rather than recording a log the server will reject. |

### Slice-prelude decisions (`tools/extract.mjs`)

The four verbatim slices reference identifiers the prototype had as globals. Rather than edit
the slices, the generated preludes supply them:

- **`arenaBG`** — exported from `arenaBg.ts` as `export let`. ES module live bindings mean
  `render.ts` sees each rebuilt backdrop the instant `buildArenaBG()` reassigns it, matching
  the shared-global behaviour the slice was written against. The slice's `arenaBG = cv;` is
  untouched.
- **`rnd`** — defined locally in `render.ts` (screen shake) and `sound.ts` (blip detune).
  `@crown/shared` deliberately exposes randomness *only* on a seeded `Rng`, so no simulation
  code can reach an unseeded source; these two are presentation-only and must stay off that
  stream, or a dropped frame could change a match hash.
- **`S`** — a one-field mirror (`{trophies}` / `{sfx}`) set by `setArenaTrophies()` /
  `setSfxEnabled()`, so the slices keep reading `S.x` as they always did.
- **`B` / `aCtx`** — assigned by `bindRenderer()`; `B` is the facade described in §2.

### Copy kept verbatim (mixed Indonesian/English)

`hms()` renders hours as `3j 0m`; `'BARU!'`, `'Arena tertinggi!'`, `'Sudah diambil — balik besok!'`,
`'…tersambung'`, `'…didapat!'`, `'SUARA: ON/OFF'`, `'3 menit'`, `'Progress tersimpan otomatis'`,
and `<html lang="id">`. Handoff §7 says "no renamed anything" — all strings ship unchanged and
are centralised in `apps/web/src/i18n/strings.ts` so a future pass can localise without a
gameplay diff.

---

## 4. Module boundaries

```
packages/shared          pure TS, zero DOM, zero Node built-ins — runs in browser AND on server
  rng.ts                 mulberry32 + rnd/rndi/pick/shuffle bound to a stream
  util.ts                clamp lerp dist fmt dayKey xpNeed statMul towerMul
  types.ts               Card, Unit, SimState, DeployLogEntry, MatchResult, SaveState …
  data.ts                every constant, verbatim
  state.ts               defaultState(), ownsCard, cardLevel
  sim.ts                 createSim(seed, cfg) → { tick(), deploy(), state, events }
  ai.ts                  aiUpdate(sim) — seeded, deterministic
  economy.ts             rollChest, grantChest, quests, login, trophy/XP/reward math
  validate.ts            deploy-log legality + save sanity caps
apps/web                 Vite + vanilla TS; art/styles/render sliced verbatim
apps/server              Fastify + ws; owns saves, re-sims matches, issues chests
```

The client imports `sim.ts` for local play and the server imports the *same file* for
re-validation. There is exactly one copy of the rules.

---

## 5. Order of work

1. Monorepo scaffold, `tools/extract.mjs`, parity test harness. ← proves fidelity before any logic moves
2. `shared`: rng → util → types → data → state → sim → ai → economy → validate
3. Sim test suite (determinism ×1000, full-match, overtime, king-instant-win, tampered logs)
4. `apps/server`: Prisma schema, auth, saves, match start/finish + re-sim, chests, leaderboard, rate limits
5. `apps/web`: sliced art/styles/render, then screens, then API client + offline fallback + migration
6. E2E, load test, PM2/nginx/Cloudflare ops files
