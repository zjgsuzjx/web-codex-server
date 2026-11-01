import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppError } from '../shared/contracts/errors.ts';
import { createApp } from './app.ts';
export { createApp } from './app.ts';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile();
  } catch (caughtError) {
    const e = caughtError as AppError;
    if (e.code !== 'ENOENT') throw e;
  }
  if (process.env.COOKIE_SECURE === 'true' && !process.env.INVITE_CODE)
    throw new Error('Production requires INVITE_CODE');
  const instance = await createApp();
  instance.server.listen(Number(process.env.PORT || 3100), '0.0.0.0', () =>
    console.log(`Starvalley Codex listening on :${process.env.PORT || 3100}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await instance.close();
      process.exit(0);
    });
}
