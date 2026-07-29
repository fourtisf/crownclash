# CROWN CLASH — Production Build (Claude Code Handoff)

You are taking an **approved, fully-working prototype** to production. Do not redesign the game, the balance, or the visual style. The prototype is the spec.

**Source of truth:** `crown-clash.html` (attached, ~166KB single file). Everything — battle engine, art engine, meta systems, UI — lives in that one file and runs. Your job is to restructure it for production, add a server-authoritative backend, and ship it, while keeping gameplay and visuals byte-for-byte identical in feel.

---

## 0. Context

- Clash Royale-style real-time arena battler. 1v1, 3-minute matches, elixir economy, 21 cards, towers, crowns.
- Prototype currently runs **fully client-side**: opponent is AI, persistence is a key-value `window.storage` shim, wallet connect is UI-only.
- Target: same game, hosted at a real domain, with **accounts, server-side saves, server-validated vs-AI matches (Phase 1), then real-time PvP (Phase 2)**, and $CROWN airdrop eligibility tracking.
- Infra: Hostinger VPS (Ubuntu), PM2, nginx, Cloudflare DNS. Postgres + Prisma, Redis. Same pattern as our other products.

---

## 1. Repo layout (create this)

```
crown-clash/
├─ packages/
│  └─ shared/            # THE game. Pure TS, zero DOM. Runs on server AND client.
│     ├─ src/
│     │  ├─ data.ts      # cards, arenas, chests, quests, login, shop (extracted from HTML)
│     │  ├─ sim.ts       # battle simulation (tick-based, deterministic)
│     │  ├─ ai.ts        # AI opponent logic
│     │  ├─ rng.ts       # seeded RNG (mulberry32) — sim must be deterministic per seed
│     │  └─ types.ts
│     └─ test/           # port the sim tests (see §8)
├─ apps/
│  ├─ web/               # Vite + vanilla TS client. Reuses prototype's art + UI code.
│  └─ server/            # Fastify + ws. Auth, saves, match validation, matchmaking.
├─ prisma/schema.prisma
└─ ecosystem.config.js   # PM2
```

**Extraction rule:** every constant in `data.ts` must be copied **verbatim** from `crown-clash.html`. Write a test that regex-extracts the constants from the HTML and diffs them against `data.ts` so drift is impossible. Do not "improve" numbers.

---

## 2. Game spec (authoritative constants — verify against HTML)

### Arena & towers
- Grid **18×30 tiles**. River rows y=14.15–15.85. Bridges centered at x=4.0 and x=14.0 (2.3 tiles wide walkable).
- Towers (team 0 = bottom/player): princess (3.3,23.4) & (14.7,23.4), king (9,27.1). Team 1 mirrored: (3.3,6.6), (14.7,6.6), king (9,2.9).
- Princess: hp 2400, dmg 92, hitSpeed 0.8s, range 7.4, radius 1.05.
- King: hp 4000, dmg 112, hitSpeed 1.0s, range 7.0, radius 1.30. **Inactive** until damaged directly or a same-side princess dies.
- Level scaling: all hp/dmg × `1.10^(level-1)` (cards use card level, towers use King Level).

### Match flow
- 180s regulation → if crowns tied: 60s sudden-death overtime (first tower wins) → if still tied: lowest-total-tower-HP-lost tiebreak → draw possible.
- Elixir: start 5, max 10, regen 1 per **2.8s**; ×2 in final 60s of regulation; ×3 in overtime.
- Deploy: own half only (y > 15.85 for team 0), not on river; spells anywhere. 1s deploy delay with spawn ring.
- King crown = instant win (3 crowns).
- Trophies: win `+rndi(28,33)`, loss `−rndi(18,26)`, floor 0. `best` tracked.
- XP: `xpNeed(l) = 140 + l*90`; XP from wins/upgrades; King Level up toasts "Towers get stronger".

### Cards (21 + 1 hidden)
IDs: ironclad, archers, sprites, bones(×10), wisps(fly), spears, turret(building, 30s life), volley(spell), jolt(spell+stun 0.7s), sharpshooter, warden(splash), colossus(buildings-only), meteor(spell), drakeling(fly, splash), boar(buildings-only, vfast), blademaster, lancer(charge ×2 dmg), pyromancer(splash), behemoth(8-cost, death-damage + splits into 2 `behemoth_mini`), voidblade(dash to first target), stormtitan(chain lightning, 3 targets).
Speeds: slow .72, med 1.05, fast 1.4, vfast 1.75 tiles/s. Full hp/dmg/range/count table: **extract from `CARDS` array in the HTML.**
Rarity odds (chest roll): common .755 / rare .20 / epic .04 / legendary .005.
Upgrade costs/cards per level (1→13): in `RARITY` object — extract verbatim.

### Meta economy
- Chests: wooden 3 cards / gold 60–120 / gem 0–2; silver 6 / 130–260 / 0–6; golden 12 / 300–560 / 4–16, **guarantees ≥1 rare**; magical 22 / 600–1100 / 10–30, **guarantees ≥1 epic**; legend 14 / 400–800 / 0–10, **guarantees 1 legendary**. Roll algorithm: `rollChest()` in HTML (2–6 card types, weighted counts) — port exactly.
- Shop: wooden 200g, silver 600g, golden 1800g, magical 280💎, legend 900💎, gold-pack 120💎→2500g.
- Free chest (wooden) every **3h**. Win chests queue, max 4 pending.
- Daily quests: 3 drawn from 7-type pool (play/win/crown/depl/dmg/chest/elix), goals & rewards per `QUEST_POOL`, reset on local date change.
- Login: 7-day cycle (200g, 25💎, wooden, 600g, 60💎, silver, golden+150💎), streak tracked.
- Arenas by trophies: 0 Training Camp, 300 Goblin Stadium, 700 Bone Pit, 1200 Frozen Peak, 1800 Ember Forge, 2600 Royal Arena, 3600 Legendary Arena. (Note: HTML array order lists Frozen Peak at 1200 — copy the array as-is, thresholds are what matter.)
- New account: 1200 gold, 120 gems, 12 starter cards, deck = ironclad/archers/sprites/spears/wisps/volley/jolt/colossus.

---

## 3. Phase plan

### Phase 1 — ship online vs-AI (this engagement's core)
1. **Extract** `packages/shared` from the HTML: data + sim + AI, deterministic under seeded RNG. The client and server import the same sim.
2. **Client** (`apps/web`): port the HTML's art engine, screens, and UI verbatim into modules. Landing page included. Replace `window.storage` with the API client (JWT in httpOnly cookie). Keep the local-save shim as offline fallback + **one-time migration**: on first login, if a local save exists, POST it to `/api/save/migrate` (server sanity-caps values, see anti-cheat).
3. **Server** (`apps/server`, Fastify):
   - Auth: guest account (device id) + optional wallet link (SIWE for EVM via viem; Solana `signMessage` verify). Wallet link grants the one-time +100 gem bonus **server-side** and marks airdrop eligibility.
   - Saves: server owns the save. Client sends **match intents**, not results.
   - **Match validation:** client requests `/api/match/start` → server creates match row with `seed`, AI deck, arena. Client plays locally against AI **using the seed**. Client streams its deploy log `[{t, cardId, x, y}]` on finish → server **re-runs the same sim headlessly** with that log + seed and computes the result itself. Client-claimed results are ignored. Mismatch or invalid log (elixir overdraft, wrong-half deploy, unknown card, >1 deploy per 300ms) ⇒ match voided.
   - Rewards (trophies, chest, quest progress, XP) applied server-side only.
4. **Ops:** Postgres+Prisma, Redis (sessions, rate limits, free-chest timers), nginx reverse proxy, PM2 two processes (`api`, worker for match re-sim), Cloudflare proxied DNS. Rate-limit auth & match endpoints.

### Phase 2 — real-time PvP (scaffold now, build after Phase 1 ships)
- ws (uWebSockets.js or `ws`) rooms; **server runs the sim at 20Hz**, clients send deploy intents only, server broadcasts state snapshots (10Hz) + events; client interpolates 100ms behind and renders with the existing art engine.
- Matchmaking: Redis sorted-set by trophies, widen ±50 → ±200 over 10s, fall back to AI disguised with the existing `AI_NAMES` (keep the current matchmaking modal UX).
- Reconnect window 15s; disconnect past that = concede.
- Kill client-side AI in PvP path; Phase 1 seeded-replay validation stays for vs-AI ladder.

### Phase 3 (scaffold only — do not build)
- $CROWN claim contract hooks, seasonal leaderboard resets, clans.

---

## 4. Prisma schema (start point — extend as needed)

```prisma
model User    { id String @id @default(cuid()); deviceId String @unique; wallet String? @unique;
                walletKind String?; airdropEligible Boolean @default(false); createdAt DateTime @default(now());
                save Save?; matches Match[] }
model Save    { id String @id @default(cuid()); userId String @unique; user User @relation(fields:[userId],references:[id]);
                json Json; trophies Int @default(0); best Int @default(0); updatedAt DateTime @updatedAt;
                @@index([trophies(sort: Desc)]) }
model Match   { id String @id @default(cuid()); userId String; seed String; mode String; // "ai" | "pvp"
                aiDeck Json?; deployLog Json?; result String?; crowns Json?; validated Boolean @default(false);
                createdAt DateTime @default(now()); user User @relation(fields:[userId],references:[id]) }
```

`Save.json` mirrors the prototype's `S` object 1:1 (same keys) so client code needs no remapping.

---

## 5. Anti-cheat / validation rules (server-side, Phase 1)

- Re-sim is the only source of results. Deploy log must satisfy: elixir ≥ cost at deploy tick (recompute with regen rules), position in own half & on land (spells exempt), card in player's 8-deck, hand-cycle order consistent (4-card hand, played card goes to back).
- Caps on migration & saves: gold ≤ 50k, gems ≤ 5k, trophies ≤ 4500, card levels within rarity max, counts ≥ 0. Anything above ⇒ clamp + flag.
- Server issues chest contents (seeded roll) — client only animates.
- Rate limits: match start 1/10s, chest open 1/2s, save write 1/5s per user.

---

## 6. Client porting rules

- **Do not restyle.** Extract the `<style>` block into `styles.css` unchanged, the art engine into `art.ts` unchanged (it's procedural canvas — no assets), screens into modules. The landing page ships as the site's `/` with PLAY NOW entering the app.
- Keep: Lilita One/Baloo 2 fonts, the sticker-button system, goldtext (never animate a `.goldtext` element directly — animate a wrapper; this avoids a real Chromium `background-clip:text` compositing bug we already hit), the landing hero canvas backdrop, live-engine scene, card fan.
- Keep all current runtime hardening: `S` initialized synchronously to `defaultState()` with `Sready` gating `persist()`; `sizeArena()` runs **after** hand render + rAF double-check + ResizeObserver on `#arenaWrap`; null-guards on pointer handlers; `Art.hq` shadow-gating when ≥28 units.
- Mobile is the primary target (480px frame). Test at 380×740.

## 7. Explicit DO NOTs

- No localStorage (artifact history is irrelevant now, but server save is canon; IndexedDB ok for offline cache).
- No gameplay/balance changes, no new cards, no renamed anything.
- No Clash Royale assets, names, or trade dress — our card names and art are original; keep it that way.
- No client-trusted results, currency, or chest rolls.
- No paid-promotion / gambling framing anywhere near the gacha (drop rates stay published, as in the prototype).

## 8. Testing (required before "done")

Port the prototype's harness approach:
1. **Sim determinism:** same seed + same deploy log ⇒ identical result hash, 1000 runs.
2. **Full-match sims:** AI vs AI to time-up, overtime path, king-instant-win path — 0 errors.
3. **Validation:** tampered logs (elixir overdraft, enemy-half deploy, unknown card) all rejected.
4. **E2E (Playwright):** landing → play → deploy 4 cards → result → chest open → quest claim → login reward → reload persists from server.
5. **Load:** 200 concurrent match validations < 2s p95 on the VPS.

## 9. Acceptance criteria

- `pnpm i && pnpm dev` runs web+server locally; `pnpm test` green.
- Deployed on the VPS behind Cloudflare with PM2 + nginx config committed.
- A fresh phone user can: land → play 3 AI matches → earn a chest → open it → see trophies on a `/api/leaderboard` endpoint → link a wallet → get +100 gems once → clear cookies → log back in via wallet with save intact.
- Diff test proving `data.ts` matches the HTML constants passes.

Start by reading `crown-clash.html` top to bottom, then produce the extraction plan as your first output before writing code.
