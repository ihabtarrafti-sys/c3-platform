# R4-N09 lock-queue drill — the executable hosted ceremony (HARDEN-3.5 Batch E)

**What this certifies:** the production backup's behavior when a DDL (ACCESS EXCLUSIVE) queues
behind the exporter's snapshot transaction: `pg_dump --lock-wait-timeout` fails FAST, the wrapper
retries a **bounded three attempts**, and the run ends in a **terminal refusal** — never an
indefinite hang. This phase is deliberately a FAILED backup; the successful weekly backup +
restore (R4-N04) is a **separate phase, run afterwards**, never the same flow.

**Where it runs:** the hosted environment (Railway/staging) where `pg_dump`/`pg_restore`/`age`
exist. Sentinel round-6 §5 ruled the previous plan DRILL-CERTIFIED-UNSOUND for lacking exactly
this deterministic staging; the `BACKUP_PAUSE_AFTER_CENSUS` hook (coherentFlow.ts,
`resolveCensusPause` — inert by default, tested inert) provides it.

**Operator setup:** two `psql` sessions on the staging database (call them `S1` = observer,
`S2` = DDL), plus the ability to run the backup job with a one-off env var.

---

## Phase 1 — the lock-queue refusal (deliberately failed backup)

1. **Arm the pause and start the backup** (one-off env on the backup job):

   ```
   BACKUP_PAUSE_AFTER_CENSUS=120  npm run backup   # (or the Railway one-off job equivalent)
   ```

   Watch the job log for the drill-window line:

   ```
   {"event":"backup.census_pause","seconds":120,"note":"R4-N09 drill window OPEN — queue the DDL now"}
   ```

2. **Queue the DDL behind the exporter** — in `S2`, the moment the window line appears:

   ```sql
   -- S2: an ACCESS EXCLUSIVE that must WAIT behind the exporter's open snapshot tx
   ALTER TABLE person ADD COLUMN drill_r4n09 boolean;
   ```

   (It blocks — do not cancel it.)

3. **Observe the queue from `S1`** (both facts must hold before the pause ends):

   ```sql
   -- S1: the DDL is WAITING on a lock…
   SELECT pid, wait_event_type, state, left(query, 60) AS q
     FROM pg_stat_activity
    WHERE query ILIKE 'ALTER TABLE person ADD COLUMN drill_r4n09%';
   -- expect: wait_event_type = 'Lock', state = 'active'

   -- …behind the stable exporter session. Replace <S2_PID> with the DDL pid above.
   SELECT a.pid, a.state,
          a.backend_xid IS NOT NULL OR a.backend_xmin IS NOT NULL AS holds_snapshot,
          left(a.query, 60) AS q
     FROM pg_stat_activity AS a
    WHERE a.application_name = 'c3-backup-exporter'
      AND a.state IN ('idle in transaction','active')
      AND a.pid = ANY(pg_blocking_pids(<S2_PID>));
   ```

   Record both `pid`s in the drill log.

4. **Let the pause expire** (`backup.census_pause_end` appears) → the real `pg_dump
   --snapshot=<id> --lock-wait-timeout=60000` starts and queues BEHIND the DDL on `person`.
   **Assert, from the job log:**
   - attempt 1 fails with a lock-wait/`could not obtain lock` error after ~60 s;
   - `{"event":"backup.pg_dump_lock_retry","attempt":1}` then `attempt":2` appear —
     **exactly two retry lines** (three attempts total);
   - the job ends in a **terminal refusal** (non-zero exit, no manifest uploaded — verify no new
     `daily/` object appeared for this run);
   - **max elapsed** for the dump phase ≈ 3 × 60 s + pause ≤ ~7 minutes — record the timestamps.

5. **Clean up** — in `S2` (the blocked ALTER will have either timed out per your session
   settings or still be waiting):

   ```sql
   -- S2: cancel if still waiting, then remove any applied drill column
   -- (Ctrl+C / SELECT pg_cancel_backend(<S2 pid>); from S1)
   ALTER TABLE person DROP COLUMN IF EXISTS drill_r4n09;
   ```

   Confirm from `S1` that no `drill_r4n09` column exists and no lock remains.

## Phase 2 — the successful weekly backup + restore (R4-N04, separate flow)

6. **Unset `BACKUP_PAUSE_AFTER_CENSUS`** (the hook is inert when absent — proven by test) and run
   the normal backup on a Sunday-schedule invocation (or force the weekly copy). Confirm the
   `weekly/` manifest + dump + blob archive trio uploaded.
7. Run the restore drill against the WEEKLY manifest with the live documents bucket assumed lost:

   ```
   RESTORE_MANIFEST_KEY=weekly/<manifest-key>  npm run restore
   ```

   **Assert:** the drill completes; `restore.blob_recovery_verified` lists EVERY non-empty class
   (document, photo, intake); fixtures verified; the disposable drill DB was dropped.
8. File both phases' logs (window line, queue observation pids, retry lines, terminal refusal,
   elapsed bounds, weekly restore report) in the drill register.

---

**Inertness guarantee:** production runs never set `BACKUP_PAUSE_AFTER_CENSUS`; `resolveCensusPause`
returns `null` and the flow contains no pause step (unit-proven: the inert ordering is
byte-identical, and a mistyped value refuses the backup loudly rather than running ambiguous).
