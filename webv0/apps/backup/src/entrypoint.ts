/**
 * entrypoint.ts — image dispatch. JOB_MODE selects the one-shot job:
 *   - unset / 'backup'  → the daily/manual encrypted backup (main.ts).
 *   - 'restore'         → the restore-certification drill (restore-main.ts).
 * Both jobs terminate the process on completion; neither is long-running.
 */
async function dispatch(): Promise<void> {
  if (process.env.JOB_MODE === 'restore') {
    await import('./restore-main');
  } else {
    await import('./main');
  }
}
void dispatch();
