import { loadBackendEnv } from './config/env.ts';
import { createDataStore } from './db/store.ts';
import { createBackendApp } from './app.ts';

async function main() {
  const env = loadBackendEnv();
  const store = await createDataStore(env.mongodbUri);
  const app = createBackendApp({ store, env });

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`[kora-backend] Listening on http://0.0.0.0:${env.port} (db: ${store.mode})`);
  });
}

main().catch((err) => {
  console.error('[kora-backend] Fatal startup error:', err);
  process.exit(1);
});
