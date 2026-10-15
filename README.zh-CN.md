[English](README.md) · 简体中文

# Starvalley Codex

### 一台服务器，每个人都有自己的 Codex 开发空间。

为家庭组、朋友和可信小团队打造的自托管 Codex 网页工作区。打开浏览器，选择项目，就能把想法变成代码——共享同一台服务器，每位成员保有独立空间。

[![Apache 2.0 License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-43853d.svg)](package.json)
[![Docker](https://img.shields.io/badge/deployment-Docker-2496ed.svg)](compose.yml)

[快速开始](#快速开始) · [为什么选择-starvalley](#为什么选择-starvalley) · [看看它能做什么](#看看它能做什么) · [工作原理](#工作原理) · [常见问题](#常见问题) · [部署指南](docs/deployment.zh-CN.md)

![Starvalley Codex：对话、个人项目与内置代码编辑器](docs/images/workspace.jpg)

*截图来自本地运行的真实网页界面，使用虚构项目与模拟 Codex 回复。当前界面以中文为主，仓库提供中英文文档。*

---

为家人部署一次，就拥有一个共同的开发入口。有人写家庭待办，有人学习 Python，有人做周末小项目；每个人登录自己的工作区，连接自己的 Codex 账号。项目和对话保存在服务器上，换一台设备、打开浏览器，就能继续。

流式对话、代码编辑、文件传输、终端和差异审阅都在同一个网页里。服务器运行官方 Codex CLI，通过 [App Server 协议](https://learn.chatgpt.com/docs/app-server) 与网页连接。

## 为什么选择 Starvalley

| 你关心的事 | Starvalley 提供的体验 |
| --- | --- |
| 家庭组共用一个开发入口 | 一次部署、一个网址，邀请码注册，每个人独立登录。 |
| 每个人都有私人空间 | 项目、对话、Codex 配置、凭据与历史按成员分开保存。 |
| 打开浏览器就能开发 | 和 Codex 对话，用 Monaco 编辑代码，运行终端命令，审阅修改；成员无需在本机安装 CLI。 |
| 自己掌握服务 | Docker 部署、数据持久化，支持 worker 数量与资源限制、账号角色及用量查看。 |
| 日常使用顺手 | 流式回复、WebSocket 重连、对话历史恢复、深浅主题，以及适配手机的布局。 |

私人空间用于隔离普通成员之间的数据。部署者掌握宿主机，可以访问服务器上保存的数据；具体边界见[隔离与权限](docs/deployment.zh-CN.md#隔离与权限)。

## 快速开始

准备一台安装了 **Docker Engine 与 Docker Compose 的 Linux 服务器**、Git、支持 HTTPS 的域名，以及每位成员自己的 Codex 使用权限。worker 镜像已包含 Codex CLI；只有本地开发或使用可选部署脚本时，宿主机才需要 Node.js 24+。

### 1. 获取源码

```bash
git clone https://github.com/zjgsuzjx/web-codex-server.git
cd web-codex-server
```

### 2. 配置并启动

按[部署指南](docs/deployment.zh-CN.md#首次部署)创建私有 `.env`、准备数据目录，并配置 HTTPS 与 WebSocket 转发。指南使用通用域名和路径，可以部署到你自己的服务器。

配置和目录权限准备好后，构建并启动：

```bash
docker build -f Dockerfile.worker -t starvalley-codex-worker:local .
docker compose build web
docker compose up -d --wait
```

网页容器监听 `127.0.0.1:3100`，通过反向代理提供 HTTPS 访问。

### 3. 组建你的家庭开发组

1. 打开站点，使用私有 `.env` 中的初始邀请码注册。首个账号是超级管理员，请先自己完成注册，再分享访问入口。
2. 在 **设置 → Codex 账号** 中，通过官方设备授权页连接自己的 ChatGPT 账号，或配置自己的 API Key。设备授权需要账号或工作区允许使用，详见 [OpenAI 登录说明](https://learn.chatgpt.com/docs/auth)。
3. 新建项目，开始对话。
4. 在 **设置 → 个人账号** 中，为家人或朋友生成独立的单次邀请码。受邀成员注册后，拥有自己的工作区，并连接自己的账号。

## 看看它能做什么

### 从一个想法，到可以继续编辑的项目

让 Codex 解释代码、实现功能或修复问题。边看流式回复，边按需批准操作；需要澄清时，通过分步问答卡片给出回答。点击文件引用直接打开代码编辑器，按 `Ctrl+S` 保存，也可以在网页终端继续使用 CLI。

对话支持历史恢复、分支与上下文压缩。网页提供模型和推理强度、计划模式、审批选项，以及完整 `config.toml` 高级配置。

### 每轮改了什么，看得清楚

任务显示修改文件数及新增、删除行数。打开右侧审阅面板，查看带修改前后行号的文件补丁，再打开当前文件继续编辑。

![每轮文件变更统计与内置差异审阅面板](docs/images/change-review.jpg)

*统计以任务开始时的项目快照为基准，覆盖 Shell 写入；同一时间的手工编辑也会计入，过大或二进制文件的行数可能显示未知。*

### 把文件带进来，把成果带回去

上传文件、文件夹或 ZIP 到项目。所有上传使用带确认的 WebSocket 二进制分块，同一页面内断线后可恢复，文件夹保留目录结构。单文件按原格式下载，文件夹和整个项目导出为 ZIP。

对话附件与项目文件分开管理。可以附上文档、代码或粘贴截图，在对话中预览支持的图片和文本。模型与账号支持生图时，生成结果也可以预览和下载。

在 **设置 → 个人账号** 中，可上传 JPG、PNG、WebP 图片（最大 5 MB、1600 万像素、单边不超过 8192 像素），拖动和缩放裁剪头像。裁剪后以 256 × 256 PNG 保存到账号，最多 256 KB，也可随时恢复默认头像。登录或刷新时会显示头像、个性化欢迎语和工作区连接状态，并支持减少动画偏好。

### 用手机跟进任务

手机布局保留对话和任务操作，侧栏可收起，支持深浅主题。用量详情展示可获取的 Codex 额度窗口、重置时间、存储与服务器容量；信号柱显示浏览器到服务器的 WebSocket 往返延迟。页面在后台保持连接时，完成任务会在标签页显示角标。

<img src="docs/images/mobile.jpg" alt="手机深色主题中的任务回复与文件变更卡片" width="360">

*所有截图均使用合成演示数据；额度、耗时及回复内容仅用于说明界面。*

## 工作原理

```text
家庭成员 / 朋友
        │ HTTPS + WebSocket
        ▼
  反向代理 → 网页网关 + SQLite
                         │
               ┌─────────┼─────────┐
               ▼         ▼         ▼
             成员 A    成员 B    成员 C
             worker    worker    worker
             项目       项目       项目
             Codex     Codex     Codex
             历史       历史       历史
```

React 前端连接 Node.js 网关。网关检查账号与项目归属，用 SQLite 保存应用状态，并为每位活跃用户管理独立的 Docker worker。worker 运行官方 Codex CLI，只挂载该成员的项目与 Codex 目录；按需创建，闲置后停止，同时活跃数量由部署配置控制。

默认 worker 以 UID 1000 运行，系统根目录只读，移除 Linux capabilities，不挂载 Docker socket，也不进入宿主机命名空间。在默认沙箱配置下，Codex 和终端可以访问**该用户的全部项目及 Codex 目录**。网关拥有 Docker socket 访问权，是需要信任的管理服务。

## 常见问题

**家庭组是不是共用一个 ChatGPT 订阅？**

每位成员连接自己的、有使用权限的 ChatGPT 账号或 API Key。共享服务器不会合并额度，也不会额外授予订阅权限。可用模型与使用限制取决于连接的账号或服务商。

**成员能看到彼此的项目吗？**

应用检查用户、项目、对话与文件归属，普通成员的 worker 只挂载本人目录。目前没有共享项目或多人实时协同编辑。服务器运营者可以访问宿主机数据，适合彼此信任的成员使用。

**可以部署给其他人使用吗？**

可以。使用自己的服务器、域名和邀请码，为可信成员提供服务。保持邀请制注册、配置 HTTPS，并按用户数量调整资源。[部署指南](docs/deployment.zh-CN.md)说明了配置、备份、权限，以及现有部署脚本对安装环境的假设。

**所有 CLI 功能都有网页按钮吗？**

网页覆盖主要开发流程，没有专用按钮的 CLI 功能可以在内置终端使用。兼容的 CLI 版本固定在 [Dockerfile.worker](Dockerfile.worker) 中，升级前应验证协议变化。

**部署前还需要了解什么？**

成员存储上限为 1 GiB，管理员 5 GiB，超级管理员不限量。使用达到 90% 时显示需手动确认的提醒。可让 Codex 按项目清单分析可清理文件，展示大小和用途，勾选确认后再删除；额度不足时仍可手动删除。右侧查看器支持拖动分隔条、Ctrl/Cmd 多选、批量查看大小和删除，以及常见图片格式预览。

应用存储配额约束网页上传和编辑保存，Codex 与终端写入需要宿主机层面的磁盘监控。关闭 worker 网络也会阻断模型/API 连接。可选服务器执行模式具有真实宿主机 root 权限，默认关闭。详见[运行限制](docs/deployment.zh-CN.md#运行限制)。

## 开发与贡献

安装 Node.js 24+ 后：

```bash
npm ci
npm run build
npm start
```

打开 `http://localhost:3100`。Windows 可以开发账号与文件功能，真实 Codex worker 需要 Linux Docker。前端热更新及生产配置见[部署与开发指南](docs/deployment.zh-CN.md#本地开发)。

提交代码变更前，请运行 `npm run check`、`npm test` 和 `npm run build`。Linux 会运行额外的文件系统与部署检查；自动测试和协议 smoke 检查不能替代完成登录后的真实模型对话验收。

欢迎通过 [Issues](https://github.com/zjgsuzjx/web-codex-server/issues) 和 [Pull requests](https://github.com/zjgsuzjx/web-codex-server/pulls) 反馈问题、部署体验或改进文档。请附上复现步骤，并移除凭据和私人项目数据。

## 许可证

[Apache License 2.0](LICENSE)。Starvalley Codex 是独立项目，与 OpenAI 没有隶属或背书关系。Codex、ChatGPT 及 OpenAI Blossom 图形归 OpenAI 所有；第三方工具和服务遵循各自的条款与许可证。
