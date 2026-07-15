# C3 HARDEN-3.8 — Status

**State:** H1–H6 and Batch E are implemented, RED-falsified against the named real
counter-edges, restored, and verified on committed checkpoint `ccea8bb`. Two full gates and the
full e2e suite are GREEN on that unchanged checkpoint. This status commit, final push, and remote
equality follow this record. No round-10, deployment, owner-signature, or unconditional-liveness
claim is made here.

## Item map

| Item | State | Main artifacts |
|---|---|---|
| H1 | Built + real privileged live-authority COMMIT RED + finalize atomicity proof. Transparent global-invariant follow-ups cover later tenant resurrection, same-UUID opposite-side `READ COMMITTED` commits, and the pinned-snapshot `REPEATABLE READ` live-join edge. | migrations 0079, 0081–0083; `webv0/packages/persistence/test/db.test.ts`; `webv0/apps/api/test/erasureJanitor.test.ts` |
| H2 | Built + direct cyclic-token RED, composed owned-row cycle/retry RED, non-cooperative idle-progress RED, and checkout-accounting RED. | `webv0/apps/api/src/storage.ts`; `webv0/apps/api/src/erasureJanitor.ts`; `webv0/apps/api/test/storageTimeout.test.ts`; `webv0/apps/api/test/erasureJanitor.test.ts` |
| H3 | Built + production `createBackupDeps` hostile-URL blocker-observer RED. | `webv0/apps/backup/src/adapters.ts`; `webv0/apps/backup/test/censusSnapshot.test.ts` |
| H4 | Built + active-owner and cross-instance locked-row REDs; endpoint and frozen contract expose `incomplete`. | `webv0/apps/api/src/erasureJanitor.ts`; `webv0/apps/api/src/app.ts`; `webv0/apps/api/contract/v1.json`; `webv0/apps/api/test/erasureJanitor.test.ts` |
| H5 | Built + missing-append RED, audit-failure rollback proof, fixed-shape/ACL hostile probes, and privileged UPDATE/DELETE/TRUNCATE refusal. | migration 0080; `webv0/apps/api/src/erasureJanitor.ts`; API and persistence janitor tests |
| H6 | Built + boot-readiness budget RED and capacity qualification. | `webv0/apps/api/src/erasureJanitor.ts`; `webv0/apps/api/src/env.ts`; `webv0/apps/api/src/server.ts`; env/janitor tests |
| E | Written and cold-audited after the final counter-edges. Round-9's three false rows and four inadequate notes are replaced with globally bounded, line-cited claims and falsification records. | `C3-HARDEN-3.8-EVIDENCE.md`; this status record |

## Commit map

- `4c4cab1` — `HARDEN-3.8 H1 (R9-N01): enforce dead-only erased authority`.
- `fa84040` — `HARDEN-3.8 H3 (R9-N03): pin exporter session identity`.
- `53e4026` — `HARDEN-3.8 H2 (R9-N02): fail closed on pagination cycles`.
- `bcb3bcc` — `HARDEN-3.8 H5 (RR-01): add durable straggler audit gateway`.
- `b694af3` — `HARDEN-3.8 H2/H4/H5/H6 (R9 tail): bound and expose janitor progress`.
- `376fd4b` — `HARDEN-3.8 H4 (R9-N05): make owner coalescing RED teardown-safe`, a transparent test-safety follow-up.
- `3c4398c` — `HARDEN-3.8 H4 (R9-N05): align incomplete contract wording`, a truthful source-comment follow-up.
- `dbec83d` — `HARDEN-3.8 E (R9 evidence): record global claims and counter-edges`.
- `d2e3182` — `HARDEN-3.8 H1 (R9-N01): seal dead-only authority both directions`, the transparent 0081/0082 inverse-write and concurrent-COMMIT follow-up.
- `ccea8bb` — `HARDEN-3.8 H1/H5 (global evidence): close isolation and audit counter-edges`, the transparent 0083 pinned-snapshot/preflight and H5 durability follow-up.
- The final status/verification commit is created after gate ×2 and e2e; its hash is reported in the external handoff rather than predicted here.

## Migration map

- All applied migrations through 0078 remain immutable.
- `0079_erased_tenant_prefix_dead_only.sql`: authority-side `DEFERRABLE INITIALLY DEFERRED` dead-only constraint trigger; canonical authority for a live tenant is refused at COMMIT while finalize's insert-then-erase transaction passes.
- `0080_platform_erasure_audit.sql`: narrowly shaped tenant-independent durable audit gateway for `post_finalize_erasure_straggler_caught`, retaining the audit table's FK/RLS posture.
- `0081_erased_tenant_prefix_no_resurrection.sql`: tenant-side deferred guard; a permanent authority UUID cannot later be recreated or retargeted as live.
- `0082_erased_tenant_prefix_dead_only_serialization.sql`: common same-UUID transaction advisory serialization in both guards for opposite-side `READ COMMITTED` commits.
- `0083_erased_tenant_prefix_isolation_guard.sql`: table lock + live-join preflight before function replacement; non-`READ COMMITTED` invariant writes are refused rather than evaluated through a stale snapshot.

0081–0083 are disclosed follow-ups, not hidden scope: falsifying the global “authority is dead-only”
claim exposed the reverse-write, concurrent-COMMIT, and alternate-isolation extensions that 0079
alone did not prove.

## Verification record

- Final H1/H5 persistence focus: **GREEN**, 4/4 real-PostgreSQL tests. The restored same-UUID pinned-snapshot schedule refuses both `REPEATABLE READ` COMMITs; with only the 0083 predicate neutered, both COMMITs fulfilled and the RED database state was `{tenant_exists:true, authority_exists:true, live_join:true}`.
- Final composed H1 API focus: **GREEN**, 1/1. The real privileged canonical live-tenant authority INSERT is refused at COMMIT and the live object remains.
- H2/H4/H6 focused checkpoint: **GREEN**, 4 files / 36 tests. H3 hostile-URL focus and H5 gateway/atomicity focuses are also GREEN; exact neuters and failures are in `C3-HARDEN-3.8-EVIDENCE.md`.
- Final `npm run typecheck`: **GREEN**, all 9 projects after every RED restoration and the final test rewrite.
- Nonqualifying full-gate history: on pre-follow-up checkpoint `d2e3182`, the audit and all 9 typechecks passed, then Vitest ended after 821.58 s with worker RPC timeouts (`Timeout calling "onTaskUpdate"` and cascading worker notifications), 56/57 files and 537/543 tests reported passed, and no assertion failure. The last associated `seedStaging.test.ts` then passed focused 6/6 in 10.47 s after orphaned embedded-test PostgreSQL workers were removed. That harness-failed run is not counted.
- `npm run gate` qualifying pass 1 on committed checkpoint `ccea8bb`: **GREEN** in 1067 s command wall time. NUL/truncation audit: 581 tracked files clean; typecheck: 9/9 projects; tests: 116/116 files and 920/920 tests (1002.73 s Vitest); Entra production bundle: 16 emitted files free of dev-auth material.
- `npm run gate` qualifying pass 2 on unchanged `ccea8bb`: **GREEN** in 971.9 s command wall time. The same 581-file audit, 9/9 typechecks, 116/116 files and 920/920 tests (904.51 s Vitest), and 16-file production-bundle check passed independently.
- `npm run e2e` on unchanged `ccea8bb`: **GREEN**, 25/25 Playwright tests in 9.6 minutes (580.4 s command wall time), including the protected `webv0/apps/web/e2e/addPerson.spec.ts`.
- The protected e2e file's current Git blob is `b7141c219a0a67a4135a3255a687acde895a108d`, identical to baseline `8ccdce9`.

## Capacity and availability bounds

- H1's same-UUID deferred advisory lock has no coded timeout. A waiter can park for the remaining lifetime of the earlier same-key transaction. Non-`READ COMMITTED` tenant/authority identity writes are refused at COMMIT, including otherwise non-conflicting writes.
- H2's 120,000 ms default is an **idle storage-progress** bound while a row is owned, not a total row, pass, or PostgreSQL-cleanup wall-clock bound. Valid list/delete progress rearms it; lock release after a storage deadline remains conditional on database cleanup making progress.
- H4 explicitly returns `incomplete:true` for an active owner pass or a remotely locked/failed row. Interval-to-owner queues one fresh same-process pass, but its total duration has no numeric ceiling.
- H6 starts the boot safety pass before listen and waits up to 30,000 ms by default, configurable only to a positive value no greater than 300,000 ms. On budget expiry the pass remains active and observed, a structured warning is emitted, and the interval is armed. This is an event-loop-scheduled readiness budget, not a total sweep/startup/shutdown wall-clock bound.
- Permanent authority provides retry eligibility, not unconditional destruction time. Object lifetime remains conditional on finite outages and eventual API, PostgreSQL, and R2 progress; cadence, overlap, event-loop delay, and pass duration are additive and have no fixed numeric ceiling.

## Reviewer notes

- Neural authored and rewrote `C:\Projects\C3-RESIDUAL-RISK-REGISTER.md`; this wave did not edit it. Its final observed SHA-256 is `412A0BFC9B66861934B73F31C6A21FAED6C80D7EF8F96E222B44A0DCC90125CE`. H5 now supplies the durable `audit_event` mechanism behind its monitoring line.
- Round-9 banked items were left untouched. No HARDEN-3.8 escalation file was required.
- The two qualifying gates emitted the existing AWS SDK future Node-support warning under Node 18.19.1; it did not fail any gate stage.
- Pre-existing unrelated untracked files `HARDEN-3-TRIAGE.md`, `HARDEN3-CLOSEOUT.md`, and `ROUND1-FINDINGS.md` remain untouched and are not HARDEN-3.8 residue.
- Stop condition remains the triage finish line: push, prove local HEAD equals origin, and stop. Neural and Sentinel own the next review; this record does not declare round 10.
