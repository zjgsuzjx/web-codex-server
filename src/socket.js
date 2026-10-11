export class LiveSocket {
  constructor(user, onEvent, onStatus) { this.user = user; this.onEvent = onEvent; this.onStatus = onStatus; this.next = 1; this.pending = new Map(); this.ack = null; this.stopped = false; this.attempts = 0; this.connect(); }
  connect() {
    this.onStatus('connecting');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${protocol}://${location.host}/ws?csrf=${encodeURIComponent(this.user.csrf)}`);
    this.ws.onopen = () => { this.attempts = 0; this.onStatus('connected'); };
    this.ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id != null) { const waiter = this.pending.get(msg.id); if (waiter) { clearTimeout(waiter.timer); this.pending.delete(msg.id); msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result); } }
      else if (msg.type === 'upload/ack') { if (this.ack) { clearTimeout(this.ack.timer); this.ack.resolve(msg); this.ack = null; } }
      else if (msg.type === 'error') { if (this.ack) { clearTimeout(this.ack.timer); this.ack.reject(new Error(msg.error)); this.ack = null; } else this.onEvent(msg); }
      else { this.onEvent(msg); for (const listener of this.listeners || []) listener(msg); }
    };
    this.ws.onclose = e => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('连接已断开，请重试')); } this.pending.clear();
      if (this.ack) { clearTimeout(this.ack.timer); this.ack.reject(new Error('连接已断开')); this.ack = null; }
      if (this.stopped) return;
      this.onStatus(e.code === 4001 ? 'expired' : 'disconnected');
      if (e.code !== 4001) this.timer = setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.attempts++));
    };
  }
  async ready() { if (this.ws.readyState === WebSocket.OPEN) return; for (let n = 0; n < 120; n++) { if (this.stopped) throw new Error('连接已关闭'); if (this.ws.readyState === WebSocket.OPEN) return; await new Promise(r => setTimeout(r, 250)); } throw new Error('无法连接服务器'); }
  async call(method, params = {}) {
    await this.ready(); const id = this.next++;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('请求超时，请稍后重试')); }, 130000); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async chunk(data) {
    await this.ready();
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.ack = null; reject(new Error('上传确认超时')); }, 60000); this.ack = { resolve, reject, timer }; this.ws.send(data); });
  }
  async upload(projectId, files, onProgress, signal) {
    let complete = 0; const total = files.reduce((n, f) => n + f.size, 0);
    for (let index = 0; index < files.length; index++) {
      const file = files[index], filename = file.webkitRelativePath || file.name;
      let task = await this.call('upload/begin', { projectId, path: filename, size: file.size }), offset = task.offset;
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
        await this.call('upload/finish', { uploadId: task.uploadId }); complete += file.size;
        onProgress({ name: filename, done: complete, total, index: index + 1, count: files.length });
      } catch (e) { await this.call('upload/cancel', { uploadId: task.uploadId }).catch(() => {}); throw e; }
    }
  }
  close() { this.stopped = true; clearTimeout(this.timer); this.ws.close(); }
  subscribe(listener) { this.listeners ||= new Set(); this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
