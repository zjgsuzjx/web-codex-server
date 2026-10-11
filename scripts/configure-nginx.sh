#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR=$(pwd -P)
case "$APP_DIR" in /home/*/apps/web-codex-server) ;; *) echo 'Unexpected deployment directory' >&2; exit 1;; esac
# Scope the write to this new domain's file. Existing sites are preserved.
docker run --rm --network none --entrypoint /bin/sh --mount type=bind,src=/etc/nginx/conf.d,dst=/nginx-conf --mount "type=bind,src=$APP_DIR/deploy,dst=/input,readonly" alpine/socat -c 'test ! -f /nginx-conf/codex.starvalley.fun.conf || cp /nginx-conf/codex.starvalley.fun.conf /nginx-conf/codex.starvalley.fun.conf.previous; cp /input/nginx.conf /nginx-conf/codex.starvalley.fun.conf'
# The existing account has Docker access and no passwordless sudo. Use the host's
# installed nginx to validate, then signal its existing master process.
docker run --rm --network host --pid host --security-opt apparmor=unconfined --cap-add KILL --entrypoint /bin/sh --mount type=bind,src=/,dst=/host,readonly --mount type=bind,src=/var/log/nginx,dst=/host/var/log/nginx --mount type=bind,src=/run/nginx.pid,dst=/host/run/nginx.pid alpine/socat -c 'chroot /host /usr/sbin/nginx -t && kill -HUP $(cat /host/run/nginx.pid)'
for attempt in {1..15}; do
  RESPONSE=$(curl --fail --silent --show-error --resolve codex.starvalley.fun:443:127.0.0.1 https://codex.starvalley.fun/api/health || true)
  if [[ "$RESPONSE" == *'"status":"ok"'* ]]; then printf '%s\n' "$RESPONSE"; exit 0; fi
  sleep 1
done
echo 'New HTTPS site did not become healthy' >&2; exit 1
