# C3 HARDEN-3.6 — Evidence

**Status:** T1 follows Neural's Option-1 ruling. This document records build evidence only;
round-8 readiness remains Sentinel's judgment.

## Claims table

| Item | Globally bounded claim | Citation | Falsification attempt |
|---|---|---|---|
| T1 | Exit arms only expired prepared intents, then parks on any prepared row left by that arm snapshot before listing or deleting storage. | `webv0/packages/persistence/src/blobBundle.ts:228-251` | Removed the expiry predicate: the composed test failed because the first sweep resolved `{ verifiedTombstones: 1 }` instead of rejecting. The second census deliberately has no time predicate, preventing an expiry-between-statements gap; a boundary crossing can cost one immediate rerun, never unsafe deletion. |
| T1 | The composed real staff-document route stalls after pre-registration, observes pre-expiry sweep refusal, then post-expiry sweep+finalize; resume is refused `NOT_FOUND`, registers zero document rows, and leaves both prefixes empty. | `webv0/apps/api/test/exitUploadSafety.test.ts:264-329` | The unconditional-arm RED made the first sweep proceed. The restored test records the actual first defense and asserts the registration-specific `document` count is zero. |
| T1 | The c3_app last-line resolver independently refuses an armed intent with the zombie/registration-aborted message. | `webv0/packages/persistence/test/db.test.ts:35-41,2802-2817`; `webv0/packages/persistence/src/writeTx.ts:1280-1294` | The discriminator uses the app connection, prepares then arms a real row, invokes `resolveCompensationIntent`, and verifies state remains armed. |
| T2 | Guest failure paths retain the upload lease; only an observed committed claim releases early. | `webv0/apps/api/src/app.ts:1914-1918,2039-2045`; `webv0/packages/application/src/ports.ts:1193-1199` | Restored unconditional release: composed test observed `failedLeaseCount: 0`, no exit wait, zero delayed objects swept, and a surviving key after finalize. |
| T2 | The real composed test models local abort followed by delayed remote publication, runs lease drain, sweep, and finalize, and asserts no key remains. | `webv0/apps/api/test/exitUploadSafety.test.ts:174-270` | Same unconditional-release RED stranded `intake/<tenant>/...` after tenant removal. |
| T3 | 0077 preflights existing rows, couples live states to NULL timestamps in both directions, and rejects timestamp-only updates. | `webv0/packages/persistence/migrations/0077_tombstone_state_timestamp_coupling.sql:1-34` | Removed both new guards: the c3_app timestamp-only UPDATE resolved with `rowCount: 1` instead of rejecting. |
| T3 | The discriminator executes as c3_app with tenant context and as admin. | `webv0/packages/persistence/test/db.test.ts:2764-2800` | Neutered 0077 made the first real-role write commit. |
| T4 | Every API storage GET/DELETE site carries the request signal, and claim entry is gated before application dispatch, pool acquisition, BEGIN, and `intake_claim`. | `webv0/apps/api/src/app.ts:680,873,1681,1759,1831,1858,1940,2551`; `webv0/packages/application/src/usecases/intakeOps.ts:295-302`; `webv0/packages/persistence/src/stores.ts:926-933` | Removed the application boundary check: the fired-deadline test reached the fake claim port and failed with an unrelated result-shape error instead of the deadline reason. A claim already in flight may complete; this claim does not promise mid-transaction cancellation. |
| T5 | R2's 120s request timeout is enforcing, not warning-only. | `webv0/apps/api/src/storage.ts:22-27,56` | Removed `throwOnRequestTimeout`: unit failed because the enforcement property was absent. Smithy contract: `node_modules/@smithy/types/dist-types/http/httpHandlerInitialization.d.ts:30-42`. |
| T6 | Client abort clears the same request timer as response/error; 408 mapping requires the surfaced error/cause chain to contain the signal reason. | `webv0/apps/api/src/app.ts:400-413,493-502,615-621` | Replaced causality with signal-state truth: unrelated-error test failed `expected true to be false`. The response no longer says nothing was stored. |
| T7 | The exporter connection has stable application name and the exact runbook query identifies it through `pg_blocking_pids(DDL pid)`. | `webv0/apps/backup/src/adapters.ts:77-79`; `webv0/docs/runbooks/R4-N09-lock-queue-ceremony.md:48-60`; `webv0/packages/persistence/test/db.test.ts:2802-2837` | Removed the application name: exact observer returned `undefined` after 200 polls. |
| T8 | The throwing post-lock logger is inside the client-closing `try/finally`. | `webv0/packages/persistence/src/migrate.ts:203-207,346-348`; `webv0/packages/persistence/test/db.test.ts:95-110` | Moved logger before `try`: advisory-lock count remained 1 instead of returning to 0. |

## RED-proof register

- T1: with the expiry predicate removed, `promise resolved "{ deletedObjects: [], pendingTombstones: 0, prefixesEmpty: true, verifiedTombstones: 1 }" instead of rejecting` at the first sweep.
- T2: `expected { failedLeaseCount: 0, deletedDelayedObject: 0, exitWaitedForFence: false, remainingKeys: [intake/...] } to deeply equal` the safe outcome.
- T3: `promise resolved Result { command: 'UPDATE', rowCount: 1 } instead of rejecting`.
- T4: without the pre-dispatch check, the test reached the fake port and surfaced `Cannot read properties of undefined (reading 'kind')` rather than the abort reason.
- T5: expected handler options including `throwOnRequestTimeout: true`; property was absent.
- T6: unrelated post-deadline error: `expected true to be false`.
- T7: `expected undefined to match object { pid: <exporter>, holds_snapshot: true }`.
- T8: advisory lock leak: `expected 1 to be 0`.

## Cost envelopes

- T1: an exit encountering an unexpired prepared intent parks for at most its remaining prepared TTL (default 14 minutes = 2×420s), then is rerun. An intent crossing expiry between the arm and census can cause one extra immediate (0-second) rerun; it cannot reach deletion while prepared.
- T2: a failed guest upload parks exit for at most the remaining upload-lease TTL (15 minutes by default). This occurs only when an upload fails while the fence matters; successful claims release immediately.

## T9 corrections to HARDEN-3.5 evidence

- A16: corrected to the bounded T4 claim above; claim dispatch is gated, while an already-running transaction may complete.
- A18: corrected by T5; timeout enforcement requires both `requestTimeout` and `throwOnRequestTimeout: true`.
- A23: corrected by 0077; state/timestamp coupling, not `deleted_at IS NULL` alone, makes live rows visible.
- B11: expiry authorizes TTL arming; it does not independently prove all remote publication impossible. The retained lease is the guest ambiguity fence.
- B12: zero-row tolerance is limited to armed-to-swept drain races; set-based expiry and exit operations are separately described, not folded into “there and only there.”
- E4: the ceremony is executable only after T7's stable identity and blocker query; the corrected runbook is cited above.
- B24: the lined port contract is `webv0/packages/application/src/ports.ts:1174-1199`.
- A7 drift: `webv0/apps/api/src/deps.ts:93-95`.
- C3a drift: lock call `webv0/packages/persistence/src/migrate.ts:203`; key `:28`; release `:346-348`.
- False 408 narrative: only causally related abort errors map to 408; no “nothing stored” assertion remains.
- False prepared/finalize availability narrative: full exit safety comes from T1's pre-delete prepared-row park plus the unchanged finalize interlocks; finalize alone refusing a prepared row is not represented as full-flow closure.
- False interaction-2 narrative: a pre-finalize relist cannot catch a later straggler. T1 prevents sweep from consuming a live staff intent; T2 orders ambiguous guest publication before sweep via the retained lease.

## T1 defense-in-depth map (Neural Option 1)

| Staff route | First real refusal after the exit schedule | Later defense |
|---|---|---|
| Photo | Missing person when `lockPerson` returns null (`webv0/packages/application/src/usecases/personPhotoOps.ts:41-48`). | Prepared-only resolver at `:48`; compensation cleanup. |
| General document | `requireOwner` rejects the erased owner before its transaction (`webv0/packages/application/src/usecases/documentOps.ts:37-53,92`). | Resolver inside the atomic transaction (`:112`). |
| Promoted live-copy attach | The same `requireOwner` path rejects the erased person (`documentOps.ts:37-53,92`). | Resolver inside attach (`:112`) plus quarantine cleanup transaction. |
| Invoice PDF | While Exiting, document insertion is quiesce-refused (`webv0/packages/persistence/migrations/0059_exit_quiesce_lock.sql:19-27`); after finalize, the document tenant FK refuses (`0024_documents.sql:15-17`) before the resolver. | Resolver is later at `webv0/packages/application/src/usecases/invoiceOps.ts:242-258`. |

The composed killer uses the general-document row because it provides a registration-specific
zero-row assertion. It records `NOT_FOUND` from `requireOwner`; the separate c3_app discriminator
proves the resolver even though all real routes are over-determined to refuse earlier.
