# Crown Clash

A real-time arena battler for the browser: 1v1, three-minute matches, elixir economy, 21 cards,
towers, crowns. Mobile-first — the whole thing is designed around a 480px frame and tested at
380×740.

This repo is the **production port of an approved prototype**. The prototype is
[`reference/crown-clash.html`](reference/crown-clash.html), a single 166 KB file that already ran
the complete game client-side. It is not documentation; it is the spec. The port's job is to
restructure it into a monorepo, move every rule the player can profit from onto a server, and
ship it — without changing how the game looks or feels.

---

## Status

| Area | State |
|---|---|
| `packages/shared` — data, sim, AI, economy, validation | Implemented, with tests |
| `apps/server` — Fastify API, auth, saves, server-side match validation | Implemented, with tests |
| `apps/web` — client, ported screens, verbatim art/CSS/renderer | Implemented; typechecks and builds clean |
| Phase 2 real-time PvP | **Scaffold only, and server-side only.** `/ws` accepts authenticated sockets and pairs players by trophies; the authoritative game loop is not implemented and a `deploy` message is answered with `pvp_not_enabled`. **The client never opens the socket** — nothing in `apps/web/src` references `/ws`. |
| Ops (PM2, nginx, deploy script, CI) | Written and reviewed. Never executed against a server; the review that hardened them is the only thing they have been through. |
| Deployed to a VPS | **No.** Nothing here has run on a server. See [Deploying](#deploying). |
| `prisma/migrations/` | **Not created yet.** `prisma/schema.prisma` is committed; the initial migration is not. See [`docs/DEPLOY.md`](docs/DEPLOY.md) § Migrations. |
| Running the *compiled* server under plain Node | **Yes.** `pnpm build` emits `packages/shared/dist` and `apps/server/dist`, and `node apps/server/dist/src/index.js` — the exact file PM2 runs — boots and answers `/api/health` with `"env":"production"`. Verified locally with real `AUTH_SECRET`/`COOKIE_SECRET`; still never run on a VPS. |

---

## Quickstart

Requires **Node ≥ 20.11** (CI and the VPS run 22) and a local **Postgres**. pnpm comes from
corepack — `package.json` pins the exact version, so don't install it by hand.

```bash
corepack enable
pnpm install
pnpm dev          # web on :5173, API on :8080, in parallel
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` and `/ws` to the API on 8080, so
the client is same-origin with the server in development exactly as it is in production — cookies,
CORS and the SIWE domain binding all behave the same in both.

Postgres is the only hard dependency: the API expects
`postgresql://crown:crown@localhost:5432/crown?schema=public` unless `DATABASE_URL` says
otherwise. Redis is optional locally — `apps/server/src/lib/redis.ts` falls back to an in-process
implementation of the handful of commands the server uses, and `/api/health` tells you which one
you got.

`apps/web/vite.config.ts` binds the dev server on all interfaces, so a real phone on the same wifi
can open it. Do that early; a desktop emulator does not reproduce touch latency or the safe-area
insets the layout depends on.

---

## Layout

```
packages/shared/       THE GAME. Pure TypeScript, zero DOM, zero Node built-ins.
  src/data.ts            every constant, copied verbatim from the prototype
  src/rng.ts             mulberry32 — the only source of randomness the sim may touch
  src/sim.ts             deterministic fixed-step (30 Hz) battle simulation
  src/ai.ts              the AI opponent, on the same seeded stream
  src/economy.ts         chests, quests, login rewards, trophies, XP, upgrades
  src/validate.ts        deploy-log legality + save sanity caps
  src/api.ts             the HTTP contract — one type per endpoint, shared by both sides

apps/server/           Fastify + ws. Owns saves, re-simulates matches, issues chest rolls.
  src/index.ts           the `crown-api` process
  src/worker.ts          the `crown-worker` process — audit re-sims, leaderboard, reaping
  src/ws.ts              Phase 2 transport + matchmaking (scaffold)

apps/web/              Vite + vanilla TS client. No framework.
  src/art.ts             \
  src/render.ts           |  sliced byte-for-byte out of the prototype by tools/extract.mjs
  src/arenaBg.ts          |  — never hand-edited
  src/sound.ts            |
  src/styles.css         /

prisma/schema.prisma   Postgres schema
tools/extract.mjs      the verbatim slicer + its drift check
ops/                   nginx, deploy script, VPS setup
reference/             the approved prototype
docs/                  the extraction plan and the deploy runbook
```

---

## One simulation, two runtimes

The client and the server import **the same file** for the battle rules.

`packages/shared/src/sim.ts` is a fixed-step (30 Hz) deterministic simulation driven entirely by a
seeded `mulberry32` stream. Given a seed and an ordered list of deploys, it produces exactly one
outcome, on any machine, forever. Nothing in it touches the DOM, `Date.now()`, or `Math.random()`.

That single property is what makes the anti-cheat work:

1. The client asks for a match. The server creates a row with a **seed**, the AI deck and the
   arena, and freezes that config.
2. The client plays the match locally against the AI, using that seed. It feels like a normal
   single-player game because it is one.
3. On finish the client posts its **deploy log** — `[{t, cardId, x, y}]` — and nothing else. It
   does not report who won.
4. The server re-runs the same simulation headlessly with that seed and that log, and computes the
   result itself. Trophies, chests, quest progress and XP are applied from *its* answer.
5. An illegal log (elixir overdraft, deploy in the enemy half, a card not in the player's deck,
   two deploys inside 300 ms) voids the match.

Rewards, chest contents and currency are never client-supplied. The re-simulation is the only
source of a result.

`crown-worker` then replays every finished match a **second** time and compares the result hash
with what the API recorded. Under normal operation the two always agree — which is exactly the
point. The day they disagree, the simulation has stopped being deterministic and match validation
has silently stopped working. That is the loudest line in the logs.

---

## How the port stays honest

The risk in a port like this is drift: a number that gets "improved", a shader tweak, a colour
that looked slightly off at 2am. Three mechanisms make that fail loudly instead of silently.

**1. Verbatim slices.** `apps/web/src/{art,render,arenaBg,sound}.ts` and `src/styles.css` are not
written by hand. `tools/extract.mjs` cuts exact line ranges out of `reference/crown-clash.html`
and wraps them in a generated import/export prelude. `pnpm extract:check` re-slices and fails if a
committed file's body has drifted by a single byte. This is the **first** step in CI, before
typecheck and before tests, because a hand-edit to one of those files typechecks fine, tests fine,
and quietly breaks the claim that the shipped game *is* the approved prototype.

```bash
pnpm extract:check      # ✓ 5 files, verbatim
```

**2. Constant diff test.** `packages/shared/test/data-parity.test.ts` regex-extracts `CARDS`,
`RARITY`, `SPD`, `ARENAS`, `CHESTS`, `QUEST_POOL`, `LOGIN_REWARDS`, `TOWER_DEF`, `TOWER_POS`,
`AI_DECKS`, `AI_NAMES`, `SHOP` and the arena scalars straight from the HTML, evaluates them, and
deep-equals them against `data.ts`. Any balance change fails CI whether it was deliberate or not.

**3. Behavioural tests.** Determinism (same seed + same log ⇒ identical result hash, a thousand
times over), full-match AI-vs-AI runs through the overtime and king-crown paths, and every class
of tampered log the brief names.

Where the prototype and the written brief disagree, the prototype wins and the deviation is
recorded — ten of them, D1–D10, in [`docs/EXTRACTION-PLAN.md`](docs/EXTRACTION-PLAN.md). Worth
reading before changing anything that looks like a bug; several of them are.

---

## Tests

```bash
pnpm test                              # everything, in dependency order
pnpm --filter @crown/shared test       # sim, economy, validation, data parity
pnpm --filter @crown/server test       # API, match validation, worker, load
pnpm --filter @crown/web test          # FX event replay
pnpm --filter @crown/web e2e           # Playwright journey (needs browsers + a running stack)
pnpm typecheck
pnpm extract:check
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs, in order: install with a frozen
lockfile → `extract:check` → typecheck → test → build → assert that PM2's entrypoints exist on
disk and that the ops shell scripts parse. That last step exists because the deploy configuration
is the only thing here that nothing imports, typechecks or tests: a tsconfig change that moves the
build output leaves every other gate green and only shows up as a crash-looping PM2 app.
Playwright is deliberately not in this workflow; it needs browsers and a live server.

---

## Deploying

**This has not been done.** No VPS, no domain, no database, no credentials — the only secrets in
the tree are the `dev-only-…` placeholders in `.env.example`, which the API refuses to start with
in production. The deployment configuration below is written and reviewed, and that is all it is.

Nothing here has run on a server. `apps/server/test/load.test.ts` measures match-validation p95
in a single Node process on a developer machine, which bounds the CPU cost of the expensive
endpoint and nothing else — it is not a load test of the deployment, and no request has ever
crossed nginx, Cloudflare or PM2.

What is in the repo:

| File | What it is |
|---|---|
| [`ecosystem.config.js`](ecosystem.config.js) | PM2: `crown-api` (cluster) and `crown-worker` (fork), memory limits, graceful reload, log paths |
| [`ops/nginx/crown-clash.conf`](ops/nginx/crown-clash.conf) | Reverse proxy, SPA static serving, Cloudflare real-IP, `/ws` upgrade, caching, CSP |
| [`ops/deploy.sh`](ops/deploy.sh) | Idempotent deploy: pull → install → build → migrate → atomic static swap → zero-downtime reload → health check → automatic rollback. Its control flow (rollback on build failure, on health failure, release naming, pruning, the lock) was exercised against stubbed `git`/`pnpm`/`pm2`/`curl`; the real `pm2` and `nginx` halves are unexercised. |
| [`ops/README.md`](ops/README.md) | First-time VPS build-out: Node, pnpm, Postgres, Redis, nginx, certs, PM2 boot persistence, firewall |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | The runbook: env vars, Cloudflare settings, migrations, rollback, monitoring, triage |

What a human has to do, in order:

1. Provision an Ubuntu VPS and work through [`ops/README.md`](ops/README.md) — it goes from a bare
   image to a box `deploy.sh` can target.
2. Create the initial Prisma migration and commit it (`docs/DEPLOY.md` § Migrations). The deploy
   script refuses to run without it.
3. Put the real hostname into `ops/nginx/crown-clash.conf` — two `server_name` lines, one per
   `server` block — and commit it. `ops/deploy.sh` runs `git reset --hard` on the VPS checkout,
   so anything edited in place there is reverted on the next deploy.
4. Generate `AUTH_SECRET` and `COOKIE_SECRET` into `/etc/crown-clash/app.env`. The API refuses to
   boot in production while they are still the dev placeholders.
5. Point DNS at Cloudflare, proxied, SSL/TLS mode **Full (strict)**, with a Cloudflare Origin CA
   certificate on the box.
6. Run `ops/deploy.sh`, then walk the [`docs/DEPLOY.md`](docs/DEPLOY.md) pre-flight list.

The pre-flight list is not ceremony. Every item on it is something CI structurally cannot catch —
starting with whether the compiled server boots under plain Node, which is the one code path that
`pnpm dev`, `vitest` and `tsc` all resolve differently from the way PM2 will.

One thing `deploy.sh` cannot do for you: `prisma generate` only resolves `@prisma/client` from
inside `apps/server`, so the script generates against a symlink it creates there. The permanent
one-line fix is in [`docs/DEPLOY.md`](docs/DEPLOY.md) § Migrations.

---

## Phases

**Phase 1 — online vs-AI. This is what the repo builds.** Guest accounts by device id, optional
wallet linking (SIWE for EVM, `signMessage` for Solana) with a one-time server-issued bonus and
airdrop-eligibility marking, server-owned saves with a one-time migration from a local save,
server-validated matches by seeded replay, server-issued chest rolls, a trophy leaderboard, and
rate limits on the endpoints that matter.

**Phase 2 — real-time PvP. Scaffolded on the server, absent from the client.**
`apps/server/src/ws.ts` accepts authenticated socket upgrades and runs Redis-backed matchmaking
that widens ±50 → ±200 over ten seconds and then tells the client to fall back to the vs-AI path.
Nothing in `apps/web/src` opens that socket today: Phase 1 goes straight from the prototype's
matchmaking modal into a local match, so the fallback path is a server-side design decision, not
a shipped behaviour. What is missing on the server is the authoritative loop — ticking the sim at
30 Hz, applying deploy intents at tick boundaries, broadcasting snapshots at 10 Hz — and on the
client, everything. nginx already proxies `/ws` with the upgrade headers and a long read timeout,
so no infrastructure change is needed. Two caveats are written down in
[`docs/DEPLOY.md`](docs/DEPLOY.md): rooms live in a per-process map, so PvP needs either
Redis-backed rooms or `CROWN_API_INSTANCES=1`; and Cloudflare's Network → WebSockets toggle has
to be on.

**Phase 3 — scaffold only, do not build.** $CROWN claim hooks, seasonal leaderboard resets, clans.

---

## Ground rules for changes

* `packages/shared` is the only place a game rule may live. If the client and the server could
  ever disagree about something, it belongs there.
* Never hand-edit a verbatim slice. Change `tools/extract.mjs`, or change the prototype.
* No balance changes, no new cards, no renames. The prototype is the spec.
* Drop rates stay published (`GET /api/chest/rates`), as they were in the prototype.
* Nothing the client says about a match outcome, a currency balance or a chest roll is ever
  trusted.

Further reading: [`docs/EXTRACTION-PLAN.md`](docs/EXTRACTION-PLAN.md) for what moved where and the
ten prototype-vs-brief deviations, [`docs/HANDOFF.md`](docs/HANDOFF.md) for the original client
brief.
