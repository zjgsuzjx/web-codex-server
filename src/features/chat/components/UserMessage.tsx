import { ChevronDown, Copy, LoaderCircle, Pencil } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { userMessageText, userMessageTime } from '../../../../shared/chat/user-message.ts';
import type { ChatItem, Turn } from '../../../../shared/contracts/protocol.ts';
import IconButton from '../../../components/ui/IconButton.tsx';
import { AttachmentList } from './Attachments.tsx';

export interface UserMessageProps {
  item: ChatItem;
  turn: Turn;
  latestTurnId?: string;
  editDisabled?: boolean;
  onEditStart?: () => void;
  onEdit?: (
    turnId: string,
    itemId: string,
    text: string,
    expectedLastTurnId: string,
  ) => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  onAttachment: (...args: any[]) => any;
}

export default function UserMessage({
  item,
  turn,
  latestTurnId,
  editDisabled,
  onEditStart,
  onEdit,
  notify,
  onAttachment,
}: UserMessageProps) {
  const text = userMessageText(item);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [pending, setPending] = useState(false);
  const expectedLast = useRef('');
  const editButton = useRef<HTMLButtonElement>(null);
  const editHintId = useId();
  const long = text.length > 700 || text.split('\n').length > 10;
  const timestamp = userMessageTime(item, turn);
  const done = turn.status !== 'inProgress';
  const cancel = () => {
    setEditing(false);
    setDraft(text);
    editButton.current?.focus();
  };
  async function submit() {
    if (pending || editDisabled || !onEdit || (!draft.trim() && !item.attachments?.length)) return;
    setPending(true);
    try {
      await onEdit(turn.id, item.id, draft, expectedLast.current);
      setEditing(false);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={`user-message${editing ? ' is-editing' : ''}`}>
      <div className="user-message-content">
        {editing ? (
          <div className="user-message-bubble">
            <textarea
              aria-label="编辑消息内容"
              aria-describedby={editHintId}
              className="user-message-editor"
              autoFocus
              value={draft}
              maxLength={100000}
              disabled={pending}
              onFocus={(event) => {
                const node = event.currentTarget;
                node.style.height = 'auto';
                node.style.height = `${Math.min(node.scrollHeight, 420)}px`;
                requestAnimationFrame(() => node.scrollIntoView({ block: 'nearest' }));
              }}
              onChange={(event) => {
                setDraft(event.target.value);
                event.target.style.height = 'auto';
                event.target.style.height = `${Math.min(event.target.scrollHeight, 420)}px`;
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Escape' && !pending) {
                  event.preventDefault();
                  cancel();
                }
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <AttachmentList items={item.attachments} onPreview={onAttachment} />
            <p className="user-edit-hint" id={editHintId}>
              发送后将从此处重新开始，替换本轮及后续对话。已修改的项目文件不会撤销。
            </p>
            <div className="user-edit-actions">
              <button type="button" disabled={pending} onClick={cancel}>
                取消
              </button>
              <button
                type="button"
                className="user-edit-send"
                disabled={pending || editDisabled || (!draft.trim() && !item.attachments?.length)}
                onClick={() => void submit()}
              >
                {pending && <LoaderCircle size={14} className="spin" />}发送
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="user-message-bubble">
              <div className={long && !expanded ? 'user-text is-collapsed' : 'user-text'}>
                {text}
              </div>
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
            {done && (
              <div className="user-message-footer">
                {timestamp ? (
                  <time
                    dateTime={new Date(timestamp).toISOString()}
                    title={new Date(timestamp).toLocaleString('zh-CN', { hour12: false })}
                  >
                    {new Date(timestamp).toLocaleString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </time>
                ) : (
                  <span className="user-time-unknown" title="此历史消息未记录发送时间">
                    时间未记录
                  </span>
                )}
                <IconButton
                  title="复制用户消息"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(text)
                      .then(() => notify('已复制'))
                      .catch(() => notify('复制失败', true))
                  }
                >
                  <Copy size={14} />
                </IconButton>
                {onEdit && (
                  <IconButton
                    title="编辑消息"
                    buttonRef={editButton}
                    disabled={editDisabled}
                    onClick={() => {
                      onEditStart?.();
                      expectedLast.current = latestTurnId || '';
                      setDraft(text);
                      setEditing(true);
                    }}
                  >
                    <Pencil size={14} />
                  </IconButton>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
