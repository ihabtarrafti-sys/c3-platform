# C3 HARDEN-3.6 — Status

**State:** Neural selected Option 1 and the revised T1 acceptance is built. Full finish-line
verification is in progress. No round-8-ready claim is made.

## Item map

| Item | State | Main artifacts |
|---|---|---|
| T1 | Built + composed GREEN/RED proof + c3_app discriminator | `blobBundle.ts`; `exitUploadSafety.test.ts`; `db.test.ts` |
| T2 | Built + GREEN/RED proof | API lease lifecycle; `exitUploadSafety.test.ts` |
| T3 | Built + GREEN/RED proof | migration `0077`; `db.test.ts` real-role discriminator |
| T4 | Built + focused GREEN/RED proof | signal propagation; application/store claim gates; `claimDeadline.test.ts` |
| T5 | Built + GREEN/RED proof | `storage.ts`; `storageTimeout.test.ts` |
| T6 | Built + causal GREEN/RED proof | abort hook/causal mapping; `deadlineCausality.test.ts` |
| T7 | Built + exact-SQL GREEN/RED proof | backup adapter, runbook, DB observer test |
| T8 | Built + GREEN/RED proof | `migrate.ts`; throwing-logger lock-count test |
| T9 | Written | corrections in `C3-HARDEN-3.6-EVIDENCE.md` |

## Migration map

- `0077_tombstone_state_timestamp_coupling.sql`: preflight + bidirectional CHECK + trigger-level timestamp/state transition coupling.

## Verification record

- `npm run typecheck`: GREEN, all 9 projects.
- Focused T1: composed real route 1/1 GREEN; c3_app resolver 1/1 GREEN; unconditional-arm RED observed and restored.
- Complete focused set after correcting three legacy timestamp-only fixtures: 7 files / 109 tests GREEN (`exitUploadSafety`, `uploadLease`, `claimDeadline`, `deadlineCausality`, `storageTimeout`, full `db.test`, `coherentFlow`).
- Required full gate ×2 and e2e: pending below; results are recorded only after execution.

## Cost envelopes

- T1: exit parks no longer than the remaining prepared TTL (14 minutes at defaults); an expiry-boundary row can require one immediate rerun.
- T2: failed upload retains its lease until natural expiry, parking exit for at most the remaining lease TTL (15 minutes at defaults); committed claims release immediately.

## Round-8 handoff warning

Do not treat this document as a round-8 declaration. Neural reviews T1/T2 and the T3 discriminator;
Sentinel independently verifies cold after the recorded gate/e2e/push finish line.
