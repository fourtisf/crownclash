#!/usr/bin/env bash
#
# Regenerate ops/nginx/cloudflare-realip.conf from Cloudflare's published edge ranges.
#
# Run it from anywhere; it writes next to itself and leaves nginx alone — reloading is a
# separate, deliberate act because a bad fetch must not be able to take the site down:
#
#   sudo ops/nginx/refresh-cloudflare-ips.sh
#   sudo nginx -t && sudo systemctl reload nginx
#
# COMMIT THE RESULT. The file it rewrites is version-controlled and `ops/deploy.sh` runs
# `git reset --hard` on this checkout before every build, so an uncommitted refresh survives
# only until the next deploy — after which real client IPs silently collapse back to Cloudflare
# PoP addresses and every per-IP rate limit starts counting a whole PoP as one user. That is a
# failure with no error message, which is why it is shouted about here and checked below.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${HERE}/cloudflare-realip.conf"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

fetch() {
  curl --fail --silent --show-error --location --max-time 20 "$1"
}

v4="$(fetch https://www.cloudflare.com/ips-v4)"
v6="$(fetch https://www.cloudflare.com/ips-v6)"

# A truncated or error-page response would otherwise be written straight over a working file.
if [ "$(printf '%s\n' "$v4" | grep -c '/')" -lt 5 ] || [ "$(printf '%s\n' "$v6" | grep -c '/')" -lt 3 ]; then
  echo "refresh-cloudflare-ips: response did not look like an IP list; keeping existing file" >&2
  exit 1
fi

# Byte-for-byte reproducible on purpose — no generation timestamp. The file is committed, so
# git already records when it last changed, and a timestamp would make every run produce a diff
# and defeat the "already current" check below.
{
  echo "# Cloudflare edge ranges — trusted sources for the CF-Connecting-IP header."
  echo "#"
  echo "# GENERATED FROM https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6"
  echo "# by ops/nginx/refresh-cloudflare-ips.sh. Do not edit by hand — the script rewrites the"
  echo "# whole file. Commit the result: ops/deploy.sh does \`git reset --hard\` and would"
  echo "# otherwise revert it, silently degrading every real client IP to a Cloudflare PoP."
  echo "#"
  echo "# \`real_ip_recursive off\` is deliberate: CF-Connecting-IP holds exactly one address,"
  echo "# written by the edge. Recursion is for walking an X-Forwarded-For chain, and this"
  echo "# config never trusts one."
  echo
  printf '%s\n' "$v4" | sed '/^[[:space:]]*$/d;s#^#set_real_ip_from #;s#$#;#'
  echo
  printf '%s\n' "$v6" | sed '/^[[:space:]]*$/d;s#^#set_real_ip_from #;s#$#;#'
  echo
  echo "real_ip_header CF-Connecting-IP;"
  echo "real_ip_recursive off;"
} >"$TMP"

if cmp -s "$TMP" "$OUT"; then
  echo "refresh-cloudflare-ips: $OUT is already current; nothing to do"
  exit 0
fi

install -m 0644 "$TMP" "$OUT"
echo "refresh-cloudflare-ips: wrote $OUT"

# Only a checkout knows whether the change is committed; a copy deployed some other way does
# not, so this is advisory and never fails the run.
if git -C "$HERE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  cat >&2 <<'WARN'

  !! The ranges changed and the change is NOT committed.
     ops/deploy.sh runs `git reset --hard` before every build and will revert this file.
     Commit and push it, then:  sudo nginx -t && sudo systemctl reload nginx
WARN
fi
