# ADR-002 — Mission Activation Gate

**Status:** Accepted  
**Date:** 2026-06-28  
**Sprint:** 9 (decision point) / 10 (implementation)  
**Author:** Architecture Review, Sprint 9 Baseline

---

## Context

When the Mission model is introduced in Sprint 10, the platform will need to evaluate operational obligations for Mission participants. The central question is:

> **At what point does a Mission's existence cause obligations to be generated for its participants?**

The same question has a practical edge: Geekay routinely plans and budgets for Missions before they are financially approved. A Mission in a speculative or pending state should not generate compliance gaps that look identical to obligations for committed Missions. That would degrade operator trust — the signal-to-noise problem Sprint 9 was specifically designed to prevent.

Three options were considered:

**Option A — Event-driven activation.** `confirmMission()` fires a side effect that writes an explicit `MissionActivation` record. Gap computation includes obligations only for missions with an activation record. Provides an audit trail but requires a new entity and a write path.

**Option B — Status-gated filter in the hook.** Gap computation checks `mission.Status` before evaluating participants. Missions in non-active statuses are silently skipped. No new entity, no side effects, consistent with how the rest of the platform works (computed from current evidence, not stored events).

**Option C — Explicit opt-in per participant.** Each `MissionParticipant` carries an `obligationsActive: boolean` flag. Operators explicitly mark participants as obligation-generating. Most flexible per-participant control, but significantly more complex UI and data management.

---

## Decision

**Option B is adopted for Mission v1.**

Gap computation for Mission-scoped obligations uses a status-gated filter in `useMissionGaps`. A Mission generates obligations for its participants if and only if:

```typescript
const OBLIGATION_ACTIVE_STATUSES: MissionStatus[] = [
  'Confirmed',
  'Active',
  'PostMission',
];

const missionIsActive = OBLIGATION_ACTIVE_STATUSES.includes(mission.Status);
```

Missions in the following statuses do **not** generate obligations:

| Status | Reason excluded |
|---|---|
| `Planning` | Speculative — commitment not yet proposed to Finance |
| `FinancePending` | Finance approval pending — not yet a committed operational deployment |
| `Canceled` | Commitment withdrawn — obligations should not persist |
| `Settled` | Mission is financially closed — obligations are historical, not actionable |

Missions in the following statuses **do** generate obligations:

| Status | Reason included |
|---|---|
| `Confirmed` | Finance has approved. The Mission is a committed operational deployment. This is the primary activation gate. |
| `Active` | Mission is in progress. Obligations remain live until the mission ends. |
| `PostMission` | Event has ended but financial closure has not. Participants may still need outstanding obligations resolved for settlement purposes (e.g. final credential copies for visa cost reimbursement). |

---

## The Confirmation Transition

The `FinancePending → Confirmed` transition is the activation gate. This transition:

- Converts the Mission from speculative to committed.
- Activates obligation evaluation for all participants.
- Commits the budget.
- Begins the logistics planning window.

In the mock implementation, `IMissionService.confirmMission(missionId)` transitions a Mission from `FinancePending` to `Confirmed`. In production, this will be a supervised write operation with authority controls (see open question below).

---

## Consequences

**Positive:**

- No new entity required. The activation gate is the status field that already exists.
- Consistent with the platform's core principle: computed from current evidence and current context. Mission.Status is evidence; the hook derives the gate from it.
- The gate is immediately understandable to operators: "only Confirmed and active Missions create gaps."
- Reversible at low cost: if Option A (audit records) is needed later, it can be layered on without changing the Option B filter. The status-gated filter remains as a runtime check; the activation record becomes the write-side audit trail.
- Prevents the noise problem: Missions that fall out of active status (cancelled, settled) stop generating gaps automatically, without any operator action.

**Negative / Trade-offs:**

- No audit record of when obligation evaluation was activated. The `ConfirmedAt` timestamp on the Mission partially compensates (it records when the status changed), but there is no separate activation event log.
- `PostMission` inclusion is a judgment call. If it creates noise in practice (operators see gaps for completed events), PostMission may be moved to the excluded list in a future revision.

**Deferred to a future sprint:**

- Authority controls on `confirmMission()` — who is permitted to trigger the transition.
- Notification/alert when a Mission reaches `Confirmed` and gaps are first generated.
- Per-participant activation control (Option C elements) if participant-level granularity is needed.

---

## Impact on the Mission Type

The existing `MissionStatus` stub (`'Active' | 'Completed' | 'Cancelled'`) does not reflect the real lifecycle. Sprint 10 replaces it with:

```typescript
export type MissionStatus =
  | 'Planning'        // Under consideration — no financial commitment
  | 'FinancePending'  // Proposed to Finance — awaiting approval
  | 'Confirmed'       // Finance approved — obligations now active  ← activation gate
  | 'Active'          // Event is in progress
  | 'PostMission'     // Event complete — financial closure pending
  | 'Settled'         // Accounts closed — Mission archived
  | 'Canceled';       // Commitment withdrawn at any pre-Active state
```

The old `'Completed'` status is split into `PostMission` (operationally over, financially open) and `Settled` (fully closed). This is the distinction identified in the Mission Model Architectural Analysis: a Mission that ended in August may not be financially closed until December.

---

## Alternatives Reconsidered

### Option A (activation record)

Would be the right choice if Geekay requires an auditable log of when compliance obligations were activated for each Mission — for example, for regulatory or contractual accountability. There is no current evidence this is required. Option A can be layered in later without removing Option B.

### Option C (per-participant opt-in)

Would be appropriate if some participants in a confirmed Mission should not have obligations generated (e.g. an observer who attends but has no travel credential requirements). This is a real edge case but not a Sprint 10 concern. If it arises, it can be implemented as a `MissionParticipant.obligationsActive` flag without changing the gate logic.

---

## References

- `docs/architecture/C3 Architecture Baseline — Sprint 9.md` — "What Mission Requires From the Architecture"
- `docs/architecture/Mission Model — Architectural Analysis.md` — Mission status lifecycle
- `docs/architecture/Mission Discovery Checklist.md` — Pre-implementation gate (23 items)
- Sprint 10 Proposal — `docs/releases/Sprint 10 Proposal.md`
