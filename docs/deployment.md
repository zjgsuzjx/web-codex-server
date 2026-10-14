# Deployment guide

[Project overview](../README.md) · [简体中文](deployment.zh-CN.md)

This guide covers a Linux Docker installation for a trusted group using its own domain. The Compose service is portable; several helper scripts still contain assumptions from the original installation. Use the manual setup below for a new server.

## Requirements

- Linux with Docker Engine, the Docker Compose plugin, Git, OpenSSL, and permission to manage Docker.
- A domain pointing to your server and an HTTPS reverse proxy with a valid certificate.
- Outbound connectivity from workers to the selected model provider.
- Enough RAM and disk for the gateway, active workers, and image builds. The frontend build sets a 1.5 GiB Node heap limit; leave additional memory or swap for Docker and the operating system. This is not a measured minimum server size.
- Node.js 24+ on the host if you use the optional deployment automation or host-execution mode. The regular Docker build does not require a host Node.js installation.

## First deployment

### 1. Clone the repository

Run as your deployment user:

```bash
mkdir -p "$HOME/apps"
cd "$HOME/apps"
git clone https://github.com/zjgsuzjx/web-codex-server.git
cd web-codex-server
```

The directory may be elsewhere when using the manual Compose flow. Keep its absolute path stable: Docker bind mounts depend on it.

### 2. Create private configuration

For a **new installation**, the following Bash block creates `.env` with a random bootstrap invite and the actual Docker socket group. It refuses to overwrite an existing file. Replace `codex.example.com` with your domain before running it:

```bash
(
  set -e
  set -C
  umask 077
  cat > .env <<EOF
PUBLIC_URL=https://codex.example.com
PORT=3100
DATA_DIR=/data
HOST_DATA_DIR=$(pwd -P)/data
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
WORKER_IMAGE=starvalley-codex-worker:local
INVITE_CODE=$(openssl rand -hex 24)
COOKIE_SECURE=true
MAX_USERS=10
USER_QUOTA_MB=512
MAX_FILE_MB=256
WORKER_MEMORY_MB=384
MAX_ACTIVE_WORKERS=2
ENABLE_NESTED_SANDBOX=false
ENABLE_HOST_EXECUTION=false
EOF
)
```

`PUBLIC_URL` must exactly match the browser origin, including the scheme and any nonstandard port. `HOST_DATA_DIR` is the **host's absolute path**, while `DATA_DIR=/data` is the gateway container's path.

[.env.example](../.env.example) documents more options, but its existing domain and host paths must be replaced for another installation. Keep `.env` private and retain it during upgrades. Leave `data/template` absent or empty when members should authenticate independently; an administrator-created template can copy configuration and credentials into newly initialized accounts.

Prepare the data directory for the container's UID/GID 1000:

```bash
mkdir -p data
sudo chown 1000:1000 data
sudo chmod 700 data
```

### 3. Build and start

```bash
docker build -f Dockerfile.worker -t starvalley-codex-worker:local .
docker compose build web
docker compose up -d --wait
curl -fsS http://127.0.0.1:3100/api/health
```

The supplied [Compose file](../compose.yml) binds only `127.0.0.1:3100`, mounts `./data` and the Docker socket into the gateway, and uses the `DOCKER_GID` value from `.env`. Keep `PORT=3100` unless you also update the Compose port mapping and health check.

The worker Dockerfile currently pins Codex CLI `0.162.1`. A healthy gateway confirms the web service is running; it does not prove account authentication or a model conversation works.

### 4. Configure HTTPS and WebSockets

Use your existing reverse proxy. For Nginx on the same host, the following is an example server configuration. Replace the domain and certificate paths with **existing certificates for your domain** before validating and reloading Nginx:

```nginx
server {
    listen 80;
    server_name codex.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name codex.example.com;
    ssl_certificate /etc/letsencrypt/live/codex.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/codex.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://codex.example.com/api/health
```

The browser connects through HTTPS/WSS on your site's port. It does not connect to SSH. Upload data travels over WebSocket; make sure the proxy and any CDN support binary WebSockets and long-lived connections. A reverse proxy running in another container needs a reachable upstream; its own `127.0.0.1` is not the host's loopback.

### 5. Register the owner and invite members

Read the bootstrap invite only in your private terminal:

```bash
sed -n 's/^INVITE_CODE=//p' .env
```

Register the first account yourself; it becomes the super administrator. In `设置 → 个人账号`, create single-use invitations with notes and expiration dates for members. Full invitation values appear only when generated; the database stores their hashes. The bootstrap invite remains a reusable compatibility entry, so keep it with the operator.

Members sign in separately and connect their own ChatGPT account in `设置 → Codex 账号`. The web login uses the official CLI device-code flow; enter ChatGPT credentials only on the official authorization page. The account or workspace must permit device authorization. API-key and custom-provider configuration is also available. See [official authentication guidance](https://learn.chatgpt.com/docs/auth).

If web device login is unavailable, `bash scripts/login-user.sh <username>` is a terminal fallback. Open Codex account settings first so the user's worker exists. The script restarts that worker, so stop their tasks first. Validate a real authenticated conversation after setup.

## Isolation and permissions

| Role | Scope |
| --- | --- |
| Member (`user`) | Own projects, conversations, files, configuration, and worker. |
| Administrator (`admin`) | User-list and audit visibility; execution remains in their own workspace. |
| Super administrator (`superadmin`) | Role changes, invitation management, and optional host execution when explicitly enabled. |

Only a super administrator can change roles. At least one super administrator is retained. A role change revokes the affected user's sessions, closes terminals, destroys their old execution environment, and resets it to workspace execution.

Ordinary workers run as UID 1000 with a read-only root filesystem, all capabilities dropped, and `no-new-privileges`. They mount only their owner's projects and Codex directory, with no Docker socket, host root mount, or host PID/network namespaces. Automatic command approval does not grant host permissions.

With `ENABLE_NESTED_SANDBOX=false`, Docker provides the user boundary, and Codex/terminal access covers that user's **entire mounted workspace**, including other projects and configuration. Current-project-only and read-only sandbox options are unavailable. Enable the nested sandbox only after separately verifying your host supports it.

The gateway's Docker socket gives it powerful host management access. Host administrators can read data and credential files. Workspace separation is not end-to-end encryption or a security boundary against the operator.

`ENABLE_HOST_EXECUTION=false` is the default. Enabling it additionally requires a compatible host Codex installation plus `HOST_CODEX_SCRIPT` and `HOST_CODEX_BIN`. A super administrator must then explicitly select server execution in the web UI. This mode uses a privileged helper to enter the actual host namespaces as **root**, with access to system files, services, and other users' data. It uses host networking. Returning to workspace execution repairs that user's file ownership through a restricted helper.

## Data and backups

```text
data/
  app.sqlite                    # Users, sessions, ownership, audit and UI state
  users/<username>/
    projects/<project-uuid>/    # Project files
    codex/                     # Configuration, credentials and CLI history
      chat-attachments/        # Conversation attachments
  uploads/<user-uuid>/         # Temporary uploads outside worker mounts
```

`.env`, `auth.json`, account configuration, database files, and backups are private runtime data. Back up configuration and `data/` together with appropriate access controls. The operator should plan downtime for a consistent SQLite and project snapshot.

For a deployment under `/home/<user>/apps/web-codex-server`, the supplied script can back up `data/`:

```bash
bash scripts/backup.sh
```

It stops the gateway and its managed workers, writes a private archive under `backups/`, then starts the service again. It backs up `data/`, **not `.env`**; preserve `.env` separately. On other paths, adapt the script's path guard or use your own consistent backup procedure. Test restoration in an isolated environment before relying on backups.

Keep local `AGENTS.md` and `MEMORY.md` out of Git, server uploads, deployment archives, and images. Package releases from a reviewed tracked-file list or `git archive`, not the entire local directory. Do not commit configuration, runtime data, or backups. The supplied Dockerfile copies explicit application paths; do not add broad runtime-directory copies.

## Operational limits

| Setting / behavior | Default or limit |
| --- | --- |
| Registered accounts | `MAX_USERS=10` |
| Active workers at once | `MAX_ACTIVE_WORKERS=2`; additional accounts do not imply simultaneous worker capacity |
| Per-worker resources | `WORKER_MEMORY_MB=384`, 0.75 CPU |
| Worker idle stop | 15 minutes without connections or active tasks |
| Web upload/editor quota | `USER_QUOTA_MB=512` per user |
| Project file upload size | `MAX_FILE_MB=256`; also constrained by remaining user quota |
| Projects | 50 per user |
| Chat attachments | Up to 10 per turn, 20 MB each, counted against storage quota |
| In-browser folder compression | Up to 128 MB; prepare a ZIP locally for larger folders |
| Interrupted uploads | Resume within the same page; expire after 30 minutes; service restart requires reupload |

Codex and terminal writes are not constrained by application storage quotas. Monitor host disk space and use filesystem quotas if you need a hard disk limit. Text attachments are inlined with bounded sizes; binary documents require model tools to read or parse them. ZIP extraction validates paths and sizes and rejects overwriting existing project files.

Turning worker network access off recreates the worker with `NetworkMode=none`, which also blocks model/API access. Stop tasks and close terminals before switching.

Quota details depend on the CLI and account. API keys and custom providers may not expose ChatGPT quota windows; unavailable values remain unknown. Automatic conversation title fallback requests can consume account quota.

## Updates and optional automation

For manual updates, arrange an idle window, review the new code, update the checkout, rebuild the worker if its Dockerfile changed, and rebuild/recreate the gateway. Preserve `.env` and `data/`. Manual Compose updates do not provide the deployment script's readiness checks or rollback.

```bash
docker compose ps
docker compose logs --tail 100 web
curl -fsS http://127.0.0.1:3100/api/health
```

The optional [GitHub Actions workflow](../.github/workflows/deploy.yml) submits an SSH request when `main` changes. The server builds from `git archive`, checks/tests a candidate image without production data or Docker socket mounts, defers switching while the application is busy, and restores the prior image on switch/health failure. It uses no recurring repository polling.

**Adapt the supplied scripts before using them on a different installation:**

- `server-deploy.sh`, `deploy-main.sh`, `deploy-release.sh`, `backup.sh`, and `configure-nginx.sh` allow only `/home/*/apps/web-codex-server` paths.
- `server-deploy.sh` creates an installation-specific `PUBLIC_URL` when `.env` is absent.
- `configure-nginx.sh` and `deploy/nginx.conf` contain the original domain, certificate paths, and host Nginx assumptions.
- The workflow's remote `cd` is hardcoded; replace it with your server directory.
- `deploy-main.sh` fetches this repository's `main`; point it at your fork when deploying a fork.
- The server scripts require Node.js 24+, Git, Bash, curl, flock, and Docker. Install them with the initial release before enabling the workflow.

Configure repository Actions secrets:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | SSH hostname or IP |
| `DEPLOY_USER` | Deployment user |
| `DEPLOY_SSH_KEY` | Deployment-specific private key authorized on the server |
| `DEPLOY_KNOWN_HOSTS` | Host key records independently verified through a trusted channel |
| `DEPLOY_PORT` | Optional port; defaults to `22` |

Actions success means the SSH request was submitted, **not that deployment finished**. Check the request log path printed by Actions, `.deploy-state/deployed-commit`, and the health endpoint's `revision`. The initial manual build may report an unknown revision. Application upgrades briefly restart the gateway and reconnect browser clients.

## Local development

Use Node.js 24+. Without a production `.env`, the backend defaults to `http://localhost:3100` with local `./data`. Do not reuse container-specific `DATA_DIR=/data` for host development.

```bash
npm ci
npm run build
npm start
```

For frontend hot reload, set `PUBLIC_URL=http://localhost:5173` and `COOKIE_SECURE=false` in your local configuration, run `npm run dev` for the backend and `npx vite` in another terminal, then open exactly that origin. Vite proxies `/api` and `/ws` to port 3100.

Windows supports account/file development and most tests; real workers require Linux Docker. Run `npm run check`, `npm test`, and `npm run build` for code changes. Linux additionally exercises platform-specific checks. The existing `scripts/smoke.mjs` checks CLI protocol and shell/terminal plumbing with temporary accounts; it does not call a model for inference. Upgrade the pinned CLI only after protocol and authenticated workflow verification.
