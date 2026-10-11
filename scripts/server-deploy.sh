#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR=$(pwd -P)
case "$APP_DIR" in /home/*/apps/web-codex-server) ;; *) echo "Unexpected deployment path: $APP_DIR" >&2; exit 1;; esac
if [ ! -f .env ]; then
  APP_DIR="$APP_DIR" node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const gid=execFileSync('stat',['-c','%g','/var/run/docker.sock'],{encoding:'utf8'}).trim();
const env=`PUBLIC_URL=https://codex.starvalley.fun\nPORT=3100\nDATA_DIR=/data\nHOST_DATA_DIR=${process.env.APP_DIR}/data\nDOCKER_GID=${gid}\nWORKER_IMAGE=starvalley-codex-worker:local\nINVITE_CODE=${crypto.randomBytes(24).toString('hex')}\nCOOKIE_SECURE=true\nMAX_USERS=10\nUSER_QUOTA_MB=512\nMAX_FILE_MB=256\nWORKER_MEMORY_MB=384\nMAX_ACTIVE_WORKERS=2\n`;
fs.writeFileSync('.env',env,{mode:0o600,flag:'wx'});
NODE
fi
mkdir -p data
docker run --rm --network none --entrypoint /bin/sh --mount "type=bind,src=$APP_DIR/data,dst=/app-data" alpine/socat -c 'chown 1000:1000 /app-data && chmod 700 /app-data'
docker build -f Dockerfile.worker -t starvalley-codex-worker:local .
docker compose build web
docker compose up -d --wait --wait-timeout 120
echo 'Application healthy. Configure the domain-specific Nginx file next.'
