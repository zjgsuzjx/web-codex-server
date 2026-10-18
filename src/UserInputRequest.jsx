import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, Clock3, LoaderCircle, MessageCircle } from 'lucide-react';
import { answerResult, hasAnswer } from '../shared/user-input.js';
import Modal from './Modal';

export default function UserInputRequest({ request, socket, status, draft = {}, onDraft, onDone, onClose, threadTitle }) {
  const questions = request.params?.questions || [], [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(''), [now, setNow] = useState(Date.now());
  const pending = useRef(false), closing = useRef(false), question = questions[Math.min(step, questions.length - 1)];
  const deadline = request.deadline, expired = deadline != null && now >= deadline;
  useEffect(() => { if (deadline == null) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [deadline]);
  const state = draft[question?.id] || {}, ready = question && hasAnswer(question, state), connected = status === 'connected';
  const update = value => onDraft({ ...draft, [question.id]: { ...state, ...value } });
  async function submit(event) {
    event.preventDefault();
    if (pending.current || closing.current || expired || !connected || !ready) return;
    if (step < questions.length - 1) { setStep(step + 1); return; }
    if (!questions.every(q => hasAnswer(q, draft[q.id]))) return;
    pending.current = true; setBusy(true); setError('');
    try { await socket.call('approval/reply', { requestId: request.id, result: answerResult(questions, draft) }); onDone(); }
    catch (e) { setError(e.message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Modal title="Codex 需要你的补充" subtitle={threadTitle ? `对话：${threadTitle}` : undefined} icon={MessageCircle} className="user-input-dialog" dismissible={!busy} onRequestClose={() => { closing.current = true; }} onClose={onClose}>
    <form className="user-input-request" onSubmit={submit} aria-label="Codex 问答" aria-busy={busy}>
    <header><div><span>{request.params?.isBlocking === false ? '补充信息，帮助 Codex 继续完善任务' : '回答后，Codex 会继续处理任务'}</span></div>{deadline != null && <span className={`question-countdown ${expired ? 'expired' : ''}`}><Clock3 size={13}/>{expired ? '时间已结束' : `${Math.max(0, Math.ceil((deadline - now) / 1000))} 秒`}</span>}</header>
    {question ? <><div className="question-steps" aria-label="问题进度">{questions.map((q, index) => <button type="button" key={q.id} className={step === index ? 'active' : ''} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span>{hasAnswer(q, draft[q.id]) ? <Check size={11}/> : index + 1}</span>{q.header || `问题 ${index + 1}`}</button>)}</div>
      <div className="question-content"><h3 id={`question-${request.id}-${step}`}>{question.question}</h3><fieldset disabled={busy || expired} aria-labelledby={`question-${request.id}-${step}`}>
        {question.options?.length > 0 && <div className="question-options">{question.options.map((option, index) => <label key={option.label} className={`question-option ${!state.custom && state.option === option.label ? 'selected' : ''}`}><input type="radio" name={`answer-${request.id}-${question.id}`} checked={!state.custom && state.option === option.label} onChange={() => update({ option: option.label, custom: false })}/><span className="option-number">{index + 1}</span><span className="option-copy"><strong>{option.label}</strong>{option.description && <span>{option.description}</span>}</span>{!state.custom && state.option === option.label && <Check size={15}/>}</label>)}</div>}
        {(!question.options?.length || question.isOther) && <div className="question-custom">{question.options?.length > 0 && <label><input type="radio" name={`answer-${request.id}-${question.id}`} checked={!!state.custom} onChange={() => update({ custom: true })}/>填写其他答案</label>}{question.isSecret ? <input type="password" aria-label="你的回答" autoComplete="off" value={state.text || ''} placeholder="输入你的回答" onFocus={() => update({ custom: true })} onChange={e => update({ custom: true, text: e.target.value })} maxLength={20000}/> : <textarea aria-label="你的回答" value={state.text || ''} placeholder="输入你的回答…" onFocus={() => update({ custom: true })} onChange={e => update({ custom: true, text: e.target.value })} rows={2} maxLength={20000}/>}</div>}
      </fieldset></div>
      {error && <p className="question-error" role="alert">{error}</p>}
      <footer><span role="status">{!connected ? '连接恢复后可提交' : expired ? '正在结束此次请求…' : deadline != null ? '超时将留空，已选答案不会自动提交' : `共 ${questions.length} 个问题 · 请确认后提交`}</span><div>{step > 0 && <button type="button" className="question-back" disabled={busy} onClick={() => setStep(step - 1)}><ChevronLeft size={14}/>上一题</button>}<button type="submit" className="primary" disabled={!ready || busy || expired || !connected || step === questions.length - 1 && !questions.every(q => hasAnswer(q, draft[q.id]))}>{busy ? <LoaderCircle size={14} className="spin"/> : step === questions.length - 1 ? <Check size={14}/> : <ArrowRight size={14}/>} {busy ? '提交中…' : step === questions.length - 1 ? '提交回答' : '下一题'}</button></div></footer>
    </> : <p>Codex 未提供问题，请停止当前任务后重试。</p>}
  </form></Modal>;
}
