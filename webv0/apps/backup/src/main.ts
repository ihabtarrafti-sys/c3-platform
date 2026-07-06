/**
 * main.ts — the Railway cron entrypoint. Validates env, wires real adapters,
 * runs one backup, and exits 0 ONLY on full success (non-zero on any failure).
 * Terminates after each run — no long-running process.
 */
import { loadEnv } from './env';
import { createBackupDeps } from './adapters';
import { runBackup } from './runner';

async function main(): Promise<void> {
  const env = loadEnv();
  const deps = createBackupDeps(env);
  try {
    const result = await runBackup(env, deps);
    deps.log('backup.success', {
      key: result.primaryKey,
      classes: result.classes,
      encryptedBytes: result.encryptedBytes,
      plaintextBytes: result.plaintextBytes,
      durationMs: result.durationMs,
    });
  } finally {
    await deps.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(JSON.stringify({ level: 'error', event: 'backup.failed', message: (err as Error).message }));
    process.exit(1);
  },
);
