import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editableTurn } from '../server/chat/edit-turn.ts';
import { userMessageText, userMessageTime } from '../shared/chat/user-message.ts';
import { AsyncUserInputs } from '../server/chat/async-user-input.ts';

const turn = id => ({ id, status: 'completed', items: [{ id: `${id}-user`, type: 'userMessage', content: [{type:'text',text:id}] }] });
test('edit target lookup pages through native history and never trusts a stale browser tail', async () => {
  const calls=[];
  const call=async (_,args)=>{calls.push(args);return args.cursor?{data:[turn('old')],nextCursor:null}:{data:[turn('new')],nextCursor:'page-2'};};
  const params={turnId:'old',itemId:'old-user',expectedLastTurnId:'new'};
  assert.equal((await editableTurn(call,'thread',params)).id,'old');assert.equal(calls.length,2);assert.equal(calls[1].cursor,'page-2');
  await assert.rejects(editableTurn(call,'thread',{...params,expectedLastTurnId:'stale'}),/对话已更新/);
  await assert.rejects(editableTurn(call,'thread',{...params,turnId:'missing'}),/不存在/);
});
test('edit rejects active turns, missing items, multiple user inputs and cyclic cursors', async()=>{
  const params={turnId:'target',itemId:'target-user',expectedLastTurnId:'target'};
  for(const items of [[],[...turn('target').items,...turn('other').items]])
    await assert.rejects(editableTurn(async()=>({data:[{...turn('target'),items}]}),'t',params),/多条用户输入/);
  await assert.rejects(editableTurn(async()=>({data:[{...turn('target'),status:'inProgress'}]}),'t',params),/回复结束/);
  await assert.rejects(editableTurn(async()=>({data:[turn('latest')],nextCursor:'loop'}),'t',{...params,expectedLastTurnId:'latest'}),/分页未前进/);
  await assert.rejects(editableTurn(async()=>{throw Error('must not call');},'t',{}),/参数无效/);
});
test('user message time uses persisted milliseconds or native seconds without inventing old timestamps',()=>{
  const item=turn('a').items[0];
  assert.equal(userMessageText(item),'a');
  assert.equal(userMessageTime({...item,sentAt:1234567890000},{startedAt:10}),1234567890000);
  assert.equal(userMessageTime(item,{startedAt:1234567890,timing:{startedAt:2}}),1234567890000);
  assert.equal(userMessageTime(item,{timing:{startedAt:1234}}),1234);
  for(const value of [null,undefined,NaN,-1,1e20])assert.equal(userMessageTime(item,{startedAt:value}),null);
});
test('history reset cancels asynchronous questions only in the edited conversation',async()=>{
  const resolved=[];
  const queue=new AsyncUserInputs(()=>{throw Error('stale answer must not be sent');},value=>resolved.push(value));
  const question=threadId=>({method:'item/completed',params:{threadId,turnId:'turn',item:{type:'agentMessage',delivery:'async',id:'question',questions:[{title:'Question?'}]}}});
  const first=queue.observe(question('edited'));queue.observe(question('other'));
  queue.observe({method:'thread/history/reverted',params:{threadId:'edited'}});
  assert.equal(queue.requests.size,1);assert.equal(resolved[0].threadId,'edited');
  await assert.rejects(queue.reply(first.id,{answers:{question_1:{answers:['answer']}}}),/失效/);
});
