interface QueueOptions {
  save: (settings: Settings) => Promise<Settings | void>;
  onChange?: (settings: Settings) => void;
  onPending?: (pending: boolean) => void;
  onError?: (error: AppError) => void;
}
import type { Settings } from '../contracts/domain.ts';
import type { AppError } from '../contracts/errors.ts';
// Persist one request at a time while the form displays the latest selection.
// Unsent changes are merged, so a slow response cannot overwrite newer input.
export function createSettingsQueue(
  initial: Settings,
  { save, onChange = () => {}, onPending = () => {}, onError = () => {} }: QueueOptions,
) {
  let confirmed = { ...initial },
    current = { ...initial },
    queued: Partial<Settings> = {},
    running = false,
    error = '',
    revision = 0;
  let snapshot = { value: current, pending: false, error };
  const listeners = new Set<() => void>(),
    waiting: {
      revision: number;
      resolve: (value: Settings) => void;
      reject: (error: unknown) => void;
    }[] = [];
  const publish = () => {
    snapshot = { value: { ...current }, pending: running, error };
    onChange(snapshot.value);
    for (const listener of listeners) listener();
  };
  const settle = (through: number, failure?: AppError) => {
    for (let index = waiting.length - 1; index >= 0; index--) {
      if (waiting[index].revision > through) continue;
      const item = waiting.splice(index, 1)[0];
      if (failure) item.reject(failure);
      else item.resolve({ ...confirmed });
    }
  };
  async function drain() {
    running = true;
    onPending(true);
    publish();
    while (Object.keys(queued).length) {
      const patch = queued,
        through = revision;
      queued = {};
      const request = { ...confirmed, ...patch };
      try {
        confirmed = { ...((await save(request)) || request) };
        settle(through);
      } catch (caughtError) {
        const failure = caughtError as AppError;
        error = failure.message || '更改未保存，请重试。';
        onError(failure);
        settle(through, failure);
      }
      current = { ...confirmed, ...queued };
      publish();
    }
    running = false;
    onPending(false);
    publish();
  }
  return {
    update(next: Settings, baseline = current) {
      const patch = Object.fromEntries(
        Object.entries(next).filter(([key, value]) => value !== baseline[key as keyof Settings]),
      );
      if (!Object.keys(patch).length) return Promise.resolve({ ...confirmed });
      if ('model' in patch && 'effort' in next) patch.effort = next.effort;
      const completion = new Promise<Settings>((resolve, reject) =>
        waiting.push({ revision: ++revision, resolve, reject }),
      );
      error = '';
      current = { ...current, ...patch };
      queued = { ...queued, ...patch };
      publish();
      if (!running) void drain();
      return completion;
    },
    sync(next: Settings) {
      if (
        running ||
        (Object.keys(next).length === Object.keys(current).length &&
          Object.entries(next).every(([key, value]) => current[key as keyof Settings] === value))
      )
        return;
      confirmed = { ...next };
      current = { ...next };
      publish();
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
