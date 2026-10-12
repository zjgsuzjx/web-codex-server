# Starvalley Codex

自托管的 Codex 网页工作区。React + Vite 前端，Node.js 24 + Express + SQLite 后端，Docker 为每个用户提供独立的 Codex CLI 容器。

## 功能

- 邀请码注册、密码登录、退出、修改密码；首个注册用户为超级管理员，其余注册账号为成员。
- 按用户名创建目录，项目和对话归属校验；每个用户有独立的 Codex 配置、凭据和历史记录。
- 流式聊天、历史恢复、停止任务、批准命令和文件修改、回答 Codex 问题、对话分支和上下文压缩。
- 对话附件与项目文件独立：聊天框可选择、拖入文件或粘贴截图，发送前可删除，发送后可在消息中预览图片与 2 MB 以内的 UTF-8 文本；每轮最多 10 个附件，每个最多 20 MB，同时受用户存储配额限制。
- 发送时图片使用 CLI 的原生图片输入；代码和 UTF-8／带 BOM 的 UTF-16 文本附件正文明确加入模型输入，每个最多内联 128 KiB、每轮共 256 KiB。超限会标记截断并提供完整文件路径，非文本文件提供路径及读取／解析提示，不使用应用 mention 冒充文件内容。网页及历史只显示原始提问与附件，模型输入中的附件正文不会重复显示在用户气泡内。
- Codex 生图结果直接显示在对话中，支持预览、下载和历史恢复；生成失败、额度不足和图片缺失会显示反馈。图片由已登录用户的对话归属校验接口提供；保存路径和 Markdown 图片仅可读取当前项目或本人 Codex `generated_images` 目录，最大 32 MB。工具返回的图片也保持可见。
- 思考摘要和正文保留分段；MCP、动态工具、函数输出和工具错误可查看。未识别的消息类型保留可展开的原始记录，避免静默丢失信息。
- 长用户消息默认折叠；回答完成后思考、进度和工具记录收拢为一行，点击可以展开。流式消息与完成通知按消息 ID 合并，防止不完整快照覆盖用户消息。
- 首轮回答后自动生成对话标题，手工重命名优先。优先使用 CLI 标题事件，否则通过独立的临时 Codex 摘要请求生成；摘要请求会使用账号额度，不进入聊天正文。
- 进入或开始对话后，聊天工具栏在额度与容量按钮旁显示上下文圆环；悬浮或键盘聚焦可查看最近一次请求的 token 使用量、模型上限及比例。未提供的统计保持未知，统计随对话保存，刷新或切换后可恢复。
- 超级管理员可在设置 → 个人账号生成、撤销单次邀请码，查看备注、有效期和实际注册用户；完整邀请码只在生成时返回，数据库只保存哈希。原部署环境的邀请码仍作为兼容入口保留。
- 模型、推理强度、审批策略、容器网络访问、计划模式和完整 config.toml 配置。
- 文件树、Monaco 编辑器、代码高亮、Ctrl+S 保存、文件冲突检测、新建、重命名和删除。
- **所有文件上传均通过 WebSocket 二进制数据块**，每块最大 1 MiB，每块确认后再发送下一块；保留目录结构，支持同一页面内断线续传。未完成上传 30 分钟后过期，服务重启后需重新上传。
- 项目文件、文件夹和整个项目统一打包 ZIP 下载。文件夹上传先在浏览器压成 ZIP，通过同一 WebSocket 二进制通道发送；也可选择 ZIP 直接上传解压。浏览器压缩支持 128 MB 以内的文件夹，更大文件夹请先在本机压缩。服务器验证 ZIP 路径、符号链接、CRC、解压大小和文件数，拒绝覆盖已有文件；拒绝非法归档时不写入项目文件。Linux 使用目录文件描述符防止并发替换父目录造成越界访问。
- 全站本地托管 Inter 可变字体，中文使用系统字体回退，代码与终端保持等宽字体。
- 网页交互终端，可直接使用完整 `codex` 命令和 CLI 界面；用户工作区在独立容器内执行，超级管理员可显式切换至服务器 root 模式。
- 深浅主题、手机布局、上传进度、账号使用额度、管理员用户列表和操作记录。
- 默认蓝白界面；聊天框旁选择命令审批和文件访问权限。
- 统一蓝白下拉组件，支持方向键、Home/End、Enter、Escape、键入匹配和禁用选项，菜单自动适配屏幕位置。静态页面文字不显示插入光标，输入框、代码编辑器和终端保留编辑光标；对话搜索框有独立内边距和聚焦状态。
- 聊天框上方显示 Codex 剩余额度与服务器磁盘可用空间；点击查看各额度窗口、重置时间、余额、项目配额和服务器可用内存。额度使用 CLI 的 `account/rateLimits/read`，优先读取多额度桶，缺失数据不会显示成 0 或 100%；支持稀疏推送更新及每分钟刷新，隐藏页面暂停轮询。API Key / 自定义服务商没有相同的 ChatGPT 配额接口时会明确提示。
- 流式片段每 50ms 合并，历史消息和编辑器避免无关重渲染，文件树按父目录索引；哈希静态资源缓存一年，Nginx 压缩 `text/javascript`。权限变更用于下一轮对话。

## 服务器部署

### 角色与执行环境

成员和管理员的 Codex 使用 UID 1000 的非特权容器，仅挂载该用户的项目和 Codex 配置；系统根目录只读，无宿主机 PID/网络命名空间、根目录挂载或 Docker socket。聊天框选择“自动执行”不会提高账号角色或突破这层边界。

超级管理员在聊天框的执行权限菜单中选择“服务器 · root 权限”后，使用专门的特权执行容器，通过 `nsenter` 进入真实宿主机命名空间和根目录，以 root 运行服务器的 Codex CLI。此模式可以修改服务器系统文件、服务和其他用户数据，具有与服务器 root 相同的实际权限。默认仍是隔离的用户工作区；需部署方配置 `ENABLE_HOST_EXECUTION=true`、`HOST_CODEX_SCRIPT` 和 `HOST_CODEX_BIN`，并在宿主机安装兼容版本的 Codex CLI。服务器模式使用宿主机网络，网络隔离需切回工作区。

在 **设置 → 个人账号 → 账号角色** 中，只有超级管理员可修改角色。系统保留至少一名超级管理员；角色变更立即注销目标账号的登录会话，关闭终端并销毁旧执行容器，执行环境重置为用户工作区。首次升级仅将原安装的第一名管理员迁移为超级管理员，迁移不会重复执行或升级其他管理员。高级配置、API 参数和客户端显示均不能替代服务器端角色校验。操作记录保存角色变化及服务器/工作区执行事件，不保存命令正文或凭据。

服务器模式会产生 root 所有的 CLI 状态和项目文件；切换或降级时使用仅挂载该用户 Codex 及项目目录的受限助手修复所有权，不跟随符号链接，不将宿主机执行权限交给普通管理员。

目前部署目录：`/home/zhuzi/apps/web-codex-server`，访问域名：`https://codex.starvalley.fun`。

构建在服务器进行；GitHub Actions 只通过 SSH 触发部署。部署需要 Docker / Compose；现有系统 Nginx 提供 HTTPS 和 WebSocket 代理，Docker API 只绑定服务器回环地址。

```bash
cd /home/zhuzi/apps/web-codex-server
# 首次部署创建随机邀请码，不会覆盖已有 .env。
bash scripts/server-deploy.sh
bash scripts/configure-nginx.sh

# 查看邀请码，仅在自己的 SSH 终端中执行。
sed -n 's/^INVITE_CODE=//p' .env
```

首先在网页注册自己的账号，然后打开 **设置 → Codex 账号 → 使用 ChatGPT 账号登录**。复制网页显示的一次性验证码，打开官方授权页并输入，完成后网页自动刷新账号状态。此流程使用 CLI 的 `chatgptDeviceCode` 登录，凭据由 CLI 保存和刷新，不需要服务器 SSH 回调。账号或组织须允许设备码授权；授权信息只返回当前登录用户，不写入日志或数据库。

如果账号不允许设备码登录或需通过终端排查，仍可通过 SSH 执行：

```bash
cd /home/zhuzi/apps/web-codex-server
bash scripts/login-user.sh 你的网页用户名
```

按终端提示用自己的 ChatGPT 账号完成设备登录，再刷新网页账号状态。脚本会重启该用户的容器以加载新凭据，请先停止该用户运行中的任务。用户凭据在 `data/users/<username>/codex/auth.json`，不会共享给其他用户，也不会写入代码仓库或容器镜像。

也可以通过网页配置独立 API Key。自定义服务商、MCP、功能开关、配置档案等可在高级配置编辑。CLI 功能若没有专门按钮，可以在网页终端使用。网页使用官方 CLI 管理的设备授权流程；ChatGPT 密码在官方页面输入。协议参考：[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。

### 数据和配置

```text
data/
  app.sqlite                  # 用户、登录会话、项目/对话归属和操作记录
  users/<username>/
    projects/<project-uuid>/  # 项目文件
    codex/                   # config.toml、auth.json 和 Codex 会话历史
      chat-attachments/      # 对话附件，通过独立附件 API 查看，不进入项目文件树
  uploads/<user-uuid>/        # 上传临时数据，用户容器不可访问
```

`HOST_DATA_DIR` 必须是服务器上 `data/` 的绝对路径，因为 Docker worker 绑定挂载使用主机路径。`DOCKER_GID` 是 Docker socket 的组 ID。完整选项见 `.env.example`。

附件在数据库关联用户、对话和消息轮次；图片传入 `localImage`，其他文件传入 CLI 的 `mention` 文件引用，由 Codex 按文件格式读取。草稿附件 24 小时未发送后清理；已发送附件随历史保留，分支对话可以继续预览引用的原附件。API 只允许访问本人附件，项目上传与附件上传共用大小和存储配额检查。自动解压目前支持 ZIP，其他压缩格式可作为普通项目文件或对话附件上传。

用户工作区 worker 用 UID 1000 运行，只挂载该用户的项目和 Codex 配置目录；没有 Docker socket、主机网络或 Linux capabilities，根文件系统只读。Web 后端使用 Docker socket 创建用户容器，因此属于可信管理服务，不能把 socket 暴露给普通用户容器。文件编辑和上传 API 对所有角色都校验项目归属；超级管理员在服务器模式下可通过 Codex 和终端操作宿主机文件。

这台服务器的内核不支持在当前非特权容器中运行 Codex 的 bubblewrap 内层文件沙箱。因此默认由 Docker 提供用户隔离，App Server 使用 `externalSandbox`，CLI 配置为容器内完全访问。Codex 和终端可以操作**该用户所有项目**及其配置目录；当前项目写入/只读模式在网页中禁用。没有通过增加特权或全局关闭主机安全规则解决兼容问题。以后更换支持内层沙箱的主机并完成验证后，可设置 `ENABLE_NESTED_SANDBOX=true` 启用相关选项。

关闭网络会重建该用户的容器，Docker `NetworkMode=none` 阻止外部联网，项目和登录数据保留。这也会阻止连接模型/API 服务，适用于离线终端。切换前必须停止任务并关闭终端。高级配置里启用内层沙箱可能导致这台服务器工具执行失败，请保留默认容器执行方式。

默认同时最多两个活动 worker，每个 worker 内存 384 MiB、0.75 CPU，闲置且没有连接或任务时 15 分钟后停止。上传及网页编辑受文件大小与用户存储配额控制；**终端和 Codex 写入不受应用层存储配额约束**，共享主机应监控磁盘或在扩容后使用带磁盘配额的文件系统。每用户最多 50 个项目。部署脚本不会删除现有数据库、卷或其他站点。

### 维护

```bash
docker compose ps
docker compose logs --tail 100 web
docker compose exec -T web npm test
docker compose exec -T -e SMOKE_BASE=https://codex.starvalley.fun web node scripts/smoke.mjs
bash scripts/check-sandbox.sh
bash scripts/backup.sh
```

备份会暂停本应用和用户 worker，生成包含数据库、项目、历史和凭据的私有归档，然后恢复应用。请妥善保存备份。服务器当前内存和磁盘较小，构建需要约 1.5 GiB Node heap 和可用 swap；构建缓存可以按需回收，**不要使用 `docker volume prune` 清理应用数据**。

### 合并 main 后自动部署（服务器构建）

`.github/workflows/deploy.yml` 在 `main` 推送（包括 PR 合并）时通过 SSH 发出部署请求，也支持在 Actions 页面选择 `main` 手动运行。服务器没有定时检查仓库的任务。runner 不下载源码、不构建镜像、不保存产物，SSH 请求成功后立即退出，构建时间不会变成 runner 等待时间。

先把 `scripts/deploy-main.sh` 和 `scripts/deploy-release.sh` 随首次部署安装到服务器 `/home/zhuzi/apps/web-codex-server`，再在仓库 **Settings → Secrets and variables → Actions** 添加这些 Repository secrets：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_HOST` | 服务器 SSH 地址 |
| `DEPLOY_USER` | 部署用户，此安装为 `zhuzi` |
| `DEPLOY_SSH_KEY` | 已获服务器授权的部署专用 SSH 私钥 |
| `DEPLOY_KNOWN_HOSTS` | 通过可信渠道核对的服务器 `known_hosts` 记录；工作流严格验证主机密钥 |
| `DEPLOY_PORT` | 可选 SSH 端口，默认 `22`；非默认端口的主机记录使用 `[地址]:端口` |

私钥只放在 GitHub Secret，不能提交或写入 README / 本地记忆。服务器需安装 Git、Docker / Compose、Node.js、curl、flock、rsync 和 timeout，并能访问公开仓库。此工作流只在 `main` 使用部署密钥，不为 PR 分支部署。

服务器串行处理请求，只接收当前 `main` 的确切提交，跳过过期请求和已部署提交，通过 `git archive` 导出独立的构建目录。Docker 在服务器编译前端；候选镜像先在没有生产目录及 Docker socket 的隔离容器中运行检查和测试，通过后才更新应用并验证健康与提交号。切换或健康验证失败会恢复上一镜像。worker 镜像仅在其 Dockerfile 改变时构建。

应用正在执行对话、终端命令、审批或上传时会推迟切换；只在这次请求中有限等待，约十分钟仍忙碌就退出，之后可手动重跑工作流。切换前会再次检查。应用更新仍需短暂重启，网页会重新连接。数据和配置保留；旧源码中已删除的文件不会由同步程序删除，但镜像始终从独立的当前提交构建。仅合并可信代码，因为合并到 `main` 的 Dockerfile 和部署脚本会在服务器执行。

**Actions 成功表示 SSH 请求已提交，不表示后台部署已完成。** 每次请求的日志路径显示在工作流输出中；最终以日志成功信息及健康检查的 `revision` 为准：

```bash
tail -n 80 .deploy-state/request-<提交号>-<时间>-<进程号>.log
cat .deploy-state/deployed-commit
curl -fsS http://127.0.0.1:3100/api/health
```

`.deploy-state/` 和 `.deploy-releases/` 只用于服务器运行，已排除出 Git 和 Docker 构建上下文。`.env`、`data/`、本地 `AGENTS.md` / `MEMORY.md` 不进入发布归档和镜像。部署不会清理其他服务、镜像或数据卷。如果以前安装过轮询方案，只移除 crontab 中以 `# starvalley-codex-auto-deploy` 结尾的那一行，保留其他任务。停用此方案时禁用 Actions 中的部署工作流即可。

### 本地开发

```bash
npm ci
npm run build
# Windows 可先测试账号、项目和文件功能；真实 Codex worker 需要 Linux Docker socket。
npm start
```

默认本地来源 `http://localhost:3100`。设置 `INVITE_CODE` 可启用邀请码。生产必须设置 `COOKIE_SECURE=true`、HTTPS `PUBLIC_URL` 和随机邀请码。热更新前端可运行 `npx vite`，同时将 `PUBLIC_URL` 设置为实际开发页面来源；API 仍监听 3100。

## 验证边界

自动测试覆盖登录/邀请码、CSRF、来源检查、跨用户访问、文件操作、并发上传配额、二进制 WS 上传、续传、保存冲突、ZIP 下载和协议参数。Linux 额外测试父目录替换竞态。真实服务器 smoke test 验证 Codex App Server 握手、模型列表、线程、shell 流式事件、历史和交互终端，使用临时账号并自动清理，不调用模型推理。模型对话需要完成自己的 Codex 登录后验收。

使用官方 [Codex App Server 协议](https://learn.chatgpt.com/docs/app-server)，部署固定 CLI `0.162.1`；升级 CLI 时应重新生成协议并执行测试。
