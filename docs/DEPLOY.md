# Crown Clash — deployment runbook

How to operate the production deployment. Building the box in the first place is
[`ops/README.md`](../ops/README.md).

> **Status: not yet deployed.** Every file referenced here is committed and reviewed, but no VPS
> has ever run them — there are no VPS credentials, no domain and no database in the environment
> this repo was built in. Treat the first deploy as a first deploy: work through the pre-flight
> list below rather than assuming any of it has been exercised.

---

## Pre-flight

Things that must be true before `ops/deploy.sh` can succeed. Check them; do not assume them.

| # | Check | How |
|---|---|---|
| 1 | `prisma/migrations/` exists and is committed | `ls prisma/migrations` — see [§ Migrations](#migrations). `prisma/schema.prisma` alone is not enough. |
| 2 | The compiled server boots under plain Node | `pnpm -r build`, then `cd apps/server && node -e "import('@crown/shared').then(()=>console.log('ok'))"`. Passes as of this commit — see below for why it is still on the list. |
| 3 | PM2's entrypoints resolve | `node -e "console.log(require('./ecosystem.config.js').apps.map(a=>a.script))"` after a build. Both paths must exist on disk. |
| 4 | `nginx -t` passes with the real hostname substituted | Two `server_name` lines in `ops/nginx/crown-clash.conf` (one per `server` block; each names the apex and `www`). `nginx -t` checks the config and the files it references — snippets, TLS cert — but **not** `root`, so it passes even with no static release published. |
| 5 | Secrets are real | `AUTH_SECRET` and `COOKIE_SECRET` are ≥16 chars and are not the `dev-only-…` placeholders — the API refuses to boot in production otherwise, by design. |
| 6 | CI is green on the commit being deployed | Especially `node tools/extract.mjs --check`. |

### Check 2: the compiled server boots

This one used to fail and now passes; it stays on the list because it is the single check that
nothing else in the repo can make for you.

`@crown/shared` exports an ESM conditional map (`development` → `./src/index.ts`, `default` →
`./dist/index.js`). Vite and Vitest resolve the source condition, so **dev, tests and typecheck
all stay green no matter what the `default` branch says** — only plain `node`, which is what PM2
runs, ever exercises it. That asymmetry is permanent, so any future change to that package's
`exports`, `files` or build output can break production while every gate in CI stays green.

Verified against this commit, after `pnpm -r build`:

```bash
cd apps/server
NODE_ENV=production AUTH_SECRET=<32+ chars> COOKIE_SECRET=<32+ chars> \
  HOST=127.0.0.1 PORT=18099 node --enable-source-maps dist/src/index.js
# another shell:
curl -s http://127.0.0.1:18099/api/health
# {"ok":true,"env":"production","redis":"memory","redisStatus":"memory-fallback","uptime":1}
```

`"redis":"memory"` there is expected in that throwaway run — no `REDIS_URL` was set. In
production it must read `"redis"`; see [Monitoring](#monitoring).

If this ever fails again with `ERR_MODULE_NOT_FOUND` for a `packages/shared/src/*.js` path, the
cause is the same as last time: the exports map pointing Node at TypeScript source, whose `.js`
specifiers only resolve against compiled output. Fix it in `packages/shared/package.json`. Do not
work around it in the ops layer — a bundler or a loader flag bolted onto the PM2 entry would hide
the same problem from the tests all over again.

### Check 3: PM2's entrypoints

`apps/server/tsconfig.json` sets `rootDir: "."`, so `tsc` mirrors the source tree under `outDir`
and the real entrypoints are `apps/server/dist/src/index.js` and `dist/src/worker.js` — **not**
`dist/index.js`. (`apps/server/tsconfig.build.json` narrows the inputs to `src/` for the
production build but keeps that layout deliberately.) `ecosystem.config.js` probes both layouts
rather than hardcoding one, so it survives that tsconfig being tightened later.
`apps/server/package.json`'s `start` and `worker` scripts point at the same `dist/src/…` paths;
PM2 does not use them, but if they ever disagree with the config, the layout has moved and this
check is the one that catches it.

CI runs this assertion after every build (`.github/workflows/ci.yml`, "PM2 entrypoints resolve"),
so a tsconfig change that relocates the output fails there rather than at 2am on the VPS.

---

## Environment variables

Everything lives in `/etc/crown-clash/app.env` (mode `0640`, `root:deploy`). It is read twice:
by `ops/deploy.sh` (so Prisma sees `DATABASE_URL`) and by `ecosystem.config.js` at config-load
time (so `pm2 resurrect` after a reboot reproduces the same environment a deploy would).

### Required in production

| Variable | Notes |
|---|---|
| `AUTH_SECRET` | ≥16 chars. `openssl rand -hex 32`. Rotating it logs everyone out **and invalidates every account-recovery code** — recovery codes are stored as an HMAC keyed on this value, so a rotation strands any player whose only way back was a code they wrote down. Treat it as permanent unless it leaks. |
| `COOKIE_SECRET` | ≥16 chars, different value. Rotating it logs everyone out. |
| `DATABASE_URL` | `postgresql://crown:…@localhost:5432/crown?schema=public` |
| `REDIS_URL` | `redis://127.0.0.1:6379`. Optional in code, mandatory here — the in-process fallback is per-process and this box runs three processes. |
| `CORS_ORIGIN` | Comma-separated exact origins, e.g. `https://crownclash.example.com`. `*` is illegal with cookie credentials. |
| `SIWE_DOMAIN` | Host only, no scheme: `crownclash.example.com`. Must equal the host serving the page or every wallet link is rejected. |
| `SIWE_URI` | `https://crownclash.example.com` |

### Optional, with their defaults

| Variable | Default | Notes |
|---|---|---|
| `PORT` / `HOST` | `8080` / `127.0.0.1` | Pinned by `ecosystem.config.js`. Loopback keeps the API unreachable except through nginx. |
| `LOG_LEVEL` | `info` | `debug` is very chatty under load. |
| `SESSION_TTL_DAYS` | `30` | |
| `COOKIE_NAME` | `cc_session` | |
| `COOKIE_DOMAIN` | unset | Set only if the API and client are on different subdomains. |
| `SIWE_CHAIN_ID` | `1` | |
| `WALLET_NONCE_TTL_SEC` | `300` | |
| `RATE_LIMIT_ENABLED` | `true` | Never turn this off in production; handoff §5's limits are the anti-cheat budget. |
| `TRUST_PROXY` | `true` | Correct behind nginx. Requires nginx to set `X-Forwarded-For` honestly, which `crown-clash.conf` does. |
| `WORKER_TICK_MS` | `15000` | Worker cycle: audit re-sims, leaderboard snapshot, reaping. |
| `MATCH_EXPIRY_MINUTES` | `15` | Unfinished matches are voided after this. |
| `LEADERBOARD_TTL_SEC` | `30` | |
| `BODY_LIMIT_BYTES` | `262144` | nginx allows 512 KB so oversized bodies get the API's JSON error, not nginx HTML. |
| `STATIC_DIR` | unset | **Leave unset.** It makes the API serve the client as well; nginx does that here, and two servers for the same files means two caching policies. |

Deliberately **not** in the env file: `NODE_ENV` (forced to `production` by
`ecosystem.config.js`, because a stray `development` would re-enable the dev secret fallbacks in
`apps/server/src/lib/env.ts`).

### Deploy-script knobs

`APP_DIR` `BRANCH` `REMOTE` `ENV_FILE` `WEB_ROOT` `RELEASES_DIR` `CURRENT_LINK` `KEEP_RELEASES`
`SCHEMA` `CROWN_LOG_DIR` `LOCK_FILE` `HEALTH_URL` `HEALTH_RETRIES` `HEALTH_DELAY` `PM2`
`CROWN_API_INSTANCES` `CROWN_ENV_FILE` — defaults in `ops/deploy.sh --help`.

---

## DNS and Cloudflare

| Setting | Value | Why |
|---|---|---|
| `A crownclash.example.com` | VPS IPv4, **Proxied** (orange cloud) | The origin IP must not be public; the firewall only admits Cloudflare ranges. |
| `A www` | same, Proxied | `server_name` covers both. |
| `AAAA` | only if the VPS has IPv6 | And uncomment the `listen [::]:…` lines in `crown-clash.conf`, or nginx will not bind. |
| SSL/TLS → Overview | **Full (strict)** | Rationale in the header of `ops/nginx/crown-clash.conf`. Flexible sends the origin hop in cleartext; Full-non-strict authenticates nothing. |
| SSL/TLS → Origin Server | Origin certificate created, 15 y | Installed at `/etc/ssl/crown-clash/origin.{pem,key}`. |
| SSL/TLS → Edge Certificates → Always Use HTTPS | On | |
| SSL/TLS → Edge Certificates → Minimum TLS | 1.2 | |
| SSL/TLS → Origin Server → Authenticated Origin Pulls | On (recommended) | Enable in the dashboard *before* uncommenting `ssl_verify_client`. |
| Speed → Brotli | On | The edge compresses; origin brotli is optional (see the commented block in the nginx conf). |
| Caching → Cache Level | Standard | Hashed `/assets/` are cached by fingerprint; `/api/` sends `Cache-Control: no-store`. |
| Network → WebSockets | On | Required before Phase 2's `/ws` can work. |
| Security → Bot Fight Mode | **Off** for `/api/*` | It challenges XHR and will break the game client. Use a WAF rate-limit rule instead if you need one. |

Do **not** add a Cloudflare Page Rule that caches `/` or `/index.html`. The build fingerprints
every asset but `index.html` is the unhashed document that points at them; caching it at the edge
means a deploy keeps serving references to files that no longer exist.

---

## First deploy

```bash
ssh deploy@vps
cd /srv/crown-clash
git checkout main
ops/deploy.sh
sudo nginx -t && sudo systemctl reload nginx
curl -s https://crownclash.example.com/api/health
```

Expected health payload:

```json
{"ok":true,"env":"production","redis":"redis","uptime":4}
```

`"redis":"memory"` means `REDIS_URL` is unset and every process has its own private rate-limit
counters and leaderboard cache. Fix it before taking traffic.

Then walk the acceptance path from handoff §9 by hand on a phone: land → play three AI matches →
earn a chest → open it → check `/api/leaderboard` → link a wallet → confirm the one-time +100
gems → clear cookies → sign back in with the wallet and confirm the save is intact.

---

## Subsequent deploys

```bash
ssh deploy@vps
cd /srv/crown-clash
ops/deploy.sh
```

It is idempotent — running it twice on an unchanged remote leaves the same system running. The
sequence is fetch → hard reset to `origin/main` → `pnpm install --frozen-lockfile` → clean build
→ `prisma generate` → `prisma migrate deploy` → publish `apps/web/dist` to a timestamped release
directory and swap the `current` symlink with a single `rename(2)` → `pm2 startOrReload --env
production` → poll `/api/health` until it reports `ok` **and** `env: production`.

Static and API cut over at slightly different moments (symlink swap, then a rolling PM2 reload of
a few seconds). That window is safe as long as the API change is backwards-compatible with the
previous bundle for those seconds — the same constraint as the migration rule below.

Budget several minutes, most of it `pnpm install` and the build — the workspace builds in about
20 s on a developer machine, and a 2 vCPU VPS is slower, but this has never been timed on real
hardware, so treat any number here as a guess until you have measured your own. nginx is not
reloaded: it only needs a reload when `ops/nginx/*` changes.

**When the nginx config changes**, the symlinks from `ops/README.md` §8 mean `git pull` already
updated the live file — you still have to `sudo nginx -t && sudo systemctl reload nginx`.

---

## Migrations

`prisma/schema.prisma` is committed; **`prisma/migrations/` is not yet**. Create the initial
migration on a developer machine against a scratch database, review the generated SQL, and commit
it:

```bash
DATABASE_URL='postgresql://crown:crown@localhost:5432/crown_dev?schema=public' \
  pnpm --filter @crown/server exec prisma migrate dev \
    --schema "$PWD/prisma/schema.prisma" --name init --skip-generate
git add prisma/migrations && git commit
```

### Why `--skip-generate`, and why the root `db:generate` script fails

`prisma generate` resolves `@prisma/client` by walking up from **the directory that contains the
schema** — not from the working directory, and not from whichever workspace package invoked it.
The schema lives at the repo root, and under pnpm's strict layout `@prisma/client` is a
dependency of `apps/server` only, so from the root it is unresolvable. The CLI then either aborts
with `Could not resolve @prisma/client` or tries to `pnpm add` it mid-command, which would mutate
a tracked `package.json`. `--filter @crown/server` does not help; the filter changes the working
directory, and the working directory is not what Prisma looks at. Both were verified against this
commit.

Consequences, all of them load-bearing:

* `prisma migrate dev` runs a generate step at the end, so it needs `--skip-generate` here or it
  fails *after* writing the migration and leaves you unsure whether it worked.
* The root `pnpm db:generate` script fails, for the same reason.
  `apps/server/src/lib/prisma.ts` documents the same constraint from the other side — it is why
  the delegate surface in that file is typed by hand.
* `ops/deploy.sh` generates against an untracked symlink it creates at
  `apps/server/.prisma-schema.prisma`, so the lookup starts inside `apps/server`. It runs
  `migrate deploy` against the **real** root path, because `migrate deploy` looks for
  `migrations/` next to the schema it is given and does not need `@prisma/client` at all.

**The permanent fix is one line** — add `"@prisma/client": "^5.22.0"` to the root
`package.json`'s dependencies. After that the symlink, the `--filter`, and `--skip-generate` can
all go, and `prisma.ts` can `import { PrismaClient } from '@prisma/client'` like a normal file.

`ops/deploy.sh` runs `prisma migrate deploy`, which only ever *applies* committed migrations. It
never generates, never resets, never prompts. If `prisma/migrations/` is missing the script stops
before touching anything and tells you why.

### The compatibility rule

Migrations run **before** the new code goes live, so for the few seconds of a rolling reload the
*old* code is talking to the *new* schema. That makes additive changes free and destructive
changes a two-deploy job:

1. **Expand.** Add the new column/table. Ship code that writes both old and new.
2. **Migrate data**, verify.
3. **Contract.** Ship code that reads only the new shape. *Then* drop the old column in a
   following migration.

Renaming a column the running code still selects will produce 500s for the length of the reload.

### Checking state

```bash
cd /srv/crown-clash
set -a && . /etc/crown-clash/app.env && set +a
pnpm --filter @crown/server exec prisma migrate status --schema "$PWD/prisma/schema.prisma"
```

`migrate status`, like `migrate deploy`, takes the **root** schema path: it reads
`prisma/migrations/` next to the schema and never touches `@prisma/client`.

---

## Rollback

### Code

`ops/deploy.sh` rolls back automatically: any failure after checkout restores the previous commit
and the previous static release, rebuilds, reloads, and re-runs the health check. If that second
check also fails it exits loudly rather than pretending. Verified against stubbed
`git`/`pnpm`/`pm2`/`curl` for a failing build, a failing health check, a missing
`prisma/migrations/`, a repeat deploy, release pruning and the concurrency lock. The real `pm2`
and `nginx` halves have never run.

That automatic rollback depends on the `-E` in `set -Eeuo pipefail`, and non-obviously so: bash
does not inherit an `ERR` trap into shell functions without it, and every command that can fail
here fails inside `build_and_reload`. Without `-E` the script exits 1 and the rollback never runs
— while still *looking* correct, because the two explicit `return 1` guards in that function do
trigger the trap. Do not "tidy" that flag away.

Manual rollback to a known-good commit:

```bash
cd /srv/crown-clash
ops/deploy.sh --ref <sha-or-tag>
```

Static-only rollback (the API is fine, the bundle is not) is a symlink swap — the last five
releases are kept:

```bash
ls -1t /var/www/crown-clash/releases | head
ln -sfn /var/www/crown-clash/releases/<older> /var/www/crown-clash/current.tmp
mv -Tf /var/www/crown-clash/current.tmp /var/www/crown-clash/current
```

No nginx reload needed: `open_file_cache` is deliberately off, so the swap takes effect on the
next request.

### Database

**Not automatic, on purpose.** `prisma migrate deploy` is forward-only, and a script that
reverses migrations unattended is a data-loss button wearing a safety-net costume. If a migration
is the problem:

1. Roll the *code* back first (above) — the schema being ahead of the code is usually harmless
   for an additive migration.
2. Write a **new forward migration** that undoes what the bad one did, review its SQL, and deploy
   that. Do not hand-edit `_prisma_migrations`.
3. If the data is actually damaged, restore from backup. Which means you need backups:

```bash
# nightly, e.g. from cron as the postgres user
pg_dump --format=custom crown > /var/backups/crown-$(date +%F).dump
```

Set that up before launch, not after.

---

## Monitoring

```bash
pm2 status                       # both apps online, restart counts flat
pm2 logs crown-api --lines 200
pm2 monit
curl -s localhost:8080/api/health
```

What to watch, in order of how much it matters:

| Signal | Where | Meaning |
|---|---|---|
| `AUDIT MISMATCH` | worker log, level `error` | **The most important line in the system.** `crown-worker` replays every finished match a second time and compares `Sim.hash()` with what the API recorded. They always agree — that is the point. A mismatch means the simulation has stopped being deterministic (a stray `Math.random()`, a Map iteration order, a V8 float change), so match validation has silently stopped working and honest players will start having matches voided at random. Stop and investigate; do not restart your way out of it. |
| PM2 `restart` count climbing | `pm2 status` | Crash loop. `pm2 logs crown-api --err`. |
| `"redis":"memory"` | `/api/health` | `REDIS_URL` unset or Redis down. Rate limits and the leaderboard cache have gone per-process. |
| 502 / 504 in nginx error log | `/var/log/nginx/crown-clash.error.log` | API not listening, or a request exceeded `proxy_read_timeout 30s`. |
| `rate_limited` responses | API log | Either a real attack or a limit set too tight for honest play. |
| Voided matches | `Match.validated = false` in Postgres | A trickle is normal (dropped connections). A spike after a deploy usually means client and server disagree about the sim. |
| Disk | `df -h` | Sourcemaps, PM2 logs and release directories all accumulate. `pm2-logrotate` and `KEEP_RELEASES` bound the first two. |

Useful queries:

```sql
-- voided matches in the last hour
select "voidReason", count(*) from "Match"
where "createdAt" > now() - interval '1 hour' and validated = false
group by 1 order by 2 desc;

-- accounts created today
select count(*) from "User" where "createdAt" > current_date;
```

---

## When something is wrong

### The site is down (nginx 502)

```bash
pm2 status                       # is crown-api online?
pm2 logs crown-api --err --lines 100
curl -sv localhost:8080/api/health
```

Most common causes, in the order they actually happen:

1. **The API crash-loops on boot.** Read the first error, not the last. `AUTH_SECRET is still the
   dev default` and `Invalid environment:` mean the env file is wrong or was not read. A
   `ERR_MODULE_NOT_FOUND` for `@crown/shared` is pre-flight check 2.
2. **Postgres is down or the URL is wrong.** `systemctl status postgresql`, then
   `psql "$DATABASE_URL" -c 'select 1'`.
3. **PM2 is pointing at a script that does not exist.** `pm2 describe crown-api` shows the
   resolved path; compare with `ls apps/server/dist/src/`.

### The site loads but shows the old version

`index.html` got cached. It is served `no-cache, no-store, must-revalidate` by nginx, so check
for a Cloudflare page rule caching `/`, then purge the edge cache
(**Caching → Configuration → Purge Everything**).

### Assets 404 after a deploy

The `current` symlink and the running `index.html` disagree — usually a failed rsync mid-deploy.
`ls -l /var/www/crown-clash/current`, then re-run `ops/deploy.sh`.

### Every request looks like it comes from one IP

`set_real_ip_from` is stale or the snippet is not being included. Check
`/var/log/nginx/crown-clash.access.log` for Cloudflare-range addresses, then run
`ops/nginx/refresh-cloudflare-ips.sh` and reload. Until this is right, every per-IP rate limit
counts a whole Cloudflare PoP as a single user.

### Wallet linking always fails

`SIWE_DOMAIN` must be the bare host that served the page (`crownclash.example.com`, no scheme, no
trailing slash) and `SIWE_URI` its https origin. A mismatch makes every signature verification
fail with no other symptom.

### Login works, then the next request is anonymous

The session cookie is not coming back. Check `CORS_ORIGIN` lists the exact origin (scheme + host,
no trailing slash) and that the client is same-origin with the API — behind this nginx it is, so
if it is not, something is bypassing the proxy.

### Deploy says "another deploy is already running"

A previous run was killed before releasing `/tmp/crown-clash-deploy.lock`. Confirm with
`pgrep -af deploy.sh`, then remove the lock file if nothing is running.

---

## Phase 2 (PvP) — not enabled

`apps/server/src/ws.ts` accepts authenticated `/ws` upgrades and runs Redis-backed matchmaking,
but the authoritative 30 Hz room loop is not implemented: a `deploy` message over the socket is
answered with `pvp_not_enabled`, and the matchmaker falls back to the Phase-1 vs-AI path after
10 seconds. nginx already proxies `/ws` with the upgrade headers and a long read timeout, so
shipping Phase 2 needs no infrastructure change **except** one: rooms live in a per-process `Map`,
so two players on different PM2 cluster workers cannot be paired. Before enabling PvP, either
move room state into Redis or set `CROWN_API_INSTANCES=1`.
