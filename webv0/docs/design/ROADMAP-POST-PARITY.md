# Post-Parity Roadmap — from parity floor to product (Owner direction, 2026-07-08)

**The owner's bar, restated:** CP parity was the floor. The product is not commercially unique yet. What makes it unique: every domain **actually working** (no read-only stopgaps), the **workflows between domains** (person → contract → credentials → journey → mission as one connected operational fabric), the **cockpit** that turns records into operations, and **finish quality** matching the Command Desk vision. Base first, then assess and improve — with follow-through.

## The arc

| Sprint | Theme | What ships | Why it matters commercially |
|---|---|---|---|
| **S41** | **Contracts — the FULL domain** | Governed AddContract / RenewContract / TerminateContract + direct-audited non-material edits + derived renewal windows (30/60/90) + financial role-gating. Includes the renewal WRITE the CP never shipped. | The first domain that goes *beyond* the CP. Money + governance in one pipeline is the product's spine. |
| **S42** | **Connected workflows + Person Profile depth** | The person page becomes the operational hub: contracts / credentials / journeys / missions sections with **in-context governed actions** (add contract, add credential, start journey, add to mission — from the person, pre-filled), cross-links everywhere an id appears, approvals history per person. | "Add people > add contract > credentials > journey > mission" as ONE flow, not five registers. This is the connective tissue the owner named. |
| **S43** | **The cockpit** | Command Center work queue (expiring credentials, contracts entering renewal windows, stalled journeys, mission roster gaps → one prioritized queue with in-context actions) + Situation Room readiness view. | The soul ([[C3-WHAT-IS-C3]]): the system that tells you what needs doing, not just what is. The demo-able differentiator. |
| **S44** | **Design elevation** | The Command Desk language (Phase 2E-B foundation: tokens, PageHeader/StatusBadge/DefinitionList discipline) applied to every S36–S41 surface: forms, dialogs, pickers, empty states. Owner visual review as the gate; Claude Design lane may spec (charter-compliant). | The owner's explicit finding: creation UIs look basic vs the vision. Finish quality is part of "better". |

Then: **assess** (the loop the owner asked for) — a structured pass over the whole product against the vision doc, producing the next improvement wave. D-6/D-7/D-8 from the reconciliation (Settings, kit transitions, per-diem) get decided there, not silently dropped.

## Standing rules for this arc

1. **No read-only stopgaps.** Every new domain ships its working lifecycle using the two certified mutation patterns (governed pipeline for material changes; direct-but-audited for operational edits).
2. Every sprint keeps the certification discipline: gate + E2E green per increment, staging deploy, owner smoke, audit-stream verification before certifying.
3. The reconciliation audit (`CP-PARITY-RECONCILIATION.md`) stays the parity record; this roadmap is the product record. Claims discipline unchanged: nothing public without the truthfulness pass.
