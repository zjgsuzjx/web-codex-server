#!/usr/bin/env bash
set -euo pipefail
umask 077
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
cd "${DEPLOY_APP_DIR:-$SCRIPT_DIR/..}"
APP_DIR=$(pwd -P)
case "$APP_DIR" in /home/*/apps/web-codex-server) ;; *) echo 'Unexpected deployment directory' >&2; exit 1;; esac
STATE_DIR="$APP_DIR/.deploy-state"
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || exit 75
SOURCE_DIR=$(realpath -e "${1:?Usage: deploy-release.sh SOURCE_DIR COMMIT [--bootstrap]}")
REVISION=${2:?Missing commit}
BOOTSTRAP_MODE=${3:-}
[[ -z "$BOOTSTRAP_MODE" || "$BOOTSTRAP_MODE" == --bootstrap ]] || { echo 'Unsupported deployment option' >&2; exit 1; }
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit' >&2; exit 1; }
case "$SOURCE_DIR" in "$APP_DIR"/.deploy-releases/*) ;; *) echo 'Source must be an isolated release directory' >&2; exit 1;; esac
[[ -f "$APP_DIR/.env" && -f "$SOURCE_DIR/Dockerfile" && -f "$SOURCE_DIR/compose.yml" ]] || { echo 'Missing deployment configuration' >&2; exit 1; }
for private in AGENTS.md MEMORY.md .env data .git .deploy .deploy-state .deploy-releases; do
  [[ ! -e "$SOURCE_DIR/$private" ]] || { echo "Release contains forbidden local/runtime files: $private" >&2; exit 1; }
done
[[ -z "$(find "$SOURCE_DIR" -type l -print -quit)" ]] || { echo 'Release symlinks are not supported' >&2; exit 1; }

ready() {
  local health
  health=$(curl --fail --silent --show-error --max-time 8 http://127.0.0.1:3100/api/health) || return 1
  node -e 'const h=JSON.parse(process.argv[1]); process.exit(h.status === "ok" && (h.deploymentReady === true || (h.deploymentReady == null && process.argv[2] === "--bootstrap")) ? 0 : 1)' "$health" "$BOOTSTRAP_MODE"
}
wait_ready() {
  for attempt in {1..21}; do
    if ready; then return 0; fi
    [[ "$attempt" -lt 21 ]] || { echo 'Application remained busy or unavailable; rerun when idle' >&2; return 75; }
    echo 'Waiting 30 seconds for application readiness'
    sleep 30
  done
}
wait_ready
WEB_IMAGE="starvalley-codex-web:$REVISION"
WORKER_IMAGE="starvalley-codex-worker:$REVISION"
PREVIOUS_WEB=$(docker image inspect starvalley-codex-web:local --format '{{.Id}}')
PREVIOUS_WORKER=$(docker image inspect starvalley-codex-worker:local --format '{{.Id}}' 2>/dev/null || true)
BUILD_WORKER=false
source "$SCRIPT_DIR/deploy-build.sh"
PROMOTING=false
cleanup() {
  local result=$?
  trap - EXIT
  finish_build || result=1
  if [[ "$PROMOTING" == true ]]; then rollback || result=1; fi
  [[ -z "${PREVIOUS_COMPOSE:-}" ]] || rm -f -- "$PREVIOUS_COMPOSE"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 143' TERM HUP
trap 'exit 130' INT
prepare_build
if [[ -z "$PREVIOUS_WORKER" ]] || ! cmp -s "$SOURCE_DIR/Dockerfile.worker" "$APP_DIR/Dockerfile.worker"; then
  BUILD_WORKER=true
  build_image --file "$SOURCE_DIR/Dockerfile.worker" --tag "$WORKER_IMAGE" "$SOURCE_DIR"
fi
build_image --build-arg "APP_REVISION=$REVISION" --label "org.opencontainers.image.revision=$REVISION" --tag "$WEB_IMAGE" "$SOURCE_DIR"
finish_build
# The candidate has no production data, host namespace or Docker socket mounted.
timeout --kill-after=15s 300s docker run --rm --network none --memory 384m --cpus .75 "$WEB_IMAGE" sh -c 'npm run check && npm test'
# Wait here if work started during the build; reuse the tested candidate.
wait_ready

rollback() {
  PROMOTING=false
  echo 'Restoring the previous application image' >&2
  docker tag "$PREVIOUS_WEB" starvalley-codex-web:local
  if [[ -n "$PREVIOUS_WORKER" && "$BUILD_WORKER" == true ]]; then docker tag "$PREVIOUS_WORKER" starvalley-codex-worker:local; fi
  docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.env" --project-name web-codex-server --file "$PREVIOUS_COMPOSE" up -d --no-build --wait --wait-timeout 120 web
}
PREVIOUS_COMPOSE=$(mktemp "$STATE_DIR/previous-compose.XXXXXX")
cp "$APP_DIR/compose.yml" "$PREVIOUS_COMPOSE"
PROMOTING=true
docker tag "$PREVIOUS_WEB" starvalley-codex-web:previous
docker tag "$WEB_IMAGE" starvalley-codex-web:local
if [[ "$BUILD_WORKER" == true ]]; then docker tag "$WORKER_IMAGE" starvalley-codex-worker:local; fi
if ! docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.env" --project-name web-codex-server --file "$SOURCE_DIR/compose.yml" up -d --no-build --wait --wait-timeout 120 web; then
  rollback; exit 1
fi
HEALTH=$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3100/api/health) || { rollback; exit 1; }
if ! node -e 'const h=JSON.parse(process.argv[1]); process.exit(h.status === "ok" && h.revision === process.argv[2] ? 0 : 1)' "$HEALTH" "$REVISION"; then
  rollback; exit 1
fi
# rsync replaces source files atomically and preserves private/runtime directories.
rsync -a --no-owner --no-group "$SOURCE_DIR/" "$APP_DIR/"
printf '%s\n' "$REVISION" > "$STATE_DIR/deployed-commit.tmp"
mv "$STATE_DIR/deployed-commit.tmp" "$STATE_DIR/deployed-commit"
PROMOTING=false
echo "Deployed $REVISION; application healthy"
