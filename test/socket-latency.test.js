import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveSocket } from '../src/socket.js';

test('connected sockets sample immediately and every minute, clear stale latency, and stop timers on close', async t => {
  t.mock.timers.enable({ apis: ['setTimeout','setInterval'] });
  const previousSocket=globalThis.WebSocket,previousLocation=globalThis.location;
  const connections=[],samples=[],states=[];
  class FakeSocket {
    static OPEN=1;
    constructor(){this.readyState=0;this.sent=[];this.respond=true;connections.push(this);}
    send(data){const message=JSON.parse(data);this.sent.push(message);if(this.respond)queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:message.id,result:{ok:true}})}));}
    open(){this.readyState=1;this.onopen();}
    close(){this.readyState=3;this.onclose({code:1000});}
  }
  globalThis.WebSocket=FakeSocket;globalThis.location={protocol:'http:',host:'localhost'};
  t.after(()=>{globalThis.WebSocket=previousSocket;globalThis.location=previousLocation;});
  const socket=new LiveSocket({csrf:'test'},()=>{},s=>states.push(s),ms=>samples.push(ms));
  assert.deepEqual(states,['connecting']);
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  connections[0].open();await settle();
  assert.equal(connections[0].sent.length,1);assert.equal(connections[0].sent[0].method,'connection/ping');assert.ok(samples[0]>=1);
  t.mock.timers.tick(59999);await settle();assert.equal(connections[0].sent.length,1);
  t.mock.timers.tick(1);await settle();assert.equal(connections[0].sent.length,2);
  connections[0].respond=false;t.mock.timers.tick(60000);await settle();t.mock.timers.tick(10000);await settle();assert.equal(samples.at(-1),Infinity);
  connections[0].close();assert.equal(samples.at(-1),null);assert.equal(states.at(-1),'disconnected');
  t.mock.timers.tick(1000);assert.equal(states.at(-1),'reconnecting');connections[1].open();await settle();assert.equal(connections[1].sent.length,1);assert.equal(states.at(-1),'connected');
  socket.close();t.mock.timers.tick(60000);await settle();assert.equal(connections[1].sent.length,1);assert.equal(connections.length,2);
});

test('manual retry replaces the pending reconnect and ignores active, expired and stopped sockets', t => {
  t.mock.timers.enable({ apis: ['setTimeout','setInterval'] });
  const previousSocket=globalThis.WebSocket,previousLocation=globalThis.location;
  const connections=[],states=[];
  class FakeSocket {
    static OPEN=1;static CLOSED=3;
    constructor(){this.readyState=0;connections.push(this);}
    send(){}
    close(code=1000){this.readyState=3;this.onclose({code});}
  }
  globalThis.WebSocket=FakeSocket;globalThis.location={protocol:'http:',host:'localhost'};
  t.after(()=>{globalThis.WebSocket=previousSocket;globalThis.location=previousLocation;});
  const socket=new LiveSocket({csrf:'test'},()=>{},state=>states.push(state));
  socket.retry();assert.equal(connections.length,1);
  connections[0].close();assert.equal(states.at(-1),'disconnected');
  socket.retry();assert.equal(connections.length,2);assert.equal(states.at(-1),'reconnecting');
  socket.retry();t.mock.timers.tick(1000);assert.equal(connections.length,2);
  connections[1].readyState=1;socket.retry();assert.equal(connections.length,2);
  connections[1].close();socket.close();socket.retry();t.mock.timers.tick(30000);assert.equal(connections.length,2);
  const expired=new LiveSocket({csrf:'test'},()=>{},state=>states.push(state));
  connections[2].close(4001);assert.equal(states.at(-1),'expired');
  expired.retry();t.mock.timers.tick(30000);assert.equal(connections.length,3);
  expired.close();
});
