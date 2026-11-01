import { GitFork, LoaderCircle, RefreshCw, Terminal } from 'lucide-react';
import type { Thread } from '../../../../shared/contracts/domain.ts';
import type { ProtocolCallback, ProtocolRecord } from '../../../../shared/contracts/protocol.ts';
import Tooltip from '../../../components/ui/Tooltip.tsx';
export interface ConversationToolsProps {
  thread: Thread;
  busy: string | null;
  disabledReason?: string;
  onAction: ProtocolCallback;
  onTerminal: ProtocolCallback;
}

export default function ConversationTools({
  thread,
  busy,
  disabledReason,
  onAction,
  onTerminal,
}: ConversationToolsProps) {
  const tools = [
    {
      action: 'fork',
      title: '创建对话分支',
      label: '分支',
      pending: '创建中…',
      icon: GitFork,
      description: '复制当前对话历史，在新的分支中继续探索。原对话会保留。',
    },
    {
      action: 'compact',
      title: '压缩上下文',
      label: '压缩上下文',
      pending: '压缩中…',
      icon: RefreshCw,
      description: '整理并压缩当前上下文，为后续对话腾出空间。',
    },
    {
      action: 'terminal',
      title: '运行终端命令',
      label: '终端命令',
      icon: Terminal,
      description: '在当前执行环境运行 Shell 命令，输出会显示在此对话中。',
    },
  ];
  return (
    <div className="conversation-tools" role="group" aria-label="对话工具">
      {tools.map((tool) => {
        const pending = busy === tool.action,
          disabled = !!disabledReason || !!busy;
        return (
          <Tooltip
            key={tool.action}
            title={tool.title}
            description={disabledReason || (busy ? '正在处理对话操作，请稍候。' : tool.description)}
            disabled={disabled}
          >
            <button
              type="button"
              className={`conversation-tool ${pending ? 'is-busy' : ''}`}
              aria-label={tool.title}
              aria-busy={pending}
              disabled={disabled}
              onClick={() => (tool.action === 'terminal' ? onTerminal() : onAction(tool.action))}
            >
              {pending ? <LoaderCircle size={14} className="spin" /> : <tool.icon size={14} />}
              <span className="conversation-tool-label">{pending ? tool.pending : tool.label}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
