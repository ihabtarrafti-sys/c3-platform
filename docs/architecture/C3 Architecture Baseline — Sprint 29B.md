# C3 Architecture Baseline — Sprint 29B

**Status:** Authoritative until Sprint 30 closeout
**Date:** 2026-07-03
**Supersedes:** C3 Architecture Baseline — Sprint 29A (preserved as historical)
**Head commits at baseline:** `0f8d9ce` … `8f94cf2` (final runtime `1cba607`, SHA `b29de64d…`)
**Hosted state:** final S29B runtime deployed; hosted validation fully green incl. security 403 tests

---

## Closeout statement

Sprint 29B delivered governed mission membership (Add/RemoveMissionParticipant as full
ADR-013 operations with governed reactivation, kit-dependency blocking, pending-state UX,
and idempotent recovery) and hardened the approval channel itself: **submitters are
Add-only and submitted approval rows are immutable to their creator**.

---

## Section 1 — Architectural shifts introduced in Sprint 29B

1. **The ADR-013 engine is proven extensible.** Two operations were added with zero
   framework changes: payload types, submit hooks, execution branches, inbox summaries,
   and choice values — the S18 engine absorbed them cleanly.
2. **Idempotent execution as the recovery model.** The participant write contract
   (created / reactivated / already-applied / already-inactive / conflict / data-integrity)
   makes *re-execution* the recovery path — partial failures repair only the approval
   stamp, and duplicate rows are impossible by construction (unique Title race guard as
   the final fence). This is the template for future governed writes.
3. **Governed reactivation inside Add.** Because removals retain rows (`IsActive=false`),
   re-adding a person reactivates the SAME SharePoint row with fields refreshed from the
   approved payload — history is one row, not a chain of duplicates.
4. **Immutable approval submission.** `createApproval` is a single requester POST; the
   public APR identifier derives deterministically from the SP item Id at read time
   (`deriveApprovalTitle`), with legacy `APR-XXXX` Titles passing through unchanged. The
   POST-then-MERGE Title backfill — and with it the requester's need for any edit
   permission — is retired. SP numeric Id remains internal same-list derivation only.
5. **Security boundary completed for the governance core:** four lists now carry verified
   unique ACLs (kit, apparel, participants, approvals) with role-appropriate write access;
   the custom `C3 Approval Submitter` level is Add-only (bit-audited); Operations manage
   membership exclusively through governed requests.
6. **Cross-domain refresh via caches only.** Situation Room gaps/counts and Command Center
   work items pick up membership changes purely through the dual participant-cache
   invalidation — zero screen modifications, hosted-verified.

## Section 2 — Write capability matrix after Sprint 29B

| Domain | Create | Update | Deactivate/Remove | Governance |
|---|---|---|---|---|
| People | ✅ governed | ❌ | ❌ | ADR-013 |
| Credentials | ✅ governed | ❌ | ✅ governed | ADR-013 |
| Journeys | ✅ governed | lifecycle ✅ | — | ADR-013 + S19 exemption |
| **Mission participants** | ✅ **governed (S29B)** incl. reactivation | ❌ (deferred) | ✅ **governed, IsActive=false (S29B)** | **full ADR-013** |
| Kit assignments | ✅ role-gated (S29A) | ✅ lifecycle | ✅ | Kit Logistics Exemption |
| Apparel profiles | ✅ upsert (S29A) | ✅ | ❌ (deferred) | role-gated master data |
| Approvals | ✅ **Add-only submitters** | owner stamps only | ❌ (immutable) | ADR-013 core |
| Missions / Contracts / Finance | ❌ | ❌ (TD-26) | ❌ | deferred |

## Section 3 — Approval identity model (S29B)

```
Requester POST (Title = APR-PENDING-<ts>-<rnd>, non-authoritative correlation)
→ SP item Id → deriveApprovalTitle(Id, Title) → public APR-XXXX
Legacy rows: Title already APR-XXXX (derived from the same Id by the retired flow) → passthrough
Lifecycle writes: items(Id) under owner permissions — Title is never used to locate anything
```

Same item ⇒ same identifier under either scheme; historical identifiers stable; public
`approvalId` shape unchanged; no rows rewritten.

## Section 4 — Security posture (live, verified)

| List | Unique ACL | Edit | Notes |
|---|---|---|---|
| C3MissionKitAssignments | ✅ | Owners, Operations | S29A; hosted role checks green |
| C3PersonApparelProfiles | ✅ | Owners, Operations, HR | S29A |
| C3MissionParticipants | ✅ | **Platform Owners only** | Operations = Read; governed requests only |
| C3Approvals | ✅ | Owners (lifecycle); **Operations = `C3 Approval Submitter` (Add-only; edit/delete/manage excluded; WriteSecurity=2 defense-in-depth)** | requester MERGE/DELETE → 403 hosted-verified |
| C3People / C3Credentials / C3Journeys / C3Missions / C3Contracts | ❌ (inherit site) | site Members Edit, Legal FC | **platform-wide ACL review outstanding (owner decision)** |

## Section 5 — Error model additions (Error Library ERR-030…ERR-035)

ParticipantConflictError · DuplicateParticipantError · ActiveKitDependencyError ·
DuplicatePendingRequestError · PartialParticipantAddExecutionError ·
PartialParticipantRemovalExecutionError.

## Section 6 — Tech debt state

**TD-27 RESOLVED.** Open: TD-19, TD-23, TD-26, manual CI/CD + committed runtime,
platform-wide ACL review, deferred participant metadata update / generic reactivation UI /
kit metadata edits, top-N cap inconsistencies, s15–s17 inline parity pattern.
**Mandatory gate change:** the strict build TypeScript path (`tsc -b` via `beta:runtime`)
is part of the validation gate — plain noEmit missed real build failures twice.

## Section 7 — Roadmap

**Sprint 30 — Mission Readiness Cockpit** (recorded direction; not designed here).
Budgeting follows. Locked decisions all honoured; SituationRoom/CommandCenter untouched;
Contracts/Amendments/Intelligence guards unchanged; TD-26 intact.
