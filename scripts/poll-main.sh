#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH=/usr/local/bin:/usr/bin:/bin
export GIT_TERMINAL_PROMPT=0
cd "$(dirname "$0")/.."
APP_DIR=$(pwd -P)
case "$APP_DIR" in /home/*/apps/web-codex-server) ;; *) echo 'Unexpected deployment directory' >&2; exit 1;; esac
STATE_DIR="$APP_DIR/.deploy-state"
REPOSITORY=https://github.com/zjgsuzjx/web-codex-server.git
mkdir -p "$STATE_DIR" "$APP_DIR/.deploy-releases"
exec 8>"$STATE_DIR/poll.lock"
flock -n 8 || exit 0
TARGET=$(timeout 30 git ls-remote --exit-code "$REPOSITORY" refs/heads/main | awk 'NR == 1 {print $1}')
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid main commit' >&2; exit 1; }
[[ -f "$STATE_DIR/main-commit" ]] || { echo 'Install automatic deployment first' >&2; exit 1; }
[[ "$TARGET" != "$(cat "$STATE_DIR/main-commit")" ]] || exit 0
if [[ -f "$STATE_DIR/failed-attempt" ]]; then
  read -r FAILED_COMMIT FAILED_TIME < "$STATE_DIR/failed-attempt"
  if [[ "$FAILED_TIME" =~ ^[0-9]+$ && "$FAILED_COMMIT" == "$TARGET" ]] && (( $(date +%s) - FAILED_TIME < 900 )); then exit 0; fi
fi
if [[ ! -d "$STATE_DIR/source.git" ]]; then git init --bare --quiet "$STATE_DIR/source.git"; fi
timeout 60 git --git-dir="$STATE_DIR/source.git" fetch --quiet --depth=1 "$REPOSITORY" main
TARGET=$(git --git-dir="$STATE_DIR/source.git" rev-parse FETCH_HEAD)
# Only a commit fetched from this repository's main can enter this deployment path.
if git --git-dir="$STATE_DIR/source.git" ls-tree -r --name-only "$TARGET" | grep -Eq '(^|/)(AGENTS\.md|MEMORY\.md)$|^(\.env|data|\.deploy|\.deploy-state|\.deploy-releases|node_modules|dist)(/|$)'; then
  echo 'Main contains forbidden local/runtime files' >&2; exit 1
fi
STAGE=$(mktemp -d "$APP_DIR/.deploy-releases/$TARGET.XXXXXX")
cleanup() { case "$STAGE" in "$APP_DIR"/.deploy-releases/*) [[ ! -L "$STAGE" ]] && rm -rf -- "$STAGE";; *) return 1;; esac; }
trap cleanup EXIT
git --git-dir="$STATE_DIR/source.git" archive "$TARGET" | tar -x --no-same-owner --no-same-permissions -C "$STAGE"
echo "$(date -Is) Main changed: $TARGET"
if bash "$APP_DIR/scripts/deploy-release.sh" "$STAGE" "$TARGET"; then
  printf '%s\n' "$TARGET" > "$STATE_DIR/main-commit.tmp"
  mv "$STATE_DIR/main-commit.tmp" "$STATE_DIR/main-commit"
  rm -f -- "$STATE_DIR/failed-attempt"
else
  RESULT=$?
  [[ "$RESULT" == 75 ]] && exit 0
  printf '%s %s\n' "$TARGET" "$(date +%s)" > "$STATE_DIR/failed-attempt"
  echo 'Deployment failed; the same commit will retry after 15 minutes' >&2
  exit "$RESULT"
fi
