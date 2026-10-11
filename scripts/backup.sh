#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR=$(pwd -P)
case "$APP_DIR" in /home/*/apps/web-codex-server) ;; *) echo 'Unexpected deployment directory' >&2; exit 1;; esac
mkdir -p backups
chmod 700 backups
BACKUP_NAME="codex-$(date -u +%Y%m%d-%H%M%S).tar.gz"
# Stop the gateway gracefully, which also stops all managed workers, for a consistent snapshot.
docker compose stop web
trap 'docker compose up -d web' EXIT
docker run --rm --network none --entrypoint /bin/sh --mount "type=bind,src=$APP_DIR/data,dst=/data,readonly" --mount "type=bind,src=$APP_DIR/backups,dst=/backup" alpine/socat -c 'tar czf /backup/backup.tar.gz -C / data && chmod 600 /backup/backup.tar.gz'
docker run --rm --network none --entrypoint /bin/sh --mount "type=bind,src=$APP_DIR/backups,dst=/backup" alpine/socat -c "mv /backup/backup.tar.gz /backup/$BACKUP_NAME; chown $(id -u):$(id -g) /backup/$BACKUP_NAME"
echo "$APP_DIR/backups/$BACKUP_NAME"
