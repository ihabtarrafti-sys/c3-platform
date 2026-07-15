# C3 HARDEN-3.7 — Status

**State:** U1–U8 and Batch E are implemented, RED-falsified, restored, and locally verified.
Batch J cannot satisfy its own finite-retirement acceptance under the accepted provider model, so
it stopped at the specification wall in `C3-HARDEN-3.7-ESCALATION.md`; migration 0078 was not
invented. The owner-authored residual-risk register is untouched, and this record does not make a
round-9 declaration. Final push and remote equality follow this status commit.

## Item map

| Item | State | Main artifacts |
|---|---|---|
| J | Escalated and stopped; no GREEN or cost bound claimed | `C3-HARDEN-3.7-ESCALATION.md`; J row and day-8 falsifier in `C3-HARDEN-3.7-EVIDENCE.md` |
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
- This final status/verification commit is created after gate ×2 and e2e; its hash is reported in the external handoff rather than predicted here.

## Migration map

- No migration was added or changed in this wave. Migration 0077 remains immutable and is the latest migration.
- Migration 0078 is deliberately absent because J stopped under the escalation rule. `C3-HARDEN-3.7-ESCALATION.md` records the provider-legal schedule that defeats finite authority retirement.

## Verification record

- U1–U8 focused aggregate: GREEN, 7 files / 29 tests, covering the four U1 routes, U2, both U3 races, U4, U5, U6, U7, and U8.
- Expanded U1/U4 real-route suite: GREEN, 6/6 tests.
- Immutable-0077 populated dirty-data preflight: GREEN, 1/1 focused test from a real from-0076 database.
- Final strengthened U2/U4/U6 run: `npx vitest run --project api --project persistence uploadLease transactionDeadline` — GREEN, 2 files / 15 tests in 33.91s.
- `npm run typecheck`: GREEN, all 9 projects.
- Evidence audit: all 113 cited path/range references resolved within their files; an independent read-only claim audit found no concrete blocker after corrections.
- `npm run gate` pass 1: GREEN / `webv0 gate: PASSED`; 573 tracked files passed the NUL/truncation audit, all 9 typecheck projects passed, 115 test files / 899 tests passed (Vitest 853.14s; command wall 933.7s), and 16 emitted production-bundle files passed the dev-auth exclusion check.
- `npm run gate` pass 2: GREEN / `webv0 gate: PASSED`; the same 573-file audit, 9 projects, 115 test files / 899 tests (Vitest 830.59s; command wall 897.1s), and 16-file production-bundle check passed independently.
- `npm run e2e`: GREEN, 25/25 Playwright tests in 9.8m (command wall 591.5s), including the protected `webv0/apps/web/e2e/addPerson.spec.ts` unchanged.

The exact production neuters, observed RED failures, restored results, globally bounded claims,
falsification attempts, Round-8 corrections, and cost envelopes are recorded in
`C3-HARDEN-3.7-EVIDENCE.md`.

## Reviewer notes

- J remains a genuine acceptance wall, not an implementation difficulty: retiring the last prefix authority after seven days cannot detect a provider-legal day-8 publication when the provider publishes no maximum post-abort latency. No J GREEN, 0078, janitor window, or residual-register truth claim exists.
- U1's RED run restored all four old PUT placements together; each route failed at its own exact-row assertion. The evidence does not misdescribe those as four independent neuter runs.
- U2's final discriminator observes both halves in one outcome: removing controller abort yields `{ aborted:false, closeOutcome:'still-open' }` instead of `{ aborted:true, closeOutcome:'closed' }`.
- U3's first broad interceptor produced a false-green neuter and is excluded from evidence. The narrowed interceptor then made both production neuters RED.
- U4 is opt-in signal gating plus a positive safe-integer 10,000ms default checkout bound. Compensation intentionally does not opt in, and no cancellation-after-callback claim is made.
- U5 observes the actual production snapshot/census connection through `createBackupDeps`, not only the advisory client.
- U8 preserves the original acquisition error by identity when teardown succeeds; no competing setup/teardown-error claim is made.

`C3-RESIDUAL-RISK-REGISTER.md` and `webv0/apps/web/e2e/addPerson.spec.ts` were not modified.
Pre-existing unrelated untracked files `HARDEN-3-TRIAGE.md`, `HARDEN3-CLOSEOUT.md`, and
`ROUND1-FINDINGS.md` were left untouched; they are not HARDEN-3.7 residue.
