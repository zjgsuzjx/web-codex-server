#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
APP_DIR=$(pwd -P)
case "$APP_DIR" in /home/*/apps/web-codex-server) ;; *) echo 'Unexpected deployment directory' >&2; exit 1;; esac
[[ "$APP_DIR" != *[[:space:]]* ]] || { echo 'Whitespace in deployment path is unsupported' >&2; exit 1; }
for command in git curl node docker flock rsync timeout crontab; do command -v "$command" >/dev/null || { echo "Missing $command" >&2; exit 1; }; done
[[ -f .env && -f scripts/poll-main.sh ]] || { echo 'Deploy the application first' >&2; exit 1; }
mkdir -p .deploy-state .deploy-releases
if [[ ! -f .deploy-state/main-commit ]]; then
  TARGET=$(GIT_TERMINAL_PROMPT=0 timeout 30 git ls-remote --exit-code https://github.com/zjgsuzjx/web-codex-server.git refs/heads/main | awk 'NR == 1 {print $1}')
  [[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || exit 1
  printf '%s\n' "$TARGET" > .deploy-state/main-commit
fi
CRON=$(mktemp "$APP_DIR/.deploy-state/crontab.XXXXXX")
trap 'rm -f -- "$CRON"' EXIT
(crontab -l 2>/dev/null || true) | awk '!/# starvalley-codex-auto-deploy$/' > "$CRON"
printf '* * * * * /usr/bin/timeout 1800 /bin/bash %s/scripts/poll-main.sh >> %s/.deploy-state/auto-deploy.log 2>&1 # starvalley-codex-auto-deploy\n' "$APP_DIR" "$APP_DIR" >> "$CRON"
crontab "$CRON"
echo 'Automatic main deployment installed (every minute, server-side build; existing cron jobs preserved)'
