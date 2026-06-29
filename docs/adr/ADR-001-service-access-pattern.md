# ADR-001 — Service-Access Pattern

**Status:** Accepted  
**Date:** 2026-06-28  
**Sprint:** 6E (Structural Freeze)  
**Author:** Architecture Review, Sprint 6E

---

## Context

The C3 platform accesses SharePoint data through service objects. Two distinct
patterns have emerged as the platform has grown:

1. **SPService (legacy compatibility layer)** — a monolithic facade that was
   introduced for the original four data domains. It aggregates SharePoint list
   reads behind a single class and is injected into components via the
   `ServiceRegistry`.

2. **Parallel factory pattern** — a per-domain approach introduced when
   Credentials and Journeys were added as first-class operational entities.
   Each new domain implements its own `IMockXService` / `ISharePointXService`
   pair and is accessed via a dedicated `useXService()` hook that reads
   `config.dataSourceMode` directly.

During the Sprint 6E architecture review, the team evaluated whether to
unify these patterns by extending SPService to cover new domains. The decision
was to freeze SPService and establish the parallel factory pattern as the
permanent approach for all future domains.

---

## Decision

**SPService is the legacy compatibility layer. It will not be extended.**

New operational domains MUST use the parallel factory pattern:

- A domain-specific service interface `IXService` in `src/services/interfaces/`
- A mock implementation `MockXService` in `src/services/mock/`
- A SharePoint implementation `SharePointXService` in `src/services/sharepoint/`
- A `useXService()` hook in `src/hooks/` that reads `config.dataSourceMode`
  and returns the appropriate implementation

The `ServiceRegistry` continues to hold typed references for all service
implementations (including new domains), but new domains bypass the SPService
facade entirely.

---

## Current Domain Inventory

### Legacy pattern — routed through SPService

| Domain        | Interface / Type      | SPService method(s)              |
|---------------|-----------------------|----------------------------------|
| Contracts     | `Contract`            | `getContracts`, `getContract`    |
| People        | `Person`              | `getPeople`, `getPerson`         |
| Amendments    | `Amendment`           | `getAmendments`                  |
| Users         | `User`                | `getUsers`                       |

These domains are stable and have no planned changes. The SPService facade
covering them is frozen — its type file (`spService.types.ts`) MUST NOT CHANGE.

### Parallel factory pattern — direct service access

| Domain        | Interface               | Hook                     | Added      |
|---------------|-------------------------|--------------------------|------------|
| Credentials   | `ICredentialService`    | `useCredentialService()` | Sprint 6D  |
| Journeys      | `IJourneyService`       | `useJourneyService()`    | Sprint 6E  |

All future domains (e.g. Missions, Assignments, Events) MUST follow the
parallel factory pattern.

---

## Consequences

**Positive:**

- New domains are fully independent of SPService. They can be implemented,
  mocked, and tested without touching legacy code.
- `spService.types.ts` remains stable. No risk of type drift breaking the
  original four domains.
- Mock implementations are domain-scoped. Each domain controls its own seed
  data and state management without sharing a global mock store.
- The `dataSourceMode` switch is local to each hook. Toggling mock/SharePoint
  per domain is possible during development.

**Negative / Trade-offs:**

- Two patterns coexist. Developers must know which pattern applies to which
  domain. This ADR and the domain inventory above serve as the reference.
- There is no single "inject one service, get everything" entry point.
  Components that need data from multiple domains call multiple hooks — this
  is consistent with the React/TanStack Query model and is not a practical
  problem.

**Not affected:**

- `ServiceRegistry` — still holds typed references for all domains; no change
  to its shape or injection mechanism.
- `QueryClient` / TanStack Query — cache keys are domain-namespaced and
  unaffected by which access pattern a domain uses.

---

## Alternatives Considered

### Extend SPService to cover new domains

Rejected. SPService is a monolithic class whose type surface is a stability
guarantee for the original four domains. Adding Credentials, Journeys, and
future domains would grow it unboundedly, make mock management harder (shared
state), and create risk of type changes breaking existing consumers. The
parallel factory pattern achieves the same result with better isolation.

### Create a second SPService (SPService2)

Rejected. It would replicate the same problems at a one-version delay. The
parallel factory pattern is already in place and working; formalising it as
the standard is the lower-risk path.

---

## References

- Sprint 6E Proposal — `docs/releases/Sprint 6E Proposal.md`
- `packages/c3/src/services/interfaces/ICredentialService.ts`
- `packages/c3/src/services/interfaces/IJourneyService.ts`
- `packages/c3/src/hooks/useCredentialService.ts`
- `packages/c3/src/hooks/useJourneyService.ts`
