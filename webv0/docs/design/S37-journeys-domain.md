# Sprint 37 — Journeys Domain (Design & Increment Plan)

**Author:** Architect-of-record · **Date:** 2026-07-07 · **Goal:** the third governed domain and the CP benchmark's heart — a person's journey with a real lifecycle state machine (the certified SP reference: InitiateJourney → JRN-XXXX; Suspend/Resume/Complete/Cancel).
**Claims discipline:** nothing publicly claimable until hosted-certified and worded by the truthfulness authority.

## Entity

**Journey** — `JRN-XXXX` (tenant-scoped), belongs to one **Person**:

| Field | Type | Rules |
|---|---|---|
| journeyType | text, required ≤120 | e.g. "Pro Contract Onboarding" |
| title | text, optional ≤200 | display label |
| startedOn | **date** (plain ISO), required | same date discipline as Credentials |
| endedOn | **date**, nullable | set by Complete/Cancel |
| status | enum | the state machine below |
| notes | optional ≤2000 | |

## The state machine (CP parity)

```
            ┌── suspend ──▶ Suspended ── resume ──┐
            │                                     ▼
Initiate ─▶ Active ◀──────────────────────────────┘
            │  │
            │  └── complete ──▶ Completed   (terminal)
            └───── cancel ────▶ Cancelled   (terminal)
   (Suspended may also complete/cancel)
```

## Two operation classes — a deliberate design split (CP parity)

1. **InitiateJourney = GOVERNED** (approval-gated, like AddPerson/AddCredential): creating a journey is a commitment; it rides the identical submit → review → execute pipeline. `targetPersonId` = the owning person; JRN id allocated at execution; execute-idempotency via unique `created_by_approval_id`.
2. **Transitions (Suspend/Resume/Complete/Cancel) = DIRECT-BUT-AUDITED** (the certified CP posture: journey lifecycle was ops "exempt-edit", not approval-gated — routine operational transitions must not drown the approval inbox). Enforcement: role-gated server-side (owner/operations), the state machine validated in the application layer AND a DB CHECK on status, optimistic concurrency (version guard), and the audit event written **in the same transaction** as the flip — the A8 discipline applies to every mutation, governed or direct. Cancel requires a reason (audited).

This introduces the platform's second mutation pattern — **direct audited transitions** — which Kit/Apparel (future sprints) will reuse.

## Audit actions

`JourneyInitiated` (on execute) · `JourneySuspended` · `JourneyResumed` · `JourneyCompleted` · `JourneyCancelled` (each with before/after status and the actor; cancel carries the reason).

## Read surfaces (J4)

Journeys register (JRN id, person link, type, started, status badge — Active/Suspended/Completed/Cancelled) + person-profile Journeys section + journey history (its audit trail). Transition buttons appear per the state machine and role, each behind a GovernedAction-style confirmation dialog (confirmation ≠ approval; the dialog copy is honest about immediacy: "this takes effect immediately and is recorded").

## Increments

- **J1 — domain**: Journey entity, state machine (pure functions + tests), input schemas, InitiateJourney payload, audit actions, labels. The execute dispatch gains an explicit fail-closed branch for InitiateJourney until J2 lands its executor (the compile-enforced exhaustiveness demands it).
- **J2 — persistence + application**: migration 0010 (journey table, RLS FORCE, grants, counter/optype extensions, status CHECK), writeTx (insertJourney, transitionJourney with version guard), submitInitiateJourney + executor + the four transition use-cases, export/exit table-set extension. Tests incl. illegal-transition refusals and same-tx audit.
- **J3 — API**: register + per-person reads; governed initiate submit; four transition routes (versioned, role-gated). HTTP tests.
- **J4 — web + deploy**: register + profile section + transition dialogs + E2E; staging deploy (0010 paste → API → web) + hosted smoke.

Same cadence as Sprints 35/36; each increment gate-green before the next.
