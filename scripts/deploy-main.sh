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
flock -w 600 8 || { echo 'Timed out waiting for the previous deployment' >&2; exit 1; }
STAGE=
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "$STAGE" ]]; then
    case "$STAGE" in "$APP_DIR"/.deploy-releases/"$REVISION".*)
      [[ ! -L "$STAGE" ]] && rm -rf -- "$STAGE" || result=1;;
      *) echo 'Refusing unexpected release cleanup' >&2; result=1;;
    esac
  fi
  node -e 'const fs=require("node:fs"); const [file,revision,code]=process.argv.slice(1); fs.writeFileSync(file+".tmp",JSON.stringify({revision,status:code==="0"?"succeeded":"failed",exitCode:Number(code),finishedAt:new Date().toISOString()})+"\n",{mode:0o600}); fs.renameSync(file+".tmp",file)' "$STATE_DIR/result-$REVISION.json" "$REVISION" "$result"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 143' TERM HUP
trap 'exit 130' INT
if [[ -f "$STATE_DIR/deployed-commit" && "$(cat "$STATE_DIR/deployed-commit")" == "$REVISION" ]]; then
  HEALTH=$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3100/api/health)
  node -e 'const h=JSON.parse(process.argv[1]); if(h.status!=="ok"||h.revision!==process.argv[2])process.exit(1)' "$HEALTH" "$REVISION"
  echo "Already deployed: $REVISION"; exit 0
fi
if [[ ! -d "$STATE_DIR/source.git" ]]; then git init --bare --quiet "$STATE_DIR/source.git"; fi
timeout 60 git --git-dir="$STATE_DIR/source.git" fetch --quiet --depth=1 "$REPOSITORY" refs/heads/main
TARGET=$(git --git-dir="$STATE_DIR/source.git" rev-parse FETCH_HEAD)
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid main commit' >&2; exit 1; }
if [[ "$TARGET" != "$REVISION" ]]; then
  echo "Request superseded by main $TARGET; rerun the workflow for main instead of $REVISION"; exit 78
fi
# Only the exact current main commit can enter this deployment path.
if git --git-dir="$STATE_DIR/source.git" ls-tree -r --name-only "$TARGET" | grep -Eq '(^|/)(AGENTS\.md|MEMORY\.md)$|^(\.env|data|\.deploy|\.deploy-state|\.deploy-releases|node_modules|dist)(/|$)'; then
  echo 'Main contains forbidden local/runtime files' >&2; exit 1
fi
STAGE=$(mktemp -d "$APP_DIR/.deploy-releases/$TARGET.XXXXXX")
# Keep state/log files private, but preserve readable source modes for the
# non-root runtime image. The temporary release directory itself stays 0700.
(umask 022; git --git-dir="$STATE_DIR/source.git" archive "$TARGET" | tar -x --no-same-owner --no-same-permissions -C "$STAGE")
echo "$(date -Is) Server deployment started: $TARGET"
# Run the requested release's deployment code, including its resource guards.
DEPLOY_APP_DIR="$APP_DIR" bash "$STAGE/scripts/deploy-release.sh" "$STAGE" "$TARGET"
echo "$(date -Is) Deployment successful: $TARGET"
