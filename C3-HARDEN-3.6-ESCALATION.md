# C3 HARDEN-3.6 — Escalation

## T1 — literal zero-row registration outcome is unreachable in the composed real-route schedule

**Status:** STOPPED before commit. The production predicate change is straightforward, but the
required composed acceptance cannot be made true by the currently approved T1 scope without
softening the test or changing a staff registration transaction that the triage did not authorize.

### The wall

T1 requires one real test in which a staff request pre-registers, its storage PUT stalls, exit
sweeps and finalizes, and the resumed request's registration aborts specifically because the
`prepared -> resolved` update matches zero rows.

After the real exit data phase has run, none of the four staff registration paths can reach that
zero-row resolver:

- Photo registration first locks the person and refuses when the data phase has erased it; intent
  resolution is later (`webv0/packages/application/src/usecases/personPhotoOps.ts:42-48`).
- Document registration, including promoted live-copy attach, calls `requireOwner` before its
  transaction; intent resolution is later in the transaction
  (`webv0/packages/application/src/usecases/documentOps.ts:37-53,92-112`).
- Invoice registration is the closest path, but it inserts the document before resolving the
  intent (`webv0/packages/application/src/usecases/invoiceOps.ts:242-259`). The document
  `BEFORE INSERT` quiesce trigger refuses while the tenant is Exiting
  (`webv0/packages/persistence/migrations/0056_tenant_exit_state.sql:30-31`; locking refusal body
  `webv0/packages/persistence/migrations/0059_exit_quiesce_lock.sql:19-27`).
- Starting registration before Phase 0 does not create the demanded ordering: the quiesce
  trigger's unconditional tenant `FOR SHARE` lock is held through the registration transaction,
  so Phase 0's conflicting Exiting update cannot overtake it and reach sweep first
  (`webv0/packages/persistence/migrations/0059_exit_quiesce_lock.sql:12-18,24`).

Therefore a real resumed staff route aborts safely, but earlier than the required zero-row
transition. Calling `resolveCompensationIntent` directly, or running the sweep before the real exit
phase, would be a softened proxy rather than the composed route schedule the triage mandates.

### What was tried to falsify this conclusion

The photo, general document, promoted-attach, and invoice call orders were traced from each PUT to
its owning transaction and compared with the exit Phase-0/data-phase ordering and both quiesce
trigger bodies. Invoice was checked as the only candidate that does not pre-read its polymorphic
owner inside the use case; its document insert is nevertheless intercepted before the resolver.
Moving registration before Phase 0 was checked and is serialized ahead of exit by the existing
tenant row lock, so it cannot produce the demanded schedule either.

### Direction required from Neural

One of these must be explicitly selected:

1. Accept the real composed route outcome (quiesce/missing-owner refusal), while retaining a
   separate real-DB zero-row transition discriminator; or
2. Authorize a registration-order change (the narrow candidate is invoice intent resolution
   before document insert, still in the same atomic transaction) so the literal zero-row outcome
   becomes reachable after exit.

No T1 commit or RED-proof will be claimed until that choice is made. Work continues on T2–T9 as
the triage instructs.
