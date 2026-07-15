# C3 HARDEN-3.6 — Status

**State:** Neural selected Option 1 and the revised T1 acceptance is built. Full finish-line
verification is in progress. No round-8-ready claim is made.

## Item map

| Item | State | Main artifacts |
|---|---|---|
| T1 | Built + two composed RED falsifications + c3_app discriminator | `webv0/packages/persistence/src/blobBundle.ts`; bounded post-abort staff cleanup; `webv0/apps/api/test/exitUploadSafety.test.ts`; `webv0/packages/persistence/test/db.test.ts` |
| T2 | Built + composed GREEN/RED proof | API lease lifecycle; `webv0/apps/api/test/exitUploadSafety.test.ts` |
| T3 | Built + GREEN/RED proof | `webv0/packages/persistence/migrations/0077_tombstone_state_timestamp_coupling.sql`; `webv0/packages/persistence/test/db.test.ts` |
| T4 | Built + focused GREEN/RED proof | per-site signal propagation; application/store claim gates; `webv0/apps/api/test/claimDeadline.test.ts` |
| T5 | Built + GREEN/RED proof | `webv0/apps/api/src/storage.ts`; `webv0/apps/api/test/storageTimeout.test.ts` |
| T6 | Built + causal GREEN/RED proof | abort hook/causal mapping; `webv0/apps/api/test/deadlineCausality.test.ts` |
| T7 | Built + exact-SQL GREEN/RED proof | `webv0/apps/backup/src/adapters.ts`; `webv0/docs/runbooks/R4-N09-lock-queue-ceremony.md`; DB observer test |
| T8 | Built + GREEN/RED proof | `webv0/packages/persistence/src/migrate.ts`; throwing-logger lock-count test |
| T9 | Written; final run totals pending | corrections in `C3-HARDEN-3.6-EVIDENCE.md` |

## Commit map

- `e55d4e915b05a92a84d17f1c01e95ae29d99679f` — `HARDEN-3.6 T2-T9 (R7 tail): close mechanical fixes; escalate T1 wall`.
- `f513a56` — `HARDEN-3.6 T1 (R7-N01): park exit on live prepared producers`, implementing Neural's Option-1 ruling.
- `d604d4e` — `HARDEN-3.6 T1 (R7-N01): bound post-deadline cleanup`, the transparent follow-up closing the pre-aborted R2 DELETE gap found while falsifying the evidence claim.
- The final evidence/verification commit is created after gate ×2 and e2e; its hash is therefore reported in the final handoff rather than predicted here.

## Migration map

- `0077_tombstone_state_timestamp_coupling.sql`: preflight + bidirectional CHECK + trigger-level timestamp/state transition coupling.

## Verification record

- `npm run typecheck`: GREEN, all 9 projects (64.2s) after the T1 cleanup change.
- T1 bounded-cleanup GREEN: focused composed route 1/1. Cleanup RED: returning the original aborted signal left one tenant key while registered rows remained zero; restored.
- Final complete focused set after the bounded-cleanup and wording corrections: 7 files / 109 tests GREEN in 219.26s (`exitUploadSafety`, `uploadLease`, `claimDeadline`, `deadlineCausality`, `storageTimeout`, full `db.test`, `coherentFlow`).
- Required full gate ×2 and e2e: pending; results are recorded only after execution.

## Cost envelopes

- T1: exit parks no longer than the remaining prepared TTL (14 minutes at defaults). A row expiring between arm and second census can require one immediate rerun. R2 post-abort cleanup has an independent 120-second cap and adds no exit park.
- T2: every noncommitted outcome after lease acquisition can park exit until the remaining lease TTL (15 minutes at defaults), including validation/no-byte failures. A committed claim attempts early release; release failure falls back to TTL.

## Round-8 handoff warning

Do not treat this document as a round-8 declaration. Neural reviews T1/T2 and the T3 discriminator;
Sentinel independently verifies cold after the recorded gate/e2e/push finish line.
