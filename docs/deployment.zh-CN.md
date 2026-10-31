# 部署指南

[项目介绍](../README.zh-CN.md) · [English](deployment.md)

本指南说明如何在自己的 Linux 服务器与域名上，为可信成员部署服务。Compose 服务可以通用部署；部分辅助脚本仍保留原安装环境的假设，新服务器请先使用下面的手动步骤。

## 环境要求

- Linux、Docker Engine、Docker Compose 插件、Git、OpenSSL，以及管理 Docker 的权限。
- 指向服务器的域名、HTTPS 反向代理与有效证书。
- worker 可以向所选模型服务商发起网络连接。
- 为网关、活跃 worker 与镜像构建准备足够内存和磁盘。单独限制 Node 堆不能限制整个 Docker 构建；下方可选自动部署使用专用受限 BuildKit 容器，并串行编译 Monaco Worker。
- 使用可选部署自动化或宿主机执行模式时，宿主机需要 Node.js 24+。普通 Docker 构建不需要宿主机安装 Node.js。

## 首次部署

### 1. 获取源码

使用部署用户运行：

```bash
mkdir -p "$HOME/apps"
cd "$HOME/apps"
git clone https://github.com/zjgsuzjx/web-codex-server.git
cd web-codex-server
```

手动 Compose 部署可以放在其他目录。部署后请保持绝对路径稳定，Docker 绑定挂载依赖该路径。

### 2. 创建私有配置

以下 Bash 命令用于**全新安装**，生成随机初始邀请码，并读取 Docker socket 的实际组 ID；已有 `.env` 时拒绝覆盖。运行前请将 `codex.example.com` 替换为自己的域名：

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
MAX_FILE_MB=256
WORKER_MEMORY_MB=384
MAX_ACTIVE_WORKERS=2
ENABLE_NESTED_SANDBOX=false
ENABLE_HOST_EXECUTION=false
EOF
)
```

`PUBLIC_URL` 必须与浏览器访问来源完全一致，包括协议与非标准端口。`HOST_DATA_DIR` 是**宿主机上的绝对路径**，`DATA_DIR=/data` 是网关容器内的路径。

[.env.example](../.env.example)说明了其他选项，其中现有域名与主机路径需要按自己的安装环境替换。妥善保管 `.env`，升级时保留原文件。希望每位成员独立授权时，请保持 `data/template` 不存在或为空；管理员创建的模板可以将配置及凭据复制给新初始化的账号。

为容器的 UID/GID 1000 准备数据目录：

```bash
mkdir -p data
sudo chown 1000:1000 data
sudo chmod 700 data
```

### 3. 构建并启动

```bash
docker build -f Dockerfile.worker -t starvalley-codex-worker:local .
docker compose build web
docker compose up -d --wait
curl -fsS http://127.0.0.1:3100/api/health
```

[Compose 配置](../compose.yml)仅绑定 `127.0.0.1:3100`，向网关挂载 `./data` 和 Docker socket，并读取 `.env` 中的 `DOCKER_GID`。请保持 `PORT=3100`；若修改，需要同步调整 Compose 端口映射与健康检查。

worker Dockerfile 当前固定 Codex CLI `0.162.1`。网关健康只能说明网页服务运行正常，不能证明账号登录与模型对话已经可用。

### 4. 配置 HTTPS 与 WebSocket

可使用已有反向代理。下面是同一宿主机上的 Nginx 示例；请先将域名和证书路径替换为**自己域名的已有证书**，再校验并重载：

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

浏览器通过站点端口访问 HTTPS/WSS，不连接 SSH。上传通过 WebSocket 传输，请确认反向代理和 CDN 支持二进制 WebSocket 及长连接。反向代理如果运行在另一个容器里，需要配置可以访问到的上游地址；该容器自己的 `127.0.0.1` 并不是宿主机回环地址。

### 5. 注册站点主人并邀请成员

仅在自己的私有终端中查看初始邀请码：

```bash
sed -n 's/^INVITE_CODE=//p' .env
```

先自己注册首个账号，它将成为超级管理员。在 `设置 → 个人账号` 中，为成员创建有备注和有效期的单次邀请码。完整邀请码只在生成时显示，数据库保存哈希。初始邀请码仍是可重复使用的兼容入口，请由部署者保管。

成员分别登录网页，再在 `设置 → Codex 账号` 中连接自己的 ChatGPT 账号。网页登录使用官方 CLI 的设备码流程，ChatGPT 凭据只在官方授权页输入；账号或工作区必须允许设备授权。也支持 API Key 和自定义服务商配置，详见[官方登录说明](https://learn.chatgpt.com/docs/auth)。

网页设备登录不可用时，可运行 `bash scripts/login-user.sh <用户名>` 作为终端回退。先在网页打开 Codex 账号设置，确保该用户 worker 已创建。脚本会重启该 worker，请先停止其任务。配置完成后，应实际验收一次完成登录后的模型对话。

## 隔离与权限

| 角色 | 范围 |
| --- | --- |
| 成员（`user`） | 本人的项目、对话、文件、配置与 worker。 |
| 管理员（`admin`） | 用户列表与操作记录查看；执行仍限定在本人工作区。 |
| 超级管理员（`superadmin`） | 角色变更、邀请码管理，以及显式开启后的可选宿主机执行。 |

只有超级管理员能修改角色，系统保留至少一名超级管理员。角色变更会撤销目标用户登录会话、关闭终端、销毁旧执行环境，并重置为工作区执行。

普通 worker 使用 UID 1000、只读系统根目录，移除全部 capabilities，并设置 `no-new-privileges`。只挂载本人的项目和 Codex 目录，不挂载 Docker socket、宿主机根目录，也不进入宿主机 PID/网络命名空间。自动批准命令不会授予宿主机权限。

`ENABLE_NESTED_SANDBOX=false` 时，Docker 提供用户边界，Codex 和终端可以访问该用户**完整的挂载工作区**，包括其他项目与配置。仅当前项目写入及只读沙箱选项不可用；应单独验证主机支持情况后，才开启内层沙箱。

网关的 Docker socket 访问权带来很强的主机管理能力。宿主机管理员可以读取数据及凭据文件；工作区隔离不是端到端加密，也不能隔离运营者。

`ENABLE_HOST_EXECUTION=false` 是默认值。开启还需宿主机安装兼容 Codex，并配置 `HOST_CODEX_SCRIPT`、`HOST_CODEX_BIN`；随后超级管理员需要在网页中明确选择服务器执行。此模式通过特权助手进入真实宿主机命名空间，以 **root** 操作系统文件、服务和其他用户数据，使用宿主机网络。切回工作区时，通过受限助手修复该用户的文件所有权。

## 数据与备份

```text
data/
  app.sqlite                    # 用户、会话、归属、审计及界面状态
  users/<username>/
    projects/<project-uuid>/    # 项目文件
    codex/                     # 配置、凭据及 CLI 历史
      chat-attachments/        # 对话附件
  uploads/<user-uuid>/         # 临时上传，位于 worker 挂载范围之外
```

`.env`、`auth.json`、账号配置、数据库与备份都是私有运行数据。请一起备份配置和 `data/`，设置合适的访问权限；为一致的 SQLite 与项目快照安排停机窗口。

安装路径为 `/home/<用户>/apps/web-codex-server` 时，可以使用现有脚本备份 `data/`：

```bash
bash scripts/backup.sh
```

脚本停止网关及其管理的 worker，在 `backups/` 下生成私有归档，再启动服务。它备份 `data/`，**不包含 `.env`**，请另外保管配置。其他安装路径需调整脚本路径检查，或采用自己的、一致的备份流程。依赖备份前，先在隔离环境验证恢复。

本地 `AGENTS.md` 和 `MEMORY.md` 不得进入 Git、服务器上传、部署归档或镜像。发布使用经过检查的已跟踪文件清单或 `git archive`，不要直接打包整个本地目录。不要提交配置、运行数据或备份。Dockerfile 使用明确的应用路径复制，不应增加对运行目录的整体复制。

## 运行限制

| 配置或行为 | 默认值或限制 |
| --- | --- |
| 注册账号数 | `MAX_USERS=10` |
| 同时活跃 worker | `MAX_ACTIVE_WORKERS=2`；可注册人数不等于并发 worker 容量 |
| 每个 worker 资源 | `WORKER_MEMORY_MB=384`、0.75 CPU |
| 闲置停止 | 没有连接或活跃任务时，15 分钟后停止 |
| 网页上传及编辑配额 | 成员 1 GiB；管理员 5 GiB；超级管理员不限量 |
| 项目文件上传大小 | `MAX_FILE_MB=256`，同时受剩余用户配额限制 |
| 项目数 | 每用户 50 个 |
| 对话附件 | 每轮最多 10 个、每个 20 MB，计入存储配额 |
| 浏览器文件夹压缩 | 最多 128 MB；更大目录先在本地生成 ZIP |
| 上传中断 | 同一页面内恢复，30 分钟后过期；服务重启需重新上传 |

容量统计包含项目、对话附件及 Codex 状态。旧 `USER_QUOTA_MB` 环境变量不再生效，上限按当前角色计算。智能清理使用用户已有的 Codex 连接，分析有界的本人项目文件清单，不包含凭据或其他用户数据。用户确认后再次发送清理清单，网关核对已批准的 ID 及文件变化后执行删除。物理磁盘满可能使 Codex 无法启动，此时仍需先在文件管理器中手动删除腾出空间。

Codex 与终端写入不受应用存储配额约束，请监控主机磁盘；需要硬性容量限制时，使用文件系统配额。文本附件有正文内联上限，二进制文档需要模型工具读取或解析。ZIP 解压会验证路径和大小，并拒绝覆盖已有项目文件。

关闭 worker 网络会以 `NetworkMode=none` 重建容器，同时阻断模型/API 访问。切换前请停止任务并关闭终端。

额度详情取决于 CLI 与账号，API Key 或自定义服务商可能不提供 ChatGPT 额度窗口，不可获取的值保留未知。自动对话标题的回退摘要请求可能消耗账号额度。

## 更新与可选自动化

手动升级前先安排空闲窗口，审查新代码、更新源码；worker Dockerfile 有变更时重建 worker，再构建并更新网关。保留 `.env` 与 `data/`。手动 Compose 升级不具备部署脚本提供的就绪检查和回滚流程。

```bash
docker compose ps
docker compose logs --tail 100 web
curl -fsS http://127.0.0.1:3100/api/health
```

可选 [GitHub Actions 工作流](../.github/workflows/deploy.yml)仅保留手动触发（`workflow_dispatch`），push 和合并不会自动部署。日常发布按请求直接通过 SSH 执行，由服务器通过 `git archive` 导出源码并构建。候选镜像在不挂载生产数据或 Docker socket 的容器中进行语法检查；应用忙碌时推迟切换，切换或健康检查失败恢复旧镜像。不使用定时轮询仓库。发布后清理专属构建缓存及本项目无引用旧镜像／发布源码，保留生产、回滚、worker 和容器引用资源。

Docker 构建上下文排除 `test/`；生产镜像只包含服务端和已打包前端，不复制测试目录或仅供测试使用的前端源码。Actions 部署运行 `npm run check` 与健康／版本检查，`npm test` 在开发时单独执行。

**用于其他安装环境前，请调整以下脚本假设：**

- `server-deploy.sh`、`deploy-main.sh`、`deploy-release.sh`、`backup.sh`、`configure-nginx.sh` 只接受 `/home/*/apps/web-codex-server` 路径。
- `server-deploy.sh` 在没有 `.env` 时，会创建绑定原安装环境的 `PUBLIC_URL`。
- `configure-nginx.sh` 与 `deploy/nginx.conf` 包含原域名、证书路径及宿主机 Nginx 假设。
- 工作流远端 `cd` 写死了目录，请换成自己的服务器路径。
- `deploy-main.sh` 拉取本仓库的 `main`；部署 fork 时，改为自己的仓库。
- 服务器脚本需要 Node.js 24+、Git、Bash、curl、flock 与 Docker。先随首次发布安装脚本，再开启工作流。

在仓库 Actions 中设置 Secret：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_HOST` | SSH 主机名或 IP |
| `DEPLOY_USER` | 部署用户 |
| `DEPLOY_SSH_KEY` | 服务器已授权的部署专用私钥 |
| `DEPLOY_KNOWN_HOSTS` | 通过可信渠道独立核对的主机密钥记录 |
| `DEPLOY_PORT` | 可选端口，默认 `22` |

Actions 会等待服务器完成。**候选语法检查、切换、目标 revision 健康检查全部成功，工作流才显示成功。** 构建失败、资源不足、持续忙碌超时、过期请求或健康检查失败都会使工作流失败。日志同时显示在 Actions 和私有 `.deploy-state/request-*.log` 中；`.deploy-state/result-<commit>.json` 记录退出结果。首次手动构建可能显示未知 revision。应用升级会短暂重启网关，浏览器随后重新连接。

### 构建资源保护

自动部署需要 Docker Buildx、启用内存／Swap／IO 控制器的 Linux cgroup v2、`timeout`、`lsblk` 及本机 Docker socket。`scripts/deploy-build.sh` 使用原服务器的 `/dev/vda` 系统盘及专用构建器 `sv-codex-bounded-20261016`；其他服务器需要调整设备路径。BuildKit 镜像按 digest 固定，不改变默认构建器。脚本验证实际 cgroup 限额，限制未生效时退出，没有无上限构建回退。

| 构建约束 | 数值 |
| --- | --- |
| 物理内存／内存加 Swap 总额 | 1024 MiB／3584 MiB |
| CPU／进程数 | 0.75 核／256 |
| 磁盘读／写 | 48 MiB/s／24 MiB/s |
| BuildKit 任务／Monaco Worker 编译 | 均串行 |
| Node old space／semi space | 1536 MiB／8 MiB；Worker 结束后显式 GC |
| 资源准入 | 可用内存至少 768 MiB、空闲 Swap 2560 MiB、两者合计 3328 MiB、空闲磁盘 3.5 GiB |
| 时间预算 | 两个镜像合计构建 20 分钟；构建前和切换前分别最多等待空闲 10 分钟 |

现有 Swap 不足时，脚本只创建 `.deploy-state/build.swap` 临时文件（2 GiB、root 所有、0600）。创建前要求至少 5.5 GiB 空闲磁盘，以保留 3.5 GiB 构建余量。操作通过已有本地 worker 镜像的短命特权 `nsenter` 助手执行，需要 Docker 宿主机管理权限；助手验证确切路径、所有者、大小及文件类型，不改 `fstab`，不操作已有系统 Swap。构建完成或报错时先停止专用构建器，再关闭并删除临时 Swap。主机异常断电可能留下文件，下次通过准入的部署会验证并恢复清理；清理失败则部署失败，并输出需要检查的路径。磁盘准入是时点检查，仍需监控其他服务的占用。

原 2 GiB 主机上已完成的受限 Vite 构建约需七分钟，不能保证未来耗时和容量。Swap 用速度换取缓冲空间；容量不足时保留旧版本，不停止真实用户任务或其他服务。构建期间的专用 BuildKit 自动 GC 目标为最多 2 GiB、保留 512 MiB、磁盘空闲目标 3.5 GiB，这是 GC 目标而非硬磁盘配额。

**每次构建结束后自动清空构建缓存。** worker 与 web 镜像在同一次发布中仍可共享缓存；两者构建完成后、候选语法检查之前，脚本执行 `docker buildx prune --builder sv-codex-bounded-20261016 --all --force`，清理此专用构建器的全部可回收缓存（包括内部／前端缓存），构建失败或中断时也通过退出处理清理残留。清理沿用已经验证的内存、CPU、IO 限额及临时 Swap，最多等待 120 秒，再停止构建器并移除临时 Swap。清理失败／超时会使 Actions 失败，且不切换应用版本；不会为重试清理重新启动已停止的构建器。Actions 日志显示回收结果。后续发布需要重新下载依赖和构建，耗时可能增加。

此操作仅针对上述专用构建器，保留已加载的应用／worker 镜像及回滚版本，不执行全局 Docker 清理，不删除数据卷、用户文件或其他服务缓存。旧发布镜像的增长不属于 BuildKit 缓存，应单独管理。

**已有安装从旧部署脚本升级时**，合并／启用工作流前，先将审查过的新 `scripts/deploy-main.sh` 入口安装到服务器，并私下备份旧文件。入口拉取确切的当前 `main`，用 Git 归档中的新版本部署脚本执行，使本次改造第一次上线就受到保护。其他脚本和配置由 Git 归档带入，禁止上传整个本地目录或本机记忆文件。工作流变更合并前，旧 Actions 仍只确认后台请求提交。

## 本地开发

使用 Node.js 24+。没有生产 `.env` 时，后端默认使用 `http://localhost:3100` 与本地 `./data`。不要将容器使用的 `DATA_DIR=/data` 直接用于宿主机开发。

```bash
npm ci
npm run build
npm start
```

前端热更新时，在本地配置中设置 `PUBLIC_URL=http://localhost:5173`、`COOKIE_SECURE=false`，运行 `npm run dev` 启动后端，再在另一个终端运行 `npx vite`，按该来源地址打开网页。Vite 将 `/api` 和 `/ws` 代理到 3100 端口。

Windows 可以开发账号与文件功能并运行多数测试；真实 worker 需要 Linux Docker。代码变更请运行 `npm run check`、`npm test` 和 `npm run build`；Linux 还有平台专用检查。现有 `scripts/smoke.mjs` 使用临时账号检查 CLI 协议、Shell 和终端链路，不调用模型推理。升级固定 CLI 前，应重新验证协议与完成登录后的工作流。
