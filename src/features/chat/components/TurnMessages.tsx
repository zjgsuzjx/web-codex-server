import ChangeSummary from '../../files/components/ChangeSummary.tsx';
import {
  ChevronDown,
  Copy,
  File,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { memo, useState } from 'react';
import {
  contentImage,
  isProcessItem,
  reasoningText,
  toolContent,
} from '../../../../shared/chat/chat-content.ts';
import type { ChatItem, ProtocolCallback, Turn } from '../../../../shared/contracts/protocol.ts';
import chatgptLogo from '../../../assets/chatgpt-logo.svg';
import IconButton from '../../../components/ui/IconButton.tsx';
import { AttachmentList } from './Attachments.tsx';
import { GeneratedImage, Markdown, ToolOutput } from './ChatOutput.tsx';
export interface MessageProps {
  item: ChatItem;
  onFile: ProtocolCallback;
  notify: (message: string, error?: boolean) => void;
  onAttachment: ProtocolCallback;
  threadId: string;
}
export interface TurnMessagesProps {
  turn: Turn;
  onFile: ProtocolCallback;
  notify: (message: string, error?: boolean) => void;
  onAttachment: ProtocolCallback;
  threadId: string;
  onReview: ProtocolCallback;
}

const Message = memo(function Message({
  item,
  onFile,
  notify,
  onAttachment,
  threadId,
}: MessageProps) {
  const [expanded, setExpanded] = useState(false);
  if (item.type === 'userMessage') {
    const text =
      item.content
        ?.filter((x) => x.type === 'text')
        .map((x) => x.text)
        .join('\n') ||
      item.text ||
      '';
    const long = text.length > 700 || text.split('\n').length > 10;
    return (
      <div className="user-message">
        <div>
          <div className={long && !expanded ? 'user-text is-collapsed' : 'user-text'}>{text}</div>
          {long && (
            <button
              type="button"
              className="expand-message"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起' : '展开全部'}
              <ChevronDown size={13} />
            </button>
          )}
          <AttachmentList items={item.attachments} onPreview={onAttachment} />
        </div>
      </div>
    );
  }
  if (item.type === 'agentMessage')
    return (
      <article className="agent-message">
        <div className="message-avatar">
          <img src={chatgptLogo} alt="ChatGPT" width={29} height={29} />
        </div>
        <div className="message-body">
          <div className="message-author">Codex</div>
          <div className="markdown">
            <Markdown
              text={item.text}
              threadId={threadId}
              onFile={onFile}
              notify={notify}
              onPreview={onAttachment}
            />
          </div>
          {item.text && (
            <div className="message-actions">
              <IconButton
                title="复制消息"
                onClick={() =>
                  navigator.clipboard
                    .writeText(item.text!)
                    .then(() => notify('已复制'))
                    .catch(() => notify('复制失败', true))
                }
              >
                <Copy size={14} />
              </IconButton>
            </div>
          )}
        </div>
      </article>
    );
  if (item.type === 'imageGeneration')
    return <GeneratedImage item={item} onPreview={onAttachment} />;
  if (item.type === 'reasoning') {
    const text = reasoningText(item);
    return text ? (
      <details className="tool-item reasoning">
        <summary>
          <Sparkles size={14} />
          <span>思考过程</span>
          <ChevronDown size={13} />
        </summary>
        <div className="markdown">
          <Markdown
            text={text}
            threadId={threadId}
            onFile={onFile}
            notify={notify}
            onPreview={onAttachment}
          />
        </div>
      </details>
    ) : null;
  }
  if (item.type === 'commandExecution')
    return (
      <details className="tool-item">
        <summary>
          <Terminal size={14} />
          <code>{item.command}</code>
          <span className="tool-status">
            {item.status === 'inProgress'
              ? '执行中'
              : item.exitCode === 0
                ? '完成'
                : item.status === 'declined'
                  ? '已拒绝'
                  : `退出 ${item.exitCode ?? ''}`}
          </span>
        </summary>
        <pre className="terminal-output">{item.aggregatedOutput || '等待命令输出…'}</pre>
      </details>
    );
  if (item.type === 'fileChange')
    return (
      <details className="tool-item file-change" open>
        <summary>
          <File size={14} />
          <span>文件更改</span>
          <span className="tool-status">
            {item.status === 'completed'
              ? '已完成'
              : item.status === 'declined'
                ? '已拒绝'
                : '处理中'}
          </span>
        </summary>
        <div>
          {item.changes?.map((c: any, i: any) => (
            <div key={i}>
              <button onClick={() => onFile(c.path)}>
                <File size={13} />
                {c.path.split('/').slice(-2).join('/')}
              </button>
              <span>{typeof c.kind === 'string' ? c.kind : c.kind?.type}</span>
              {c.diff && (
                <details>
                  <summary>查看差异</summary>
                  <pre className="diff-output">{c.diff}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </details>
    );
  if (item.type === 'plan')
    return (
      <div className="plan-item">
        <Sparkles size={15} />
        <div className="markdown">
          <Markdown
            text={item.text || item.plan || ''}
            threadId={threadId}
            onFile={onFile}
            notify={notify}
            onPreview={onAttachment}
          />
        </div>
      </div>
    );
  if (item.type === 'contextCompaction')
    return (
      <div className="tool-note">
        <RefreshCw size={13} />
        对话上下文已压缩
      </div>
    );
  if (item.type === 'enteredReviewMode' || item.type === 'exitedReviewMode')
    return (
      <div className="tool-note">
        <ShieldCheck size={13} />
        {item.type === 'enteredReviewMode' ? '开始审查' : '审查完成'}
        {item.review && (
          <div className="markdown">
            <Markdown
              text={item.review}
              threadId={threadId}
              onFile={onFile}
              notify={notify}
              onPreview={onAttachment}
            />
          </div>
        )}
      </div>
    );
  if (item.type === 'sleep')
    return (
      <div className="tool-note">
        <LoaderCircle size={13} />
        等待 {Math.ceil((item.durationMs || 0) / 1000)} 秒
      </div>
    );
  if (toolContent(item).some(contentImage))
    return (
      <div className="visible-tool-output">
        <ToolOutput
          item={item}
          threadId={threadId}
          onFile={onFile}
          notify={notify}
          onPreview={onAttachment}
        />
      </div>
    );
  return (
    <details className="tool-item">
      <summary>
        <Sparkles size={14} />
        <span>{item.tool || item.name || item.query || item.type}</span>
        <span className="tool-status">{item.status || ''}</span>
      </summary>
      <ToolOutput
        item={item}
        threadId={threadId}
        onFile={onFile}
        notify={notify}
        onPreview={onAttachment}
      />
    </details>
  );
});
export const TurnMessages = memo(function TurnMessages({
  turn,
  onFile,
  notify,
  onAttachment,
  threadId,
  onReview,
}: TurnMessagesProps) {
  const items = turn.items || [],
    done = turn.status !== 'inProgress';
  const process = isProcessItem;
  const thoughts = items.filter(process);
  const render = (item: ChatItem) => (
    <Message
      key={item.id}
      item={item}
      onFile={onFile}
      notify={notify}
      onAttachment={onAttachment}
      threadId={threadId}
    />
  );
  if (!done)
    return (
      <>
        {items.map(render)}
        <ChangeSummary turn={turn} threadId={threadId} onReview={onReview} />
      </>
    );
  const before = items.filter((item) => item.type === 'userMessage'),
    after = items.filter((item) => item.type !== 'userMessage' && !process(item));
  return (
    <>
      {before.map(render)}
      {thoughts.length > 0 && (
        <details className="thought-group">
          <summary>
            <Sparkles size={14} />
            <span>思考与执行过程</span>
            <small>{thoughts.length} 项记录</small>
            <ChevronDown size={14} />
          </summary>
          <div>{thoughts.map(render)}</div>
        </details>
      )}
      {after.map(render)}
      <ChangeSummary turn={turn} threadId={threadId} onReview={onReview} />
    </>
  );
});
