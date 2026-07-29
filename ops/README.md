# Crown Clash — first-time VPS setup

Building the box from a bare Ubuntu image to something `ops/deploy.sh` can deploy onto. Do this
once. Everything after it lives in [`docs/DEPLOY.md`](../docs/DEPLOY.md).

Target: **Hostinger VPS, Ubuntu 22.04 or 24.04 LTS, 2 vCPU / 4 GB minimum.** The API is a Node
process doing 180-second battle re-simulations on demand; 2 GB works but leaves no headroom for
Postgres plus the two PM2 apps plus a build.

> **Nothing in this repo has been run against a real VPS.** These are the instructions and the
> configuration files; the box does not exist yet. Read a command before you paste it.

---

## 0. What ends up running

```
              Cloudflare (proxied, Full-strict TLS)
                            │  443
                            ▼
   ┌──────────────────────────────────────────────────────┐
   │  nginx        /            → /var/www/crown-clash/current   (apps/web/dist)
   │               /api/, /ws   → 127.0.0.1:8080
   ├──────────────────────────────────────────────────────┤
   │  PM2   crown-api     cluster ×2   apps/server dist/src/index.js
   │        crown-worker  fork    ×1   apps/server dist/src/worker.js
   ├──────────────────────────────────────────────────────┤
   │  postgres 127.0.0.1:5432     redis 127.0.0.1:6379
   └──────────────────────────────────────────────────────┘
```

Paths, fixed by `ops/nginx/crown-clash.conf` and `ops/deploy.sh` defaults:

| What | Where |
|---|---|
| git checkout the services run from | `/srv/crown-clash` |
| static releases + `current` symlink | `/var/www/crown-clash` |
| secrets | `/etc/crown-clash/app.env` |
| PM2 stdout/stderr | `/var/log/crown-clash` |
| nginx access/error logs | `/var/log/nginx/crown-clash.*.log` |
| TLS material | `/etc/ssl/crown-clash` |

---

## 1. A user to run it as

Do not run the app as root.

```bash
adduser --disabled-password --gecos '' deploy
usermod -aG sudo deploy          # only if this user will also administer the box
```

The rest of this document assumes you are `deploy` and use `sudo` where shown.

---

## 2. Node 22 + pnpm via corepack

Ubuntu's packaged Node is too old. Use NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v                          # v22.x
```

pnpm is **not** installed globally by hand. `package.json` pins
`"packageManager": "pnpm@10.33.0"`, and corepack downloads and locks to exactly that version the
first time `pnpm` is run *inside the repo* — so the VPS, CI and every laptop resolve dependencies
identically:

```bash
sudo corepack enable
# after the clone in §5:
cd /srv/crown-clash && pnpm -v   # 10.33.0, downloaded on demand
```

If corepack pauses to ask whether it may download pnpm, export
`COREPACK_ENABLE_DOWNLOAD_PROMPT=0` (the CI workflow does the same).

---

## 3. Postgres

```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo -u postgres psql <<'SQL'
CREATE ROLE crown WITH LOGIN PASSWORD 'PUT-A-REAL-PASSWORD-HERE';
CREATE DATABASE crown OWNER crown;
SQL
```

Generate that password, do not invent one by hand:

```bash
openssl rand -base64 24
```

Leave Postgres on its default `listen_addresses = 'localhost'`. Nothing outside this box
connects to it; the API reaches it over loopback and `DATABASE_URL` reflects that.

Sanity check as the app user:

```bash
psql 'postgresql://crown:...@localhost:5432/crown' -c 'select 1'
```

---

## 4. Redis

```bash
sudo apt-get install -y redis-server
```

Edit `/etc/redis/redis.conf`:

```
bind 127.0.0.1 ::1
maxmemory 256mb
maxmemory-policy allkeys-lru
appendonly no
```

`allkeys-lru` is the right policy here because **nothing in Redis is authoritative**: it holds
the leaderboard cache, rate-limit counters, wallet nonces, the worker's audit-job stream and the
Phase-2 matchmaking set. Losing any of it costs a recomputation or a re-login, never a player's
save. `appendonly no` follows from the same fact — persistence would buy nothing.

```bash
sudo systemctl restart redis-server
redis-cli ping                   # PONG
```

The server also runs without Redis (`apps/server/src/lib/redis.ts` falls back to an in-process
implementation), but that fallback is **per-process** and this deployment runs two API instances
plus a worker. Set `REDIS_URL` in production; `/api/health` reports `"redis":"memory"` if you
forgot.

---

## 5. Directories and permissions

```bash
sudo mkdir -p /srv/crown-clash /var/www/crown-clash/releases /var/log/crown-clash /etc/crown-clash /etc/ssl/crown-clash
sudo chown -R deploy:deploy /srv/crown-clash /var/www/crown-clash /var/log/crown-clash
sudo chmod 750 /etc/crown-clash /etc/ssl/crown-clash

sudo -u deploy git clone https://github.com/<org>/crown-clash.git /srv/crown-clash
```

---

## 6. The environment file

`/etc/crown-clash/app.env` is the only place secrets live. It is read by `ops/deploy.sh` (for
Prisma) and by `ecosystem.config.js` (which parses it at config-load time so a reboot and
`pm2 resurrect` produce the same environment as a deploy).

```bash
sudo install -o root -g deploy -m 0640 /dev/null /etc/crown-clash/app.env
sudo -e /etc/crown-clash/app.env
```

Template — **generate every secret, never copy one from a document**:

```ini
# generated with: openssl rand -hex 32
AUTH_SECRET=
COOKIE_SECRET=

DATABASE_URL=postgresql://crown:PASSWORD@localhost:5432/crown?schema=public
REDIS_URL=redis://127.0.0.1:6379

# Public origin. Client and API are same-origin behind nginx, so this is one entry.
CORS_ORIGIN=https://crownclash.example.com

# SIWE binds a signature to a domain; it must equal the host the page is served from,
# or every wallet link will be rejected.
SIWE_DOMAIN=crownclash.example.com
SIWE_URI=https://crownclash.example.com
SIWE_CHAIN_ID=1

LOG_LEVEL=info
```

Deliberately **not** in this file:

* `NODE_ENV` — `ecosystem.config.js` forces `production` and ignores the file's value, because a
  stray `NODE_ENV=development` would re-enable the dev secret fallbacks in `lib/env.ts` that
  exist precisely to be refused in production.
* `HOST` / `PORT` — pinned to `127.0.0.1:8080` by `ecosystem.config.js` so the API is reachable
  only through nginx.
* `STATIC_DIR` — leave unset. It makes the API serve the client too; here nginx does that, and
  setting both means two different caching policies for the same files.

`ops/deploy.sh` refuses to run if `DATABASE_URL` is empty, and the API refuses to boot in
production if `AUTH_SECRET` or `COOKIE_SECRET` is still a dev placeholder.

---

## 7. TLS: Cloudflare Origin CA

The reasoning for this choice is at the top of `ops/nginx/crown-clash.conf`; the short version is
that Cloudflare's SSL/TLS mode must be **Full (strict)** and this box holds a Cloudflare Origin
CA certificate.

1. Cloudflare dashboard → **SSL/TLS → Origin Server → Create Certificate**.
2. Hostnames: `crownclash.example.com, *.crownclash.example.com`. Validity: 15 years.
3. Save the two blobs on the VPS:

```bash
sudo -e /etc/ssl/crown-clash/origin.pem      # the certificate
sudo -e /etc/ssl/crown-clash/origin.key      # the private key
sudo chmod 640 /etc/ssl/crown-clash/origin.pem
sudo chmod 600 /etc/ssl/crown-clash/origin.key
sudo chown root:root /etc/ssl/crown-clash/origin.*
```

4. Cloudflare dashboard → **SSL/TLS → Overview → Full (strict)**.

### Authenticated Origin Pulls (recommended, optional)

Makes nginx reject any TLS client that is not Cloudflare, so a leaked origin IP cannot be used
to bypass the edge:

```bash
sudo curl -fsSL -o /etc/ssl/crown-clash/cloudflare-origin-pull-ca.pem \
  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem
```

Then uncomment `ssl_client_certificate` / `ssl_verify_client` in `crown-clash.conf` and turn on
**SSL/TLS → Origin Server → Authenticated Origin Pulls** in the dashboard. Do the dashboard side
first, or you will lock the edge out of your own origin.

---

## 8. nginx

```bash
sudo apt-get install -y nginx
# Optional, for the commented brotli block in crown-clash.conf:
# sudo apt-get install -y libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static

sudo mkdir -p /etc/nginx/snippets

# Symlinks, not copies: `git pull` then updates the live config, and
# ops/nginx/refresh-cloudflare-ips.sh rewrites a file nginx is actually reading.
sudo ln -sf /srv/crown-clash/ops/nginx/cloudflare-realip.conf     /etc/nginx/snippets/crown-cloudflare-realip.conf
sudo ln -sf /srv/crown-clash/ops/nginx/crown-security-headers.conf /etc/nginx/snippets/crown-security-headers.conf
sudo ln -sf /srv/crown-clash/ops/nginx/crown-clash.conf            /etc/nginx/sites-available/crown-clash.conf
sudo ln -sf /etc/nginx/sites-available/crown-clash.conf            /etc/nginx/sites-enabled/crown-clash.conf
sudo rm -f /etc/nginx/sites-enabled/default
```

Replace `crownclash.example.com` in `ops/nginx/crown-clash.conf` with the real hostname (three
`server_name` lines) and commit that change — the file is version-controlled.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` fails until `/var/www/crown-clash/current` exists, so run the first deploy (§11)
before expecting a clean reload.

Refresh Cloudflare's IP ranges when they change (quarterly is plenty):

```bash
sudo /srv/crown-clash/ops/nginx/refresh-cloudflare-ips.sh
sudo nginx -t && sudo systemctl reload nginx
```

---

## 9. PM2

Install for the `deploy` user, not root:

```bash
sudo npm install -g pm2
pm2 -v
```

Boot persistence:

```bash
pm2 startup systemd -u deploy --hp /home/deploy    # prints a sudo command — run it
```

`ops/deploy.sh` runs `pm2 save` after every successful reload, so the resurrected process list is
always the one that last passed a health check.

Log rotation — PM2's own logs grow without bound otherwise:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

Cluster size defaults to 2. On a bigger box, add it to the env file and re-deploy:

```bash
echo 'CROWN_API_INSTANCES=4' | sudo tee -a /etc/crown-clash/app.env
ops/deploy.sh
```

`ecosystem.config.js` reads it from the process environment, and `ops/deploy.sh` sources the env
file with `set -a` before invoking pm2 — so the value reaches the config, `pm2 save` records the
resulting process list, and a reboot brings back the same four workers.

---

## 10. Firewall

Only Cloudflare should be able to reach 80/443. SSH stays open (or restrict it to your own
address — just do not lock yourself out).

```bash
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp

for cidr in $(curl -fsSL https://www.cloudflare.com/ips-v4) $(curl -fsSL https://www.cloudflare.com/ips-v6); do
  sudo ufw allow from "$cidr" to any port 80  proto tcp
  sudo ufw allow from "$cidr" to any port 443 proto tcp
done

sudo ufw enable
sudo ufw status numbered
```

Postgres (5432), Redis (6379) and the API (8080) are never opened: all three bind loopback.

Re-run the loop after `refresh-cloudflare-ips.sh` reports new ranges, and delete the stale rules
(`sudo ufw status numbered` → `sudo ufw delete N`).

---

## 11. First deploy

```bash
cd /srv/crown-clash
git checkout main
ops/deploy.sh
```

What it does, in order: fetch → reset to `origin/main` → `pnpm install --frozen-lockfile` →
clean build → `prisma generate` → `prisma migrate deploy` → publish `apps/web/dist` into a new
release directory and swap `current` → `pm2 startOrReload --env production` → poll
`/api/health` → on any failure, restore the previous commit and release and re-check.

It will refuse to start if `prisma/migrations/` is not committed. See
[`docs/DEPLOY.md`](../docs/DEPLOY.md) § Migrations.

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s https://crownclash.example.com/api/health
```

---

## 12. Where the logs are

| Stream | Path | Format |
|---|---|---|
| API stdout | `/var/log/crown-clash/api-out.log` | pino JSON, one object per line |
| API stderr | `/var/log/crown-clash/api-error.log` | pino JSON |
| Worker stdout | `/var/log/crown-clash/worker-out.log` | pino JSON |
| Worker stderr | `/var/log/crown-clash/worker-error.log` | pino JSON |
| nginx access | `/var/log/nginx/crown-clash.access.log` | combined |
| nginx error | `/var/log/nginx/crown-clash.error.log` | nginx |
| Postgres | `/var/log/postgresql/` | |

PM2 is configured with `time: false` on purpose: pino already writes a `time` field, and PM2's
timestamp prefix would put plain text in front of each line and break every JSON consumer.

Read them:

```bash
pm2 logs crown-api --lines 200
pm2 logs crown-worker --lines 200
tail -f /var/log/crown-clash/api-out.log | npx pino-pretty
```

The line worth alerting on is the worker's `AUDIT MISMATCH` — it means the simulation has stopped
being deterministic and match validation can no longer be trusted. See
[`docs/DEPLOY.md`](../docs/DEPLOY.md) § Monitoring.
