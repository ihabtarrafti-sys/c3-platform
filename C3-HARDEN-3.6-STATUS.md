# C3 HARDEN-3.6 — Status

**State:** Neural selected Option 1, the revised T1 acceptance is built, and local finish-line
verification is complete. Final push and remote equality follow this status commit. No
round-8-ready claim is made.

## Item map

| Item | State | Main artifacts |
|---|---|---|
| T1 | Built + two composed RED falsifications + c3_app discriminator | `webv0/packages/persistence/src/blobBundle.ts`; bounded post-abort staff cleanup; `webv0/apps/api/test/exitUploadSafety.test.ts`; `webv0/packages/persistence/test/db.test.ts` |
| T2 | Built + composed GREEN/RED proof | API lease lifecycle; `webv0/apps/api/test/exitUploadSafety.test.ts` |
| T3 | Built + GREEN/RED proof | `webv0/packages/persistence/migrations/0077_tombstone_state_timestamp_coupling.sql`; `webv0/packages/persistence/test/db.test.ts` |
| T4 | Built + focused GREEN/RED proof | per-site signal propagation; application/store claim gates; `webv0/apps/api/test/claimDeadline.test.ts` |
| T5 | Built + GREEN/RED proof | `webv0/apps/api/src/storage.ts`; `webv0/apps/api/test/storageTimeout.test.ts` |
| T6 | Built + hook-path and causal GREEN/RED proofs | `webv0/apps/api/test/uploadLease.test.ts`; `webv0/apps/api/test/deadlineCausality.test.ts` |
| T7 | Built + exact-SQL GREEN/RED proof | `webv0/apps/backup/src/adapters.ts`; `webv0/docs/runbooks/R4-N09-lock-queue-ceremony.md`; `webv0/packages/persistence/test/db.test.ts` |
| T8 | Built + GREEN/RED proof | `webv0/packages/persistence/src/migrate.ts`; `webv0/packages/persistence/test/db.test.ts` |
| T9 | Written + final verification recorded | corrections in `C3-HARDEN-3.6-EVIDENCE.md`; this verification record |

## Commit map

- `e55d4e915b05a92a84d17f1c01e95ae29d99679f` — `HARDEN-3.6 T2-T9 (R7 tail): close mechanical fixes; escalate T1 wall`.
- `f513a56` — `HARDEN-3.6 T1 (R7-N01): park exit on live prepared producers`, implementing Neural's Option-1 ruling.
- `d604d4e` — `HARDEN-3.6 T1 (R7-N01): bound post-deadline cleanup`, the transparent follow-up closing the pre-aborted R2 DELETE gap found while falsifying the evidence claim.
- `3c88a9b` — `HARDEN-3.6 T9 (R7 evidence): correct global claims and narratives`.
- `277331b` — `HARDEN-3.6 T6 (R7-N07): prove client-abort timer cleanup`.
- The final evidence/verification commit is created after gate ×2 and e2e; its hash is therefore reported in the final handoff rather than predicted here.

## Migration map

- `webv0/packages/persistence/migrations/0077_tombstone_state_timestamp_coupling.sql`: preflight + bidirectional CHECK + trigger-level timestamp/state transition coupling.

## Verification record

- `npm run typecheck`: GREEN, all 9 projects (79.5s) after the T6 discriminator and final truthfulness edits.
- T1 bounded-cleanup GREEN: focused composed route 1/1. Cleanup RED: returning the original aborted signal left one tenant key while registered rows remained zero; restored.
- T6 client-abort hook RED: with only the production `onRequestAbort` hook removed, the later real-hook probe observed the exact request timer but `clearedInsideAbortHook` was false; restored GREEN.
- Final complete focused set: GREEN, 7 files / 110 tests in 277.99s (`exitUploadSafety`, `uploadLease`, `claimDeadline`, `deadlineCausality`, `storageTimeout`, full `db.test`, `coherentFlow`).
- `npm run gate` pass 1: GREEN / `webv0 gate: PASSED`; 569 tracked files passed the NUL/truncation audit, all 9 typecheck projects passed, 111 test files / 879 tests passed (Vitest 1328.98s; command wall 1431.5s), and 16 emitted production-bundle files passed the dev-auth exclusion check.
- `npm run gate` pass 2: GREEN / `webv0 gate: PASSED`; the same 569-file audit, all 9 typecheck projects, 111 test files / 879 tests (Vitest 1203.32s; command wall 1301.6s), and 16-file production-bundle check passed independently.
- `npm run e2e`: GREEN, 25/25 Playwright tests in 11.1m (command wall 672.1s), including the protected `webv0/apps/web/e2e/addPerson.spec.ts` unchanged.

## Cost envelopes

- T1: a prepared row's blocking condition lasts at most its remaining TTL (14 minutes at defaults; two-hour configured absolute cap) and may end earlier if the owner resolves/arms it. This is acceptable because a prepared producer may still own bytes. Sweep refuses rather than auto-resuming, so wall-clock completion also includes operator rerun delay; that human delay is not code-bounded. A row expiring between arm and census needs one immediate rerun. R2 post-abort cleanup has an independent 120-second cap and adds no further exit park in the composed schedule.
- T2: every noncommitted outcome after lease acquisition keeps the publication fence live until the remaining lease TTL (15 minutes at defaults; two-hour configured cap), including validation/no-byte failures. This is acceptable only when the lease overlaps a noncommitted guest attempt because it fences indeterminate remote publication. The default per-attempt drain timeout is 60 seconds (caller-configurable); it proceeds as soon as no live lease remains and otherwise refuses at that timeout. Wall-clock completion additionally depends on an operator rerun and is not code-bounded. A committed claim attempts early release; release failure falls back to TTL.

## Round-8 handoff warning

Do not treat this document as a round-8 declaration. Neural reviews T1/T2 and the T3 discriminator;
Sentinel independently verifies cold after the recorded gate/e2e/push finish line.

Pre-existing unrelated untracked files `HARDEN-3-TRIAGE.md`, `HARDEN3-CLOSEOUT.md`, and
`ROUND1-FINDINGS.md` were left untouched; they are not HARDEN-3.6 wave residue.
