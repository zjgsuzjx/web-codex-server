import type { ChatItem, Turn } from '../contracts/protocol.ts';

export const userMessageText = (item: ChatItem) =>
  item.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n') ||
  item.text ||
  '';

export function userMessageTime(item: ChatItem, turn: Turn): number | null {
  // Gateway metadata is milliseconds; native CLI timestamps are seconds.
  const value =
    item.sentAt ?? (turn.startedAt == null ? turn.timing?.startedAt : turn.startedAt * 1000);
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
    ? value
    : null;
}
