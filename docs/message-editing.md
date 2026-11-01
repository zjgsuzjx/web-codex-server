# Editing sent messages / 编辑已发送消息

After a turn ends, hovering a user message reveals its send time, Copy, and Edit below the pale blue bubble. Keyboard focus also reveals these controls; touch devices show them without requiring hover. The controls reserve space so revealing them does not move the conversation. Edit opens a textarea inside the original bubble. Cancel (or Escape) discards the draft; Send (or Ctrl/Cmd+Enter) replaces that turn and every later turn and starts a new response. Existing attachments are included again. A running conversation cannot be edited. Turns containing multiple user inputs cannot currently be edited individually.

每轮结束后，鼠标悬停用户消息时，在淡蓝色气泡下方显示发送时间、复制和编辑按钮；键盘聚焦时也会显示，触屏设备无需悬停即可操作。操作行预留空间，显隐不会推动对话内容。编辑在原气泡内进行；取消或 Escape 放弃修改，发送或 Ctrl/Cmd+Enter 会替换本轮及后续记录并重新回答，原附件会保留。运行中的对话不可编辑；一轮中包含多条用户输入时，暂不支持单独编辑其中一条。

This uses native Codex app-server `thread/revert`, followed by `turn/start`. The project's pinned CLI 0.162.1 supports this protocol. It changes model context and saved conversation history, **without reverting project files or commands already executed**. See the [official app-server documentation](https://learn.chatgpt.com/docs/app-server#revert-thread-history). Legacy non-paginated history may be rejected by the CLI; no transcript files are rewritten by the web server.

实现使用原生 Codex app-server 的 `thread/revert` 和 `turn/start`，已核实项目固定 CLI 0.162.1 支持。它会改变模型上下文及持久化对话历史，**不会撤销已执行的命令或项目文件修改**。不兼容的旧版非分页历史可能被 CLI 拒绝；网页服务不会直接改写 CLI 会话文件。

The gateway verifies ownership, the latest turn ID, the exact message, attachments, settings and account before reverting. Other connected pages receive a history reset and cancel outstanding history loads. Original forks retain their history and attachment references. If revert succeeds but starting the replacement fails, text and attachments are saved as a recoverable composer draft, available when reopening the conversation. These two native RPCs are not one atomic transaction.

服务端先检查归属、最新轮 ID、原消息、附件、设置和账号，再回退；其他已连接页面同步重置记录并取消旧历史请求。已有分支保留各自记录和附件引用。若回退成功而重新发送失败，文字和附件会保存为可恢复草稿，重新打开对话后仍可重试。这两个原生 RPC 并非一个原子事务。

New messages persist a send timestamp. Older messages use the CLI's turn start time, or the gateway's observed turn start when available. Missing historic times are labeled as unrecorded rather than estimated. Display uses the browser's local timezone.

新消息持久化发送时间；旧消息优先使用 CLI 轮次开始时间，缺少时使用网关曾记录的开始时间。无法确定的旧时间显示“时间未记录”，不估算。时间按浏览器本地时区显示。
