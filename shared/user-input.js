export const isUserInput = request => /(?:^|\/)requestUserInput$/.test(request?.method || '');

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
