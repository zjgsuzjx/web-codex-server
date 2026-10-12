import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProcessItem, reasoningText, mediaUrl, toolContent, contentImage } from '../shared/chat-content.js';
import { applyDeltas, applyLifecycle, createDeltaBuffer } from '../src/deltas.js';
import { imageResult, mediaLocation } from '../server/chat-media.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNioAAAAASUVORK5CYII=';
test('generated images and tool images remain visible after completion, including failures', () => {
  for (const status of ['inProgress', 'completed', 'failed']) assert.equal(isProcessItem({type:'imageGeneration', status}), false);
  assert.equal(isProcessItem({type:'agentMessage', phase:'commentary'}), true);
  const tool = {type:'mcpToolCall',result:{content:[{type:'image',mimeType:'image/png',data:png}]}};
  assert.equal(isProcessItem(tool), false); assert.match(contentImage(toolContent(tool)[0]), /^data:image\/png;base64,/);
  assert.deepEqual(toolContent({type:'functionCallOutput',output:'hello'}), [{type:'text',text:'hello'}]);
  assert.equal(contentImage({type:'inputImage',imageUrl:'https://example.test/image.png'}), 'https://example.test/image.png');
  assert.equal(contentImage({type:'input_image',image_url:`data:image/png;base64,${png}`}), `data:image/png;base64,${png}`);
  assert.deepEqual(toolContent({type:'futureItem',result:{content:'unknown shape'}}), []);
  assert.equal(isProcessItem({type:'futureItem',result:{content:'unknown shape'}}), true);
});
test('reasoning keeps summary and full content, preserves indexed paragraphs, and avoids duplicates', () => {
  const delivered = [], timers = {setTimeout:()=>1,clearTimeout:()=>{}};
  const buffer = createDeltaBuffer(events=>delivered.push(...events), 50, timers);
  for (const [summaryIndex,delta] of [[0,'First'],[1,'Second'],[0,' paragraph']]) buffer.push({method:'item/reasoning/summaryTextDelta',params:{turnId:'t',itemId:'r',summaryIndex,delta}});
  buffer.flush();
  let turns = applyDeltas([], delivered);
  turns = applyDeltas(turns, [{method:'item/reasoning/textDelta',params:{turnId:'t',itemId:'r',contentIndex:0,delta:'Details'}}]);
  assert.equal(reasoningText(turns[0].items[0]), 'First paragraph\n\nSecond\n\nDetails');
  turns = applyLifecycle(turns, {method:'item/completed',params:{turnId:'t',item:{id:'r',type:'reasoning',summary:['First paragraph','Second'],content:['Details']}}});
  assert.equal(reasoningText(turns[0].items[0]), 'First paragraph\n\nSecond\n\nDetails');
  assert.equal(reasoningText({content:['History only']}), 'History only');
  assert.equal(reasoningText({summary:['Same'],content:['Same']}), 'Same');
});
test('delayed start snapshots preserve completed image URLs and item status', () => {
  let turns = applyLifecycle([], {method:'item/completed',params:{turnId:'t',item:{id:'image',type:'imageGeneration',status:'completed',imageUrl:'/api/image'}}});
  turns = applyLifecycle(turns, {method:'item/started',params:{turnId:'t',item:{id:'image',type:'imageGeneration',status:'inProgress',imageUrl:null}}});
  assert.equal(turns[0].items[0].imageUrl, '/api/image'); assert.equal(turns[0].items[0].status, 'completed');
});
test('image results accept only supported raster data and media paths cannot expose other users or credentials', () => {
  assert.equal(imageResult(png).mime, 'image/png'); assert.equal(imageResult(`data:image/png;base64,${png}`).mime, 'image/png');
  for (const value of ['file:///etc/passwd', 'not an image', Buffer.from('<svg/>').toString('base64'), 'https://example.test/a.png']) assert.equal(imageResult(value), null);
  const config={dataDir:'F:/test-data',hostDataDir:'/srv/data'}, user={username:'alice'}, thread={project_id:'project'};
  assert.equal(mediaLocation(config,user,thread,'/workspace/project/output.png').rel,'output.png');
  assert.equal(mediaLocation(config,user,thread,'/srv/data/users/alice/codex/generated_images/t/a.png').rel,'t/a.png');
  for (const value of ['/etc/passwd','/workspace/other/a.png','/srv/data/users/bob/codex/generated_images/a.png','/home/node/.codex/auth.json','/workspace/project/../secret.png','../secret.png']) assert.throws(()=>mediaLocation(config,user,thread,value));
  assert.equal(mediaUrl('javascript:alert(1)','t'),''); assert.equal(mediaUrl('data:image/svg+xml;base64,abc','t'),''); assert.equal(mediaUrl('//evil.test/x','t'),'');
  assert.match(mediaUrl('/workspace/project/output.png','t'), /^\/api\/threads\/t\/media\?path=/);
});
