#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH=/usr/local/bin:/usr/bin:/bin
export GIT_TERMINAL_PROMPT=0
cd "$(dirname "$0")/.."
APP_DIR=$(pwd -P)
case "$APP_DIR" in /home/*/apps/web-codex-server) ;; *) echo 'Unexpected deployment directory' >&2; exit 1;; esac
REVISION=${1:?Usage: deploy-main.sh COMMIT}
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit' >&2; exit 1; }
STATE_DIR="$APP_DIR/.deploy-state"
REPOSITORY=https://github.com/zjgsuzjx/web-codex-server.git
mkdir -p "$STATE_DIR" "$APP_DIR/.deploy-releases"
exec 8>"$STATE_DIR/main.lock"
flock -w 1800 8 || { echo 'Timed out waiting for the previous deployment' >&2; exit 1; }
if [[ -f "$STATE_DIR/deployed-commit" && "$(cat "$STATE_DIR/deployed-commit")" == "$REVISION" ]]; then
  echo "Already deployed: $REVISION"; exit 0
fi
if [[ ! -d "$STATE_DIR/source.git" ]]; then git init --bare --quiet "$STATE_DIR/source.git"; fi
timeout 60 git --git-dir="$STATE_DIR/source.git" fetch --quiet --depth=1 "$REPOSITORY" refs/heads/main
TARGET=$(git --git-dir="$STATE_DIR/source.git" rev-parse FETCH_HEAD)
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid main commit' >&2; exit 1; }
if [[ "$TARGET" != "$REVISION" ]]; then
  echo "Request superseded by main $TARGET; skipping $REVISION"; exit 0
fi
# Only the exact current main commit can enter this deployment path.
if git --git-dir="$STATE_DIR/source.git" ls-tree -r --name-only "$TARGET" | grep -Eq '(^|/)(AGENTS\.md|MEMORY\.md)$|^(\.env|data|\.deploy|\.deploy-state|\.deploy-releases|node_modules|dist)(/|$)'; then
  echo 'Main contains forbidden local/runtime files' >&2; exit 1
fi
STAGE=$(mktemp -d "$APP_DIR/.deploy-releases/$TARGET.XXXXXX")
cleanup() { case "$STAGE" in "$APP_DIR"/.deploy-releases/*) [[ ! -L "$STAGE" ]] && rm -rf -- "$STAGE";; *) return 1;; esac; }
trap cleanup EXIT
git --git-dir="$STATE_DIR/source.git" archive "$TARGET" | tar -x --no-same-owner --no-same-permissions -C "$STAGE"
echo "$(date -Is) Server deployment started: $TARGET"
# Retry readiness only during this triggered request, with a ten-minute limit.
# There is no cron, recurring repository check or permanent background process.
for attempt in {1..21}; do
  if bash "$APP_DIR/scripts/deploy-release.sh" "$STAGE" "$TARGET"; then
    echo "$(date -Is) Deployment successful: $TARGET"; exit 0
  else
    RESULT=$?
    [[ "$RESULT" == 75 ]] || { echo "Deployment failed: $TARGET (exit $RESULT)" >&2; exit "$RESULT"; }
    [[ "$attempt" -lt 21 ]] || { echo 'Application remained busy; rerun the workflow when idle' >&2; exit 75; }
    echo 'Application busy; waiting 30 seconds before retrying readiness'
    sleep 30
  fi
done
