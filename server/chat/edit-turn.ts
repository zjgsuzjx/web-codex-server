import type { ProtocolRecord, Turn } from '../../shared/contracts/protocol.ts';
import { fail } from '../files/files.ts';

// Resolve against authoritative CLI history, never the browser's visible slice.
export async function editableTurn(
  call: (method: string, params: ProtocolRecord) => Promise<ProtocolRecord>,
  threadId: string,
  params: ProtocolRecord,
): Promise<Turn> {
  for (const key of ['turnId', 'itemId', 'expectedLastTurnId'])
    if (typeof params[key] !== 'string' || !params[key] || params[key].length > 200)
      fail(400, '编辑消息参数无效');
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await call('thread/turns/list', {
      threadId,
      limit: 32,
      sortDirection: 'desc',
      itemsView: 'full',
      ...(cursor ? { cursor } : {}),
    });
    if (!cursor && page.data[0]?.id !== params.expectedLastTurnId)
      fail(409, '对话已更新，请重新打开对话后再编辑');
    if (page.data.some((turn: Turn) => turn.status === 'inProgress'))
      fail(409, '请等待当前回复结束后再编辑');
    const turn = page.data.find((turn: Turn) => turn.id === params.turnId);
    if (turn) {
      const messages =
        turn.items?.filter((item: ProtocolRecord) => item.type === 'userMessage') || [];
      if (messages.length !== 1 || messages[0].id !== params.itemId)
        fail(409, '此轮含多条用户输入或消息已变化，暂不支持编辑');
      return turn;
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) fail(502, '历史记录分页未前进，请重试');
    if (cursor) seen.add(cursor);
  } while (cursor);
  fail(404, '原消息已不存在，请重新打开对话');
}
