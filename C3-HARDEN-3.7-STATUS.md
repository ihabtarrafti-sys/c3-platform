# C3 HARDEN-3.7 — Status

**State:** Neural's ruling superseded finite J with J′: permanent authority plus the API as
boot/daily/owner scheduler. J′, migration 0078, U1–U8, and Batch E are implemented,
RED-falsified, restored, and focused-GREEN. The ruling/register's cadence formula and unqualified
“next pass” claim are stopped in `C3-HARDEN-3.7-ESCALATION.md`; they are not silently certified
here. On the same committed implementation/evidence checkpoint, full gate ×2 and e2e are GREEN
as recorded below. The owner-authored residual-risk register is untouched, and this record makes
no round-9 declaration. Final push and remote equality follow the final verification commit.

## Item map

| Item | State | Main artifacts |
|---|---|---|
| J′ | Mechanism built under Neural's ruling: permanent 0078 authority, atomic finalize arming, complete two-prefix janitor, API boot/daily/owner scheduling, monitoring, live isolation, and real FS/R2 drivers. Cadence arithmetic is escalated separately. | `webv0/packages/persistence/migrations/0078_erased_tenant_prefix.sql`; `webv0/packages/persistence/src/exitTenant.ts`; `webv0/apps/api/src/erasureJanitor.ts`; `webv0/apps/api/test/erasureJanitor.test.ts`; J′ claims/REDs/cost in `C3-HARDEN-3.7-EVIDENCE.md` |
| U1 | Built + four real-route rejection/drain RED proofs | `webv0/apps/api/src/app.ts`; `webv0/apps/api/test/staffUploadAbortCompensation.test.ts` |
| U2 | Built + composed inbound-disconnect/outbound-R2-socket RED proof | `webv0/apps/api/src/app.ts`; `webv0/apps/api/test/uploadLease.test.ts` |
| U3 | Built + two real-PostgreSQL race RED proofs | `webv0/packages/persistence/src/blobBundle.ts`; `webv0/packages/persistence/test/sweepCensusRace.test.ts` |
| U4 | Built + real queued-route, transaction, checkout, and zero-bound RED proofs | staff pre-registration wiring; `webv0/packages/persistence/src/tenantContext.ts`; `webv0/packages/persistence/src/stores.ts`; focused route/persistence tests |
| U5 | Built + production-wired blocker-observer RED proof | `webv0/apps/backup/src/adapters.ts`; `webv0/apps/backup/test/censusSnapshot.test.ts` |
| U6 | Built + causal-error and three-site wording RED proofs | `webv0/apps/api/src/app.ts`; `webv0/apps/api/test/uploadLease.test.ts` |
| U7 | Built + exact depth/cycle RED proof | `webv0/apps/api/src/app.ts`; `webv0/apps/api/test/deadlineCausality.test.ts` |
| U8 | Built + SET/lock acquisition cleanup RED proofs | `webv0/packages/persistence/src/migrate.ts`; `webv0/packages/persistence/test/migrateEarlyCleanup.test.ts` |
| E | Written and audited | `C3-HARDEN-3.7-EVIDENCE.md`; this verification record |

## Commit map

- `76da923` — `HARDEN-3.7 J (RR-01): escalate finite janitor authority wall`.
- `b7baa1b` — `HARDEN-3.7 U3 (R8-N04): recensus before mutation and count matched sweeps`.
- `2f0c3cd` — `HARDEN-3.7 U8 (R8-N09): close migrator acquisition failures`.
- `79d75e9` — `HARDEN-3.7 U5/E (R8-N06): observe production exporter and persist preflight probe`.
- `982bac9` — `HARDEN-3.7 U1/U2/U4/U6/U7 (R8 tail): close abort and deadline edges`.
- `0230e08` — `HARDEN-3.7 E/U2/U4/U6 (R8 evidence): harden discriminators and global claims`, the transparent follow-up that strengthened the U2 composed observation, made a zero checkout bound invalid instead of unbounded, and split the global U6 wording proof.
- `52786a4` — `HARDEN-3.7 E (verification): record gate x2 and e2e`, the pre-ruling verification record retained as history.
- `b0ae4b9` — `HARDEN-3.7 J (RR-01 ruling): retain authority and schedule permanent janitor`.
- `7d09ee0` — `HARDEN-3.7 J (RR-01 ruling): make lock RED teardown-safe`, the transparent follow-up that guarantees the concurrent-instance discriminator releases its blocked owner even when a RED assertion fails and removes migration EOF whitespace.
- `8e3fd29` — `HARDEN-3.7 U4 (R8-N05): stabilize real checkout discriminator`, the test-only follow-up that replaces a full-gate-flaky 100 ms physical-connection/setup bound with a 2,000 ms saturated-checkout bound, still below the API's 30,000 ms deadline floor and RED at the 6,000 ms sentinel when timeout enforcement is removed.
- This final status/verification commit is created after gate ×2 and e2e; its hash is reported in the external handoff rather than predicted here.

## Migration map

- 0077 remains immutable.
- Added `0078_erased_tenant_prefix.sql`: permanent, FK-free, non-RLS dead-prefix authority; canonical prefix checks; no expiry/retirement path; `c3_app` global SELECT plus telemetry-column UPDATE only; `c3_backup` SELECT; application INSERT/DELETE denied.

## Verification record

- J′ database focus: GREEN, 2/2 real-PostgreSQL tests (0078 catalog/grants/canonical posture and forced finalize rollback/success atomicity).
- J′ API focus: GREEN, 7/7 tests (real-finalize day-8 owner/boot/interval schedule, live isolation, close behavior, owner-active race, partial-failure auditing, in-pass publication, multi-instance lock, no-retirement inventory, and real paginated R2 DeleteObject wiring).
- Restored expanded API focus: GREEN, 6 files / 48 tests: J′, env bounds, frozen contract, U1/U4 staff abort compensation, exit/upload composition, and production R2 abort regressions.
- `npm run typecheck`: GREEN, all 9 projects after all RED restorations.
- J′ RED register: 14 production neuters produced the exact failures recorded in `C3-HARDEN-3.7-EVIDENCE.md`; all were restored before the GREEN runs.
- Excluded launcher: an initial `npm run gate` process exited `-1073741205` before emitting any gate output; it is not a gate attempt or success.
- Unsuccessful full-gate attempt A: NUL audit and all 9 typechecks passed, then 115/116 files and 908/909 tests passed; U4's 100 ms discriminator failed at its initial holder `pool.connect()` before saturation with `Connection terminated due to connection timeout`. It is not counted.
- The exact U4 test then passed focused 1/1, but unsuccessful full-gate attempt B reproduced the same setup-only line-75 failure after 827.1 s with the same 115/116-file and 908/909-test totals. This proved the 100 ms setup bound was not a reliable full-gate discriminator; it is not counted.
- U4 test-only stabilization: configured bound 2,000 ms; focused GREEN completed the saturated checkout in 2.04 s. With production timeout mapping set to zero, focused RED remained `still-pending` at 6,000 ms; after restoration, focused GREEN completed in 2.03 s and reused the pool successfully.
- `npm run gate` qualifying pass 1 on committed checkpoint `c72bc5f`: **GREEN** in 842.5 s wall time. NUL/truncation audit: 576 tracked files clean; typecheck: 9/9 projects; tests: 116/116 files and 909/909 tests; Entra production bundle: 16 emitted files free of dev-auth material.
- `npm run gate` qualifying pass 2 on unchanged `c72bc5f`: **GREEN** in 730.3 s wall time. NUL/truncation audit: 576 tracked files clean; typecheck: 9/9 projects; tests: 116/116 files and 909/909 tests; Entra production bundle: 16 emitted files free of dev-auth material.
- `npm run e2e` on unchanged `c72bc5f`: **GREEN**, 25/25 Playwright tests in 7.1 minutes (426.7 s wall time), including the untouched `apps/web/e2e/addPerson.spec.ts`.

The exact production neuters, observed RED failures, restored results, globally bounded claims,
falsification attempts, Round-8 corrections, and cost envelopes are recorded in
`C3-HARDEN-3.7-EVIDENCE.md`.

## Reviewer notes

- The original J escalation remains correct for the superseded finite-retirement spec. Neural conceded both walls and ruled permanent authority plus the API scheduler; `C3-HARDEN-3.7-ESCALATION.md` preserves that history and records the new cadence-arithmetic wall separately.
- `straggler_count` counts distinct key names caught within a pass, not unique-provider-object identity. A retry may observe/count the same still-present key again. The increment commits on successful completion or a caught storage failure while the transaction remains usable; a database/process failure before commit can roll it back. Failure always retains permanent authority.
- Boot catch-up blocks API listen for its full pass. No `max(interval, API downtime)` claim is made here: a 24 h interval, byte just after the prior pass, shutdown at hour 23, and 23 h outage reaches boot at about hour 46, exceeding `max(24 h, 23 h)`. Interval overlap, event-loop delay, pass duration, and failed-pass retry require further qualifiers. This genuine ruling/register wording wall is escalated by file.
- U1's RED run restored all four old PUT placements together; each route failed at its own exact-row assertion. The evidence does not misdescribe those as four independent neuter runs.
- U2's final discriminator observes both halves in one outcome: removing controller abort yields `{ aborted:false, closeOutcome:'still-open' }` instead of `{ aborted:true, closeOutcome:'closed' }`.
- U3's first broad interceptor produced a false-green neuter and is excluded from evidence. The narrowed interceptor then made both production neuters RED.
- U4 is opt-in signal gating plus a positive safe-integer 10,000 ms production-default checkout bound. Its focused saturation discriminator uses 2,000 ms to avoid applying an unrealistically tight 100 ms physical-connection setup timer during the parallel full gate; 2,000 ms remains below the API's 30,000 ms deadline floor. Compensation intentionally does not opt in, and no cancellation-after-callback claim is made.
- U5 observes the actual production snapshot/census connection through `createBackupDeps`, not only the advisory client.
- U8 preserves the original acquisition error by identity when teardown succeeds; no competing setup/teardown-error claim is made.

`C3-RESIDUAL-RISK-REGISTER.md` and `webv0/apps/web/e2e/addPerson.spec.ts` were not modified.
Pre-existing unrelated untracked files `HARDEN-3-TRIAGE.md`, `HARDEN3-CLOSEOUT.md`, and
`ROUND1-FINDINGS.md` were left untouched; they are not HARDEN-3.7 residue.
