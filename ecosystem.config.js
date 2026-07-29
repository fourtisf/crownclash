/**
 * PM2 process definitions — handoff §3.4: "PM2 two processes (`api`, worker for match re-sim)".
 *
 * Two apps, deliberately different execution models:
 *
 *   crown-api     cluster mode, N instances. Fastify is stateless per request — the session is
 *                 a signed cookie, rate-limit counters and the leaderboard cache live in Redis
 *                 — so requests are freely interchangeable between workers and `pm2 reload`
 *                 can replace them one at a time with no dropped connection.
 *   crown-worker  fork mode, exactly one instance. It is a background loop, not a listener;
 *                 a second copy would double the leaderboard snapshot writes for no throughput
 *                 gain. (`worker.ts` is safe to run several times over — Redis consumer groups
 *                 claim audit jobs and the reaping queries are idempotent — so scaling this to
 *                 2+ later is a one-line change, not a rewrite.)
 *
 * Known Phase-2 constraint: `apps/server/src/ws.ts` keeps matchmaking rooms in a per-process
 * Map. Websocket *connections* are fine under cluster mode (a socket lives on whichever worker
 * accepted it), but two players landing on different workers cannot be paired until Phase 2
 * moves room state into Redis, as that file's header says. Nothing in Phase 1 uses rooms, so
 * clustering the API today costs nothing.
 *
 * Configuration inputs, all optional, all read from the environment of whoever runs `pm2`:
 *   CROWN_ENV_FILE       path to the production env file    (default /etc/crown-clash/app.env)
 *   CROWN_LOG_DIR        directory for PM2's captured stdio (default /var/log/crown-clash)
 *   CROWN_API_INSTANCES  cluster size for crown-api         (default 2)
 *
 * There are no credentials in this file and there must never be. Secrets come from the env
 * file, which is root-owned and outside the repo (see ops/README.md).
 */
'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = __dirname;
const SERVER_DIR = join(ROOT, 'apps', 'server');

const ENV_FILE = process.env.CROWN_ENV_FILE || '/etc/crown-clash/app.env';
const LOG_DIR = process.env.CROWN_LOG_DIR || '/var/log/crown-clash';
const API_INSTANCES = Number(process.env.CROWN_API_INSTANCES || 2);

/**
 * Resolve a compiled server entrypoint.
 *
 * `apps/server/tsconfig.json` sets `rootDir: "."` (not `"src"`), so `tsc` mirrors the source
 * tree under `outDir` and the real entrypoints are `dist/src/index.js` / `dist/src/worker.js` —
 * *not* `dist/index.js`. Verified by building: `tsc -p apps/server/tsconfig.json` emits
 * `dist/src/index.js` and `dist/src/worker.js`. (`apps/server/package.json`'s `start` script
 * still says `node dist/index.js`; it is wrong today for the same reason.)
 *
 * Both layouts are probed rather than hardcoded so that tightening that tsconfig to
 * `rootDir: "src"` later does not turn the next deploy into a "script not found" outage.
 * `ops/deploy.sh` removes `dist/` before every build, so a stale path can never win the probe.
 */
function serverEntry(basename) {
  const candidates = [
    join(SERVER_DIR, 'dist', 'src', `${basename}.js`),
    join(SERVER_DIR, 'dist', `${basename}.js`),
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

/**
 * Minimal KEY=VALUE reader for the production env file.
 *
 * Parsed here, at config-load time, rather than relying on `pm2 --update-env` inheriting the
 * deploy shell's environment: PM2 persists its process list and replays it on boot via
 * `pm2 resurrect`, and an environment that only existed inside a deploy shell would be gone by
 * then. Reading the file makes a reboot and a deploy produce the same environment.
 *
 * Absent file ⇒ empty object, so this config also loads on a dev machine.
 */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const fileEnv = readEnvFile(ENV_FILE);

/**
 * Production environment.
 *
 * `HOST` is pinned to loopback: nginx is the only thing that should ever reach the API, and
 * binding 0.0.0.0 would publish port 8080 straight to the internet the moment a firewall rule
 * lapsed. `apps/server/src/lib/env.ts` defaults to 0.0.0.0, which is right for `pnpm dev` and
 * wrong here.
 *
 * `NODE_ENV` is forced last so the env file cannot accidentally downgrade production — that
 * would re-enable the dev secret fallbacks in `env.ts`, which exist precisely to be refused
 * in production.
 */
const productionEnv = {
  ...fileEnv,
  NODE_ENV: 'production',
  HOST: fileEnv.HOST || '127.0.0.1',
  PORT: fileEnv.PORT || '8080',
  LOG_LEVEL: fileEnv.LOG_LEVEL || 'info',
  TRUST_PROXY: fileEnv.TRUST_PROXY || 'true',
  RATE_LIMIT_ENABLED: fileEnv.RATE_LIMIT_ENABLED || 'true',
};

/** Shared knobs. Split out so the two apps cannot drift apart by accident. */
const common = {
  cwd: SERVER_DIR,
  // Source maps are emitted by `tsc` (`sourceMap: true` in tsconfig.base.json). The small
  // per-throw cost is worth having a stack trace that points at a .ts line when a match
  // validation blows up in production.
  node_args: '--enable-source-maps',
  autorestart: true,
  // A crash loop against a down Postgres should back off instead of hammering it.
  exp_backoff_restart_delay: 200,
  min_uptime: '20s',
  max_restarts: 10,
  // Both entrypoints trap SIGINT/SIGTERM and drain before exiting; PM2's default 1.6 s is not
  // enough for a match re-simulation to finish and the save to be written.
  kill_timeout: 10000,
  listen_timeout: 10000,
  // Deliberately false. Neither process calls `process.send('ready')`, so enabling this would
  // stall every reload for the full listen_timeout before PM2 gave up and continued anyway.
  wait_ready: false,
  // Pino writes structured JSON to stdout. PM2's timestamp prefix would put text in front of
  // each line and break every JSON log consumer downstream; pino already carries a `time`
  // field, so nothing is lost.
  time: false,
  merge_logs: true,
  env: {
    // Bare `pm2 start ecosystem.config.js` on a dev box. Production always passes
    // `--env production`.
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '8080',
  },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'crown-api',
      script: serverEntry('index'),
      exec_mode: 'cluster',
      instances: API_INSTANCES,
      // Comfortably above steady state (a 180 s re-sim allocates a few MB and frees it), low
      // enough that a leak restarts a worker long before the VPS starts swapping.
      max_memory_restart: '600M',
      out_file: join(LOG_DIR, 'api-out.log'),
      error_file: join(LOG_DIR, 'api-error.log'),
      env_production: productionEnv,
    },
    {
      ...common,
      name: 'crown-worker',
      script: serverEntry('worker'),
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '400M',
      out_file: join(LOG_DIR, 'worker-out.log'),
      error_file: join(LOG_DIR, 'worker-error.log'),
      env_production: productionEnv,
    },
  ],
};
