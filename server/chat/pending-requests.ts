import { isUserInput } from '../../shared/chat/user-input.ts';
import type {
  CodexEvent,
  ProtocolCallback,
  ProtocolRecord,
  ServerRequest,
} from '../../shared/contracts/protocol.ts';
import { fail } from '../files/files.ts';

export function validateAnswers(
  request: ServerRequest,
  result: { answers?: Record<string, { answers: string[] }> },
  requireAll = false,
) {
  const answers = result?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) fail(400, '回答格式无效');
  const questions = request!.params.questions || [];
  for (const [key, value] of Object.entries(answers!)) {
    const question = questions.find((q) => q.id === key);
    if (
      !question ||
      !Array.isArray(value?.answers) ||
      value.answers.length > 1 ||
      value.answers.some((v: any) => typeof v !== 'string' || v.length > 20000)
    )
      fail(400, '回答格式无效');
    if (
      question!.options?.length &&
      !question!.isOther &&
      value.answers.some((v: any) => !question!.options!.some((o) => o.label === v))
    )
      fail(400, '请选择提供的答案');
  }
  if (requireAll && questions.some((q) => !answers[q.id]?.answers?.[0]?.trim()))
    fail(400, '请回答全部问题后提交');
}

// One server clock and one reply for all browser tabs, including disconnected clients.
export class PendingRequests {
  declare requests: Map<string, ServerRequest & { receivedAt: number; expiresAt: number | null }>;
  declare timers: Map<string, ReturnType<typeof setTimeout>>;
  declare sendReply: ProtocolCallback;
  declare resolved: ProtocolCallback;
  constructor(sendReply: ProtocolCallback, resolved: ProtocolCallback) {
    this.requests = new Map();
    this.timers = new Map();
    this.sendReply = sendReply;
    this.resolved = resolved;
  }
  add(message: ServerRequest) {
    const key = String(message!.id);
    if (this.requests.has(key)) return this.requests.get(key);
    const receivedAt = Date.now(),
      ms = message!.params?.autoResolutionMs;
    const expiresAt =
      isUserInput(message) && Number.isSafeInteger(ms) && ms >= 0 ? receivedAt + ms : null;
    const request = { ...message, receivedAt, expiresAt };
    this.requests.set(key, request);
    if (expiresAt !== null) {
      const check = () => {
        const left = expiresAt - Date.now();
        if (left > 0) this.timers.set(key, setTimeout(check, Math.min(left, 2147483647)));
        else if (this.requests.has(key)) this.reply(message!.id, { answers: {} }, 'timeout');
      };
      this.timers.set(key, setTimeout(check, Math.min(ms, 2147483647)));
    }
    return request;
  }
  remove(id: string | number) {
    const key = String(id),
      request = this.requests.get(key);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.requests.delete(key);
    return request;
  }
  reply(id: any, result: ProtocolRecord, reason = 'answered') {
    const request = this.requests.get(String(id));
    if (!request) fail(404, '该请求已失效');
    if (reason !== 'timeout' && request!.expiresAt !== null && Date.now() >= request!.expiresAt) {
      this.reply(id, { answers: {} }, 'timeout');
      fail(409, '回答时间已结束');
    }
    if (isUserInput(request)) validateAnswers(request, result);
    this.sendReply({ id: request!.id, result });
    this.remove(id);
    this.resolved({ threadId: request!.params?.threadId, requestId: request!.id, reason });
  }
  clearThread(threadId: string | undefined, turnId: string) {
    for (const request of this.requests.values())
      if (
        request.params?.threadId === threadId &&
        (!turnId || !request.params.turnId || request.params.turnId === turnId)
      ) {
        this.remove(request.id);
        this.resolved({ threadId, requestId: request.id, reason: 'cancelled' });
      }
  }
  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.requests.clear();
  }
}
