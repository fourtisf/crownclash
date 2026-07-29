#!/usr/bin/env bash
# ============================================================================================
#  Crown Clash — deploy to the Hostinger VPS.
#
#  Idempotent: running it twice against an unchanged remote produces the same running system.
#  Every step is either a no-op or a full replacement; nothing accumulates except the pruned
#  ring of static releases.
#
#  Order is deliberate — install → build → migrate → publish static → reload API → health.
#  Migrations run *before* the new code is live so the new code never queries a table that does
#  not exist yet. The cost of that ordering is that every migration must be compatible with the
#  currently-running release for the seconds the reload takes: additive migrations are safe, a
#  destructive one needs the two-step expand/contract described in docs/DEPLOY.md.
#
#  On any failure after checkout, the previous commit and the previous static release are
#  restored and the health check repeated. THE DATABASE IS NOT ROLLED BACK — `prisma migrate
#  deploy` is forward-only by design, and undoing it automatically is a data-loss button
#  wearing a safety-net costume.
#
#  No credentials live in this file. Everything secret is read from $ENV_FILE, which is created
#  once, by hand, outside the repo (ops/README.md).
# ============================================================================================
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ops/deploy.sh [options]

  (no options)          deploy $REMOTE/$BRANCH  (defaults: origin/main)
  --ref <sha|tag>       deploy a specific ref — the manual rollback path
  --no-migrate          skip `prisma migrate deploy`
  -h, --help            this text

Environment (all optional, shown with their defaults):
  APP_DIR=/srv/crown-clash          git checkout the services run from
  BRANCH=main  REMOTE=origin
  ENV_FILE=/etc/crown-clash/app.env secrets; sourced, never printed
  WEB_ROOT=/var/www/crown-clash     static releases + the `current` symlink nginx serves
  KEEP_RELEASES=5
  CROWN_LOG_DIR=/var/log/crown-clash
  HEALTH_URL=http://127.0.0.1:8080/api/health
  HEALTH_RETRIES=30  HEALTH_DELAY=2
  PM2=pm2
EOF
}

# ------------------------------------------------------------------------------ configuration
APP_DIR="${APP_DIR:-/srv/crown-clash}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
ENV_FILE="${ENV_FILE:-/etc/crown-clash/app.env}"

WEB_ROOT="${WEB_ROOT:-/var/www/crown-clash}"
RELEASES_DIR="${RELEASES_DIR:-$WEB_ROOT/releases}"
CURRENT_LINK="${CURRENT_LINK:-$WEB_ROOT/current}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

LOG_DIR="${CROWN_LOG_DIR:-/var/log/crown-clash}"
LOCK_FILE="${LOCK_FILE:-/tmp/crown-clash-deploy.lock}"

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/api/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY="${HEALTH_DELAY:-2}"

PM2="${PM2:-pm2}"
TARGET_REF=""
RUN_MIGRATE=1

# ---------------------------------------------------------------------------------- arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --ref)        TARGET_REF="${2:-}"; shift 2 ;;
    --ref=*)      TARGET_REF="${1#*=}"; shift ;;
    --no-migrate) RUN_MIGRATE=0; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            echo "deploy: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------------------------------ helpers
ts()   { date -u +%Y-%m-%dT%H:%M:%SZ; }
log()  { printf '\033[36m[deploy %s]\033[0m %s\n' "$(ts)" "$*"; }
warn() { printf '\033[33m[deploy %s] WARN\033[0m %s\n' "$(ts)" "$*" >&2; }
die()  { printf '\033[31m[deploy %s] FATAL\033[0m %s\n' "$(ts)" "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is not on PATH — see ops/README.md"
}

# ------------------------------------------------------------------------------ preconditions
for bin in git node pnpm curl rsync flock "$PM2"; do need "$bin"; done
[ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a git checkout"

# One deploy at a time. Two concurrent runs would race on the same working tree and the loser
# would build a half-checked-out source. Advisory locking is enough because this file is the
# only entry point.
exec 9>"$LOCK_FILE"
flock -n 9 || die "another deploy is already running (lock: $LOCK_FILE)"

cd "$APP_DIR"

# ------------------------------------------------------------------------------- environment
# `set -a` exports everything the file defines, so `prisma migrate deploy` (which reads
# DATABASE_URL from the process environment) and the build both see it.
if [ -f "$ENV_FILE" ]; then
  log "loading environment from $ENV_FILE"
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
else
  warn "$ENV_FILE not found — relying on the ambient environment"
fi
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set; refusing to deploy without a database"

mkdir -p "$LOG_DIR" "$RELEASES_DIR"

# ----------------------------------------------------------------------------- rollback state
PREV_SHA="$(git rev-parse HEAD)"
PREV_RELEASE=""
if [ -L "$CURRENT_LINK" ]; then PREV_RELEASE="$(readlink -f "$CURRENT_LINK")"; fi
ROLLING_BACK=0

# Atomic symlink swap: `mv -T` is a single rename(2), so nginx never observes a missing or
# half-written `current`. `ln -sfn` straight onto the live link is not atomic, and without -n
# it would create the link *inside* the directory it currently points at.
point_current_at() {
  ln -sfn "$1" "$CURRENT_LINK.tmp"
  mv -Tf "$CURRENT_LINK.tmp" "$CURRENT_LINK"
}

health() {
  # Asserts more than "something answered". `"env":"production"` proves the reloaded process
  # picked up the production environment — a server that came up with the dev defaults from
  # lib/env.ts would still return 200 here and be badly wrong.
  local i body
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)"; then
      case "$body" in
        *'"ok":true'*)
          case "$body" in
            *'"env":"production"'*) log "health OK: $body"; return 0 ;;
            *) warn "health responded but NODE_ENV is not production: $body"; return 1 ;;
          esac
          ;;
      esac
    fi
    [ "$i" -eq 1 ] && log "waiting for $HEALTH_URL ..."
    sleep "$HEALTH_DELAY"
  done
  warn "health check failed after $((HEALTH_RETRIES * HEALTH_DELAY))s"
  return 1
}

build_and_reload() {
  if [ "$RUN_MIGRATE" -eq 1 ] && [ ! -d prisma/migrations ]; then
    warn "prisma/migrations does not exist in this checkout."
    warn "Create the initial migration locally and commit it (docs/DEPLOY.md § Migrations),"
    warn "or re-run with --no-migrate if the schema is managed some other way."
    return 1
  fi

  # NODE_ENV=development for the install only. pnpm honours NODE_ENV=production by treating the
  # install as `--prod`, which drops typescript/vite/prisma and makes the next line fail with a
  # baffling "tsc: not found". The runtime NODE_ENV is set by PM2, not here.
  log "installing dependencies (frozen lockfile)"
  NODE_ENV=development pnpm install --frozen-lockfile

  # Clean build. Stale output is not merely wasteful: ecosystem.config.js resolves the PM2
  # entrypoint by probing dist/src/index.js then dist/index.js, and leftovers from a build made
  # under a different tsconfig rootDir could win that probe and boot the wrong file.
  log "clearing previous build output"
  rm -rf apps/server/dist packages/shared/dist apps/web/dist

  log "building workspace"
  pnpm -r build

  log "generating prisma client"
  pnpm run db:generate

  if [ "$RUN_MIGRATE" -eq 1 ]; then
    log "applying database migrations"
    pnpm run db:migrate
  else
    warn "skipping migrations (--no-migrate)"
  fi

  if [ ! -f apps/web/dist/index.html ]; then
    warn "apps/web/dist/index.html is missing — the web build produced nothing"
    return 1
  fi

  local release="$RELEASES_DIR/$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
  log "publishing static bundle to $release"
  mkdir -p "$release"
  rsync -a --delete apps/web/dist/ "$release/"
  point_current_at "$release"

  # startOrReload starts whatever is not running and gracefully reloads whatever is. In cluster
  # mode that replaces crown-api's workers one at a time, so no connection is dropped;
  # crown-worker is fork mode, where "reload" is a restart bounded by kill_timeout.
  log "reloading PM2 (crown-api, crown-worker)"
  "$PM2" startOrReload ecosystem.config.js --env production --update-env
  # Persist the process list so `pm2 resurrect` brings the same two apps back after a reboot.
  "$PM2" save --force >/dev/null
}

rollback() {
  [ "$ROLLING_BACK" -eq 1 ] && return 0
  ROLLING_BACK=1
  warn "deploy failed — rolling back to $PREV_SHA"

  # Every step here is guarded: the ERR trap is not inherited by functions, so an unguarded
  # failure inside the rollback would exit the shell silently and leave the operator with no
  # idea how far it got.
  if [ -n "$PREV_RELEASE" ] && [ -d "$PREV_RELEASE" ]; then
    log "restoring static release $PREV_RELEASE"
    point_current_at "$PREV_RELEASE" || warn "could not restore the static symlink"
  else
    warn "no previous static release to restore"
  fi

  # Detach rather than reset the branch: the branch pointer stays where the remote says it is,
  # so the next deploy is an ordinary fast-forward instead of a divergence to untangle.
  git checkout -q --force --detach "$PREV_SHA" || warn "could not check out $PREV_SHA"
  # Migrations are deliberately not reverted (see the file header).
  RUN_MIGRATE=0
  if build_and_reload && health; then
    warn "rolled back to $PREV_SHA and healthy."
    warn "If a MIGRATION caused the failure the schema is still ahead of this code —"
    warn "read docs/DEPLOY.md § Rollback before retrying."
    exit 1
  fi
  die "ROLLBACK FAILED — the site is down. Check '$PM2 logs crown-api' and docs/DEPLOY.md § When something is wrong."
}

trap 'rollback' ERR

# ------------------------------------------------------------------------------------- deploy
log "fetching $REMOTE"
git fetch --prune --tags "$REMOTE"

# Discard anything edited on the box. This checkout is a mirror of the remote, never a place
# where work happens, and a stray local edit must not survive into a release.
git reset -q --hard HEAD

if [ -n "$TARGET_REF" ]; then
  log "checking out $TARGET_REF (explicit ref)"
  git checkout -q --force --detach "$TARGET_REF"
else
  log "checking out $REMOTE/$BRANCH"
  # -B creates or resets the local branch onto the remote in one step, so this works on a fresh
  # clone, on a detached HEAD left by a previous --ref deploy, and on a normal repeat run.
  git checkout -q -B "$BRANCH" "$REMOTE/$BRANCH"
fi
log "now at $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

build_and_reload
health || rollback

# Past this point the new release is live and healthy; nothing below is worth a rollback.
trap - ERR

# --------------------------------------------------------------------------------- housekeeping
# Keep the last N release directories so a static-only rollback stays one symlink swap away.
if [ "$KEEP_RELEASES" -gt 0 ]; then
  # shellcheck disable=SC2012  # names are timestamp-prefixed and shell-safe by construction
  ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n "+$((KEEP_RELEASES + 1))" | while read -r old; do
    log "pruning old release $old"
    rm -rf -- "$old"
  done || true
fi

log "deployed $(git rev-parse --short HEAD) successfully"
