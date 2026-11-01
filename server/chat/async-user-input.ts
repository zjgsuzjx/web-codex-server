import { keepRequestOnTurn } from '../../shared/chat/user-input.ts';
import type {
  CodexEvent,
  ProtocolCallback,
  ProtocolRecord,
  ServerRequest,
} from '../../shared/contracts/protocol.ts';
import { fail } from '../files/files.ts';
import { validateAnswers } from './pending-requests.ts';

// CLI 0.162.1 emits request_user_input_async as a structured agentMessage,
// not a JSON-RPC server request. Its answers are ordinary user messages.
export class AsyncUserInputs {
  declare requests: Map<string | number, ServerRequest>;
  declare seen: Set<string | number>;
  declare replying: Set<string | number>;
  declare sendAnswer: ProtocolCallback;
  declare resolved: ProtocolCallback;
  constructor(sendAnswer: ProtocolCallback, resolved: ProtocolCallback) {
    this.requests = new Map();
    this.seen = new Set();
    this.replying = new Set();
    this.sendAnswer = sendAnswer;
    this.resolved = resolved;
  }
  observe(event: CodexEvent) {
    if (event.method === 'connection/lost') {
      this.dispose();
      return;
    }
    if (
      ['turn/started', 'turn/completed', 'thread/archived', 'thread/deleted'].includes(event.method)
    ) {
      for (const request of this.requests.values())
        if (
          ['thread/archived', 'thread/deleted'].includes(event.method)
            ? request.params.threadId === event.params?.threadId
            : !keepRequestOnTurn(request, event)
        )
          this.remove(request, 'cancelled');
    }
    if (event.method !== 'item/completed') return;
    const { threadId, turnId, item } = event.params || {};
    if (
      item?.type !== 'agentMessage' ||
      item.delivery !== 'async' ||
      typeof threadId !== 'string' ||
      typeof turnId !== 'string' ||
      typeof item.id !== 'string' ||
      !Array.isArray(item.questions) ||
      !item.questions.length
    )
      return;
    // Only the CLI's structured metadata can open a dialog; never parse prose.
    if (
      item.questions.some(
        (q: any) =>
          !q ||
          typeof q.title !== 'string' ||
          !q.title.trim() ||
          (q.options != null &&
            (!Array.isArray(q.options) ||
              q.options.some((o: any) => typeof o !== 'string' || !o.trim()))),
      )
    )
      return;
    const id = `web:async:${JSON.stringify([threadId, item.id])}`;
    if (this.seen.has(id)) return;
    const request = {
      id,
      method: 'item/agentMessage/requestUserInput',
      receivedAt: Date.now(),
      expiresAt: null,
      params: {
        threadId,
        turnId,
        itemId: item.id,
        isBlocking: false,
        questions: item.questions.map((q: any, index: any) => ({
          id: `question_${index + 1}`,
          header: `问题 ${index + 1}`,
          question: q.title,
          isOther: true,
          isSecret: false,
          options: q.options?.map((label: any) => ({ label, description: '' })) || null,
        })),
      },
    };
    this.seen.add(id);
    this.requests.set(id, request);
    return request;
  }
  async reply(id: any, result: ProtocolRecord) {
    const request = this.requests.get(String(id));
    if (!request) fail(404, '该请求已失效');
    if (this.replying.has(request!.id)) fail(409, '回答正在提交，请稍候');
    validateAnswers(request, result, true);
    const text =
      '对 Codex 补充问题的回答：\n\n' +
      request!.params
        .questions!.map(
          (q, index) => `${index + 1}. ${q.question}\n回答：${result.answers[q.id].answers[0]}`,
        )
        .join('\n\n');
    this.replying.add(request!.id);
    try {
      await this.sendAnswer(request, text);
      if (this.requests.get(request!.id) === request) this.remove(request, 'answered');
    } finally {
      this.replying.delete(request!.id);
    }
  }
  remove(request: ServerRequest | undefined, reason: string) {
    this.requests.delete(request!.id);
    this.resolved({ threadId: request!.params.threadId, requestId: request!.id, reason });
  }
  dispose() {
    this.requests.clear();
    this.seen.clear();
    this.replying.clear();
  }
}
