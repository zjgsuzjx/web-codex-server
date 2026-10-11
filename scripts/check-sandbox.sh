#!/usr/bin/env bash
set -euo pipefail
docker run --rm --cap-drop ALL --security-opt no-new-privileges:true --read-only --tmpfs /tmp:rw,nosuid,nodev,size=32m -e CODEX_HOME=/tmp/codex --entrypoint /bin/sh starvalley-codex-worker:local -c 'mkdir -p /tmp/codex; codex sandbox -c sandbox_mode="danger-full-access" -- sh -c "printf container-exec-ok"'
