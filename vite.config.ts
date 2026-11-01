import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite otherwise builds all Monaco workers concurrently. Share the queue across
// the separately bundled worker configurations, and release on errors as well.
const gate = ((globalThis as typeof globalThis & { [key: symbol]: { tail: Promise<void> } })[
  Symbol.for('starvalley.worker-build-queue')
] ||= {
  tail: Promise.resolve(),
});
function serialWorkerBuild() {
  let unlock: (() => void) | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    setImmediate(() => {
      globalThis.gc?.();
      unlock?.();
    });
  };
  return {
    name: 'serial-worker-build',
    async buildStart() {
      const previous = gate.tail;
      gate.tail = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await previous;
    },
    buildEnd(error: any) {
      if (error) release();
    },
    closeBundle: release,
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3100', '/ws': { target: 'ws://127.0.0.1:3100', ws: true } },
  },
  build: {
    chunkSizeWarningLimit: 2200,
    reportCompressedSize: false,
    rollupOptions: { maxParallelFileOps: 32 },
  },
  worker: { plugins: () => [serialWorkerBuild()], rollupOptions: { maxParallelFileOps: 32 } },
});
