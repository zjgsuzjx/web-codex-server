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
      if (msg.id != null) { const waiter = this.pending.get(msg.id); if (waiter) { clearTimeout(waiter.timer); this.pending.delete(msg.id); msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result); } }
      else if (msg.type === 'upload/ack') { if (this.ack) { clearTimeout(this.ack.timer); this.ack.resolve(msg); this.ack = null; } }
      else if (msg.type === 'error') { if (this.ack) { clearTimeout(this.ack.timer); this.ack.reject(new Error(msg.error)); this.ack = null; } else this.onEvent(msg); }
      else { this.onEvent(msg); for (const listener of this.listeners || []) listener(msg); }
    };
    this.ws.onclose = e => {
      clearInterval(this.latencyTimer); this.onLatency(null);
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('连接已断开，请重试')); } this.pending.clear();
      if (this.ack) { clearTimeout(this.ack.timer); this.ack.reject(new Error('连接已断开')); this.ack = null; }
      if (this.stopped) return;
      this.onStatus(e.code === 4001 ? 'expired' : 'disconnected');
      if (e.code !== 4001) this.timer = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.attempts++));
    };
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
  async upload(destination, files, onProgress, signal) {
    let complete = 0; const total = files.reduce((n, f) => n + f.size, 0), results = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index], filename = file.webkitRelativePath || file.name;
      const target = typeof destination === 'string' ? {projectId:destination} : destination;
      let task = await this.call('upload/begin', { ...target, path: filename, size: file.size }), offset = task.offset;
      try {
        while (offset < file.size) {
          if (signal?.aborted) throw new Error('已取消上传');
          try {
            const chunk = await file.slice(offset, offset + task.chunkSize).arrayBuffer(); const ack = await this.chunk(chunk); offset = ack.offset;
          } catch (e) {
            if (this.ws.readyState === WebSocket.OPEN) throw e;
            await this.ready(); task = await this.call('upload/resume', { uploadId: task.uploadId }); offset = task.offset;
          }
          onProgress({ name: filename, done: complete + offset, total, index: index + 1, count: files.length });
        }
        if (signal?.aborted) throw new Error('已取消上传');
        results.push(await this.call('upload/finish', { uploadId: task.uploadId })); complete += file.size;
        onProgress({ name: filename, done: complete, total, index: index + 1, count: files.length });
      } catch (e) { await this.call('upload/cancel', { uploadId: task.uploadId }).catch(() => {}); throw e; }
    }
    return results;
  }
  close() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.latencyTimer); this.ws.close(); }
  subscribe(listener) { this.listeners ||= new Set(); this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
