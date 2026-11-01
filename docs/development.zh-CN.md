# 开发与工程约定

[English](development.md) · [项目说明](../README.zh-CN.md)

应用代码使用 TypeScript/TSX，保留 React、Vite、Node 24、Express 和 SQLite。浏览器由 Vite 构建；后端使用 Node 自带的类型擦除运行 `.ts`，运行镜像不需要 TypeScript 编译器或 TS 启动器。

## 目录与依赖方向

```text
src/
  main.tsx                  # 挂载 React，导入全局样式
  app/                      # 会话入口与工作区协调
  components/ui/            # 弹窗、菜单、下拉框、提示等公共交互
  components/brand/         # 品牌图形
  features/
    auth/                   # 网站登录与 Codex 登录
    appearance/             # 头像、壁纸、主题与图形状态
    chat/                   # 消息、Markdown、模型、审批与问答
    files/                  # 文件树、编辑器、差异、上传与搜索
    resources/              # 存储与额度
    settings/               # 设置、用户与邀请管理
    terminal/               # 按需加载的终端
    workspace/              # 工具栏、侧栏与连接状态
  hooks/                    # 通用交互钩子
  lib/                      # HTTP、WebSocket 与字体适配
  styles/                   # 全局样式与设计变量
  types/                    # 浏览器环境和 DOM 边界类型
server/
  index.ts                  # 监听端口、关闭生命周期
  app.ts                    # 可注入依赖的应用工厂与 HTTP/WS 协调
  appearance/ chat/ codex/ db/ files/ resources/
shared/
  contracts/                # 领域、接口、协议及错误类型
  chat/ files/ platform/ resources/ settings/
test/                       # 行为回归与类型契约测试
scripts/                    # 开发检查与运维入口
```

- `shared` 不依赖浏览器或服务器应用层；`server` 不导入 `src`；公共 UI 不导入业务 feature。`check:architecture` 检查这些边界、显式相对导入及应用语言约定。
- 业务组件放在对应 `features/<名称>/components`，纯逻辑放在该 feature 的 `lib`。新增可复用组件确认无业务依赖后再移入公共 UI。
- React 组件使用 PascalCase `.tsx`；钩子以 `use` 开头；纯模块使用 `.ts`。相对模块导入包含真实扩展名，保持 Node、测试与 Vite 使用同一套解析规则。
- 使用 `import type`；Node/shared 模块只采用可擦除的 TS 语法，不使用需要额外转译的 enum、参数属性或运行时 namespace。
- 应用自有用户、权限、设置、文件、标签、会话和组件参数使用明确类型。CLI/工具返回的扩展 JSON 及动态 SQL 行保留显式适配边界；`ProtocolRecord` 不是运行时校验，也不代表这些边界已经穷尽建模。新增业务逻辑优先定义具体 DTO，通过校验后再使用。
- 保留现有鉴权、角色撤销、配额、路径保护、二进制 WS 上传、断线恢复和滚动行为。调整目录或类型时不顺带改变协议、数据库结构或部署权限。

## 开发与验证

要求 Node 24 和 npm。先执行 `npm ci`。部分归档测试需要 libarchive 的 `bsdtar`/`bsdcat`；Linux 专用隔离与部署用例在 Windows 上跳过。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | Node 监视后端及其依赖 |
| `npm run dev:web` | Vite 前端开发服务器 |
| `npm run typecheck` | 应用严格类型检查，不输出文件 |
| `npm run check:architecture` | 目录依赖和模块约定 |
| `npm run check:runtime` | 使用 Node 自带类型擦除与语法检查，不需要开发依赖 |
| `npm run check` | 类型、架构和运行时检查 |
| `npm run test:types` | 正向与预期失败的类型契约测试 |
| `npm test` | HTTP、WS、存储、权限、协议和纯逻辑回归 |
| `npm run build` | 正式前端构建 |
| `npm run format` / `npm run format:check` | 统一格式 / 检查格式 |
| `npm run validate` | 格式、检查、类型契约、行为测试和构建 |

前后端开发服务器分两个终端运行。Vite 将 `/api` 与 `/ws` 转发到 `127.0.0.1:3100`；后端 `PUBLIC_URL` 必须与浏览器使用的 Vite 来源一致，例如 `http://127.0.0.1:5173`，否则来源校验会拒绝请求。使用独立开发数据目录，不指向生产数据库。也可以先构建，再用 `npm start` 从同一个后端端口访问静态产物。

提交前执行 `npm run validate`，根据变更手动验证桌面/窄屏、浅色/深色、键盘/触控及新增懒加载模块。格式化不是功能测试，类型检查也不能替代真实 HTTP/WS 和浏览器验收。

## 构建与发布

PR 的 Quality checks 工作流执行开发验证，无发布权限。原部署工作流仍只允许手动触发。

Docker 构建阶段执行类型检查并构建前端，然后移除开发依赖。候选运行镜像只执行 `npm run check:runtime`，不执行 `npm test`，也不包含 `test/`、前端源码或 TypeScript 编译器。Node 24 的原生类型擦除 API 可能输出实验性提示；发布仍须通过真实启动、健康和 revision 检查。保留原有构建资源限制、回滚及专属缓存清理流程。
