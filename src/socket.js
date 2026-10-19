import { fileEntryLimit, fileEntryLimitMessage } from '../shared/file-limits.js';

export class LiveSocket {
  constructor(user, onEvent, onStatus, onLatency = () => {}) { this.user = user; this.onEvent = onEvent; this.onStatus = onStatus; this.onLatency = onLatency; this.next = 1; this.pending = new Map(); this.ack = null; this.stopped = false; this.attempts = 0; this.connect(); }
  connect() {
    this.onStatus(this.attempts ? 'reconnecting' : 'connecting');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${protocol}://${location.host}/ws?csrf=${encodeURIComponent(this.user.csrf)}`);
    this.ws.onopen = () => { this.attempts = 0; this.onStatus('connected'); this.measureLatency(); this.latencyTimer = setInterval(() => this.measureLatency(), 60000); };
    this.ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      const failure = typeof msg.error === 'string' ? msg.error : msg.error?.message;
      if (failure && /存储配额不足|存储空间已满|ENOSPC|EDQUOT|SQLITE_FULL|no space left|database or disk is full/i.test(failure)) this.onEvent({ type: 'storage/full' });
      if (msg.id != null) { const waiter = this.pending.get(msg.id); if (waiter) { clearTimeout(waiter.timer); this.pending.delete(msg.id); msg.error ? waiter.reject(Object.assign(new Error(msg.error.message), msg.error)) : waiter.resolve(msg.result); } }
      else if (msg.type === 'upload/ack') { if (this.ack) { clearTimeout(this.ack.timer); this.ack.resolve(msg); this.ack = null; } }
      else if (msg.type === 'error') { if (this.ack) { clearTimeout(this.ack.timer); this.ack.reject(new Error(msg.error)); this.ack = null; } else this.onEvent(msg); }
      else { this.onEvent(msg); for (const listener of this.listeners || []) listener(msg); }
    };
    this.ws.onclose = e => {
      clearInterval(this.latencyTimer); this.onLatency(null);
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('连接已断开，请重试')); } this.pending.clear();
      if (this.ack) { clearTimeout(this.ack.timer); this.ack.reject(new Error('连接已断开')); this.ack = null; }
      if (this.stopped) return;
      this.expired = e.code === 4001;
      this.onStatus(this.expired ? 'expired' : 'disconnected');
      if (e.code !== 4001) this.timer = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.attempts++));
    };
  }
  retry() {
    if (this.stopped || this.expired || this.ws.readyState !== WebSocket.CLOSED) return;
    clearTimeout(this.timer);
    this.connect();
  }
  async ready() { if (this.ws.readyState === WebSocket.OPEN) return; for (let n = 0; n < 120; n++) { if (this.stopped) throw new Error('连接已关闭'); if (this.ws.readyState === WebSocket.OPEN) return; await new Promise(r => setTimeout(r, 250)); } throw new Error('无法连接服务器'); }
  async call(method, params = {}, timeoutMs = 130000) {
    await this.ready(); const id = this.next++;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('请求超时，请稍后重试')); }, timeoutMs); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async measureLatency() {
    if (this.measuring || this.stopped || this.ws.readyState !== WebSocket.OPEN) return;
    this.measuring = true; const ws = this.ws, start = performance.now();
    try { await this.call('connection/ping', {}, 10000); if (!this.stopped && this.ws === ws && ws.readyState === WebSocket.OPEN) this.onLatency(Math.max(1, Math.round(performance.now() - start))); }
    catch { if (!this.stopped && this.ws === ws) this.onLatency(Infinity); }
    finally { this.measuring = false; }
  }
  async chunk(data) {
    await this.ready();
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.ack = null; reject(new Error('上传确认超时')); }, 60000); this.ack = { resolve, reject, timer }; this.ws.send(data); });
  }
  async upload(destination, files, onProgress, signal, onConflict) {
    let complete = 0; const total = files.reduce((n, f) => n + f.size, 0), results = [];
    const target = typeof destination === 'string' ? {projectId:destination} : destination;
    let conflictPolicy = 'ask';
    if (signal?.aborted) throw new Error('已取消上传');
    if (target.projectId && !target.extract && files.length && onConflict) {
      const limit=fileEntryLimit(this.user);
      if(limit!=null&&files.length>limit)throw new Error(fileEntryLimitMessage(limit));
      const check={conflicts:[],conflictCount:0},encoder=new TextEncoder();
      let paths=[],size=0;
      const inspect=async()=>{
        if(signal?.aborted)throw new Error('已取消上传');
        onProgress({phase:'checking',name:paths[0],done:0,total,index:0,count:files.length});
        const result=await this.call('upload/check',{projectId:target.projectId,paths});
        check.conflictCount+=result.conflictCount;
        check.conflicts.push(...result.conflicts.slice(0,Math.max(0,100-check.conflicts.length)));
        paths=[];size=0;
      };
      for(const file of files){
        const path=file.uploadPath || file.webkitRelativePath || file.name,bytes=encoder.encode(JSON.stringify(path)).length+1;
        // Keep JSON requests below the gateway's 1 MiB message ceiling.
        if(paths.length&&size+bytes>256*1024)await inspect();
        paths.push(path);size+=bytes;
      }
      if(paths.length)await inspect();
      if (check.conflictCount) {
        onProgress({phase:'conflict',name:files[0].name,done:0,total,index:0,count:files.length});
        conflictPolicy = await onConflict(check);
        if (!['skip','overwrite'].includes(conflictPolicy) || signal?.aborted) throw new Error('已取消上传');
      }
    }
    for (let index = 0; index < files.length; index++) {
      if (signal?.aborted) throw new Error('已取消上传');
      const file = files[index], filename = file.uploadPath || file.webkitRelativePath || file.name;
      let task = await this.call('upload/begin', { ...target, path: filename, size: file.size }), offset = task.offset;
      const report = (extra = {}) => onProgress({ name: filename, done: complete + offset, total, index: index + 1, count: files.length, phase: 'uploading', ...extra });
      const unsubscribe = this.subscribe(event => { if (event.type === 'upload/progress' && event.uploadId === task.uploadId) report({ phase:event.phase, stageDone:event.done, stageTotal:event.total }); });
      try {
        report();
        while (offset < file.size) {
          if (signal?.aborted) throw new Error('已取消上传');
          try {
            const chunk = await file.slice(offset, offset + task.chunkSize).arrayBuffer(); const ack = await this.chunk(chunk); offset = ack.offset;
          } catch (e) {
            if (this.ws.readyState === WebSocket.OPEN) throw e;
            await this.ready(); task = await this.call('upload/resume', { uploadId: task.uploadId }); offset = task.offset;
          }
          report();
        }
        if (signal?.aborted) throw new Error('已取消上传');
        let result;
        while (!result) {
          if (signal?.aborted) throw new Error('已取消上传');
          report({phase:target.extract ? 'extracting' : 'finishing',stageDone:0,stageTotal:0});
          try { result = await this.call('upload/finish', { uploadId: task.uploadId, conflictPolicy }); }
          catch (error) {
            if (error.code !== 'UPLOAD_CONFLICT' || !onConflict) throw error;
            report({phase:'conflict',stageDone:0,stageTotal:0});
            conflictPolicy = await onConflict(error);
            if (!['skip','overwrite'].includes(conflictPolicy) || signal?.aborted) throw new Error('已取消上传');
          }
        }
        results.push(result); complete += file.size;
        report({done:complete,phase:'complete'});
      } catch (e) { await this.call('upload/cancel', { uploadId: task.uploadId }).catch(() => {}); throw e; }
      finally { unsubscribe(); }
    }
    return results;
  }
  close() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.latencyTimer); this.ws.close(); }
  subscribe(listener) { this.listeners ||= new Set(); this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
