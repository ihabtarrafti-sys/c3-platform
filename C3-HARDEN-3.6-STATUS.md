# C3 HARDEN-3.6 — Status

**State:** STOPPED short of the finish line because T1 has a genuine acceptance/spec wall.
See `C3-HARDEN-3.6-ESCALATION.md`. No round-8-ready claim is made.

## Item map

| Item | State | Main artifacts |
|---|---|---|
| T1 | Escalated, uncommitted | `C3-HARDEN-3.6-ESCALATION.md` |
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
- Focused API: 4 files / 13 tests GREEN (`storageTimeout`, `deadlineCausality`, `uploadLease`, `exitUploadSafety`).
- Focused T4: 1/1 GREEN.
- Focused persistence T3/T7/migration list: 3/3 GREEN.
- Focused persistence T8: 1/1 GREEN.
- Required full gate ×2 and e2e: **not run** because T1's escalation prevents reaching the triage finish line. They must run only after Neural selects a T1 direction and the composed T1 killer exists.

## Cost envelopes

- T1: exit parks no longer than the remaining prepared TTL (14 minutes at defaults) once the approved predicate is implemented; current item is stopped.
- T2: failed upload retains its lease until natural expiry, parking exit for at most the remaining lease TTL (15 minutes at defaults); committed claims release immediately.

## Round-8 handoff warning

Do not review this as a completed wave. Neural must first choose one T1 direction from the escalation. After that: implement the literal accepted schedule, run its RED proof, rerun all focused tests, gate twice, e2e once, commit/push, and verify HEAD equals origin.
