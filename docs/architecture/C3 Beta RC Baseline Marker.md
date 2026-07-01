# C3 Beta RC Baseline Marker
**C3 Contract Control Center**
**Baseline accepted:** 2026-07-01
**HEAD commit at acceptance:** `7ea316a` — `docs(s19): Close Sprint 19 and define beta release candidate`
**Preceding runtime commit:** `60e7be0` — `build(s19-phase-3): Update SPFx runtime bundle after sequence hardening`
**Status:** ACCEPTED BETA RELEASE CANDIDATE — development continues from this point

---

## Statement

This document records the accepted Beta Release Candidate baseline for C3. The hosted-workbench smoke pass was completed and accepted on 2026-07-01 against the Sprint 19 runtime bundle.

Full beta release packaging is intentionally deferred. Sprint 20 and subsequent sprints will continue development from this baseline. This marker preserves the exact commit state at which the beta RC was accepted so that it can be reproduced, referenced, or branched at any point.

---

## Accepted capabilities (as of HEAD `7ea316a`)

The following capabilities were smoke-tested against live SharePoint DSM and accepted:

1. **SP DSM reads** — C3People, C3Credentials, C3Journeys, C3Approvals all read correctly via live SP REST
2. **Real SharePoint group role resolution** — `spRoleResolver.ts` queries `/_api/web/currentUser/groups` at mount; maps group display names to C3 roles; fail-close to `visitor` if no group matches
3. **Governed approval submission** — `createApproval`: POST-then-MERGE to canonical APR-XXXX derived from SP item ID; `C3Approvals` row created with `ApprovalStatus: Submitted`
4. **Approval review** — `patchApprovalStatus`: Approve and Reject transitions via C3Approvals PATCH; self-approval guard enforced
5. **Approval execution** — `stampExecution`: five-step guard, `initiateJourney`, Executed stamp; ExecutionFailed stamped on failure
6. **C3Journeys creation through ADR-013 execution** — `initiateJourney`: POST-then-MERGE to canonical JRN-XXXX derived from SP item ID; 13 columns written; `Status: Active`
7. **Duplicate active onboarding journey prevention** — active journey check before execute; `ExecutionFailed` stamped on duplicate; no second C3Journeys row created
8. **Journey lifecycle transitions** — `completeJourney`, `suspendJourney`, `resumeJourney`, `cancelJourney`: GET-guard-PATCH; `InvalidTransitionError` before any write; `CompletedAt` on Complete; Notes audit append with actor login name
9. **APR/JRN IDs from SP atomic item IDs** — POST-then-MERGE pattern; SP SQL identity column is the sequence source; GET-last-then-increment removed
10. **Beta RC documentation** — Sprint 19 Closeout Report, C3 Architecture Baseline Sprint 19, C3 Beta Release Candidate Checklist all committed

---

## Accepted caveats

| Caveat | Notes |
|--------|-------|
| Manual runtime bundle commit | Every code change requires manual `build:runtime` + bundle commit; no CI pipeline |
| Manual partial-execution recovery | Journey created but stamp failed: operator manually sets `ApprovalStatus = Executed` in SP |
| No approval history timeline in C3 UI | Executed/Rejected records not visible in `ApprovalInbox`; Sprint 20 Phase 1 target |
| No credential write path | `addCredential`, `deactivateCredential` stub-throwing; Sprint 20+ |
| No Contracts/SP-02 resolution | `SharePointContractService` returns `[]`; separate workstream |
| No dedicated journey audit columns | Lifecycle transitions append to `Notes`; `SuspendedAt`, `CancelledAt` etc. deferred to Sprint 20 |

---

## Reference documents

- Full go/no-go checklist: `docs/architecture/C3 Beta Release Candidate Checklist.md`
- Sprint 19 architectural state: `docs/architecture/C3 Architecture Baseline — Sprint 19.md`
- Sprint 19 closeout: `docs/architecture/Sprint 19 Closeout Report.md`

---

## Sprint 20 note

Sprint 20 begins from this baseline. No source code, runtime behavior, or SP schema was modified between the Beta RC acceptance and this marker commit.

Sprint 20 Phase 1 target: **Approval History / Audit Visibility** — surface the full ADR-013 governance trail within the C3 UI, removing the current requirement for operators to query SharePoint directly to see audit history.
