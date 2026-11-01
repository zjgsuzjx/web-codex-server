import type { AnswerDrafts, Question } from '../contracts/domain.ts';
import type { CodexEvent, ServerRequest } from '../contracts/protocol.ts';
export const isUserInput = (request: Partial<CodexEvent> | null | undefined) =>
  /(?:^|\/)requestUserInput$/.test(request?.method || '');
export const isAsyncUserInput = (request: Partial<CodexEvent> | null | undefined) =>
  request?.method === 'item/agentMessage/requestUserInput';

export function keepRequestOnTurn(request: ServerRequest, event: CodexEvent) {
  const p = event.params || {};
  if (request.params?.threadId !== p.threadId) return true;
  if (
    isAsyncUserInput(request) &&
    (event.method === 'turn/started' || p.turn?.status === 'completed')
  )
    return true;
  return (
    event.method === 'turn/completed' &&
    request.params?.turnId &&
    request.params.turnId !== p.turn?.id
  );
}

export function answerResult(questions: Question[], drafts: AnswerDrafts) {
  return {
    answers: Object.fromEntries(
      questions.map((q) => {
        const draft = drafts[q.id];
        const value = draft?.custom
          ? q.isSecret
            ? draft.text
            : draft.text?.trim()
          : draft?.option;
        return [q.id, { answers: value ? [value] : [] }];
      }),
    ),
  };
}

export function hasAnswer(
  question: Question,
  draft: import('../contracts/domain.ts').AnswerDraft | undefined,
) {
  return Boolean(
    draft?.custom ? draft.text?.trim() : question.options?.some((o) => o.label === draft?.option),
  );
}
