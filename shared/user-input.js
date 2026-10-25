export const isUserInput = request => /(?:^|\/)requestUserInput$/.test(request?.method || '');
export const isAsyncUserInput = request => request?.method === 'item/agentMessage/requestUserInput';

export function keepRequestOnTurn(request, event) {
  const p = event.params || {};
  if (request.params?.threadId !== p.threadId) return true;
  if (isAsyncUserInput(request) && (event.method === 'turn/started' || p.turn?.status === 'completed')) return true;
  return event.method === 'turn/completed' && request.params?.turnId && request.params.turnId !== p.turn?.id;
}

export function answerResult(questions, drafts) {
  return { answers: Object.fromEntries(questions.map(q => {
    const draft = drafts[q.id];
    const value = draft?.custom ? (q.isSecret ? draft.text : draft.text?.trim()) : draft?.option;
    return [q.id, { answers: value ? [value] : [] }];
  })) };
}

export function hasAnswer(question, draft) {
  return Boolean(draft?.custom ? draft.text?.trim() : question.options?.some(o => o.label === draft?.option));
}
