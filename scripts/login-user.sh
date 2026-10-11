#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ $# -ne 1 ] || [[ ! "$1" =~ ^[a-z][a-z0-9_-]{2,31}$ ]]; then
  echo "Usage: bash scripts/login-user.sh <registered-username>" >&2; exit 1
fi
CONTAINER_ID=$(docker compose exec -T -e LOOKUP_USERNAME="$1" web node --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync("/data/app.sqlite");const user=db.prepare("SELECT id FROM users WHERE username=?").get(process.env.LOOKUP_USERNAME);if(!user)process.exit(1);process.stdout.write("sv-codex-"+user.id);')
if ! docker inspect "$CONTAINER_ID" >/dev/null 2>&1; then echo 'Open Codex account settings in the website first to create the user container.' >&2; exit 1; fi
docker start "$CONTAINER_ID" >/dev/null
TARGET=$(docker inspect --format '{{index .Config.Labels "starvalley.execution"}}' "$CONTAINER_ID")
if [ "$TARGET" = server ]; then
  mapfile -t LOGIN_PATHS < <(docker compose exec -T -e LOOKUP_USERNAME="$1" web node --input-type=module -e 'import path from "node:path";console.log(path.join(process.env.HOST_DATA_DIR,"users",process.env.LOOKUP_USERNAME));console.log(process.env.HOST_CODEX_SCRIPT);')
  docker exec -it "$CONTAINER_ID" nsenter --target=1 --mount --uts --ipc --net --pid --root --wd -- /usr/bin/env "HOME=${LOGIN_PATHS[0]}" "CODEX_HOME=${LOGIN_PATHS[0]}/codex" /usr/bin/node "${LOGIN_PATHS[1]}" login --device-auth
else
  docker exec -it "$CONTAINER_ID" codex login --device-auth
fi
docker restart "$CONTAINER_ID" >/dev/null
echo 'Login completed. Refresh the account status in website settings.'
