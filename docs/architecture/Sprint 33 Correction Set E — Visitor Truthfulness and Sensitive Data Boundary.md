# Sprint 33 Correction Set E — Visitor Truthfulness and Sensitive Data Boundary

Date: 2026-07-05 · Deployed **1.0.0.8** (runtime `5c064623…`). HEAD advanced
`5c86328` → `9d23e22`. Sessions: Owner = Ihab Tarrafti; certification identity
= m.khalailah@geekay.com, **C3 Visitors only** (Id 4).

## 1. Exact contracts empty-success root cause
Three compounding issues let a denied Visitor see a false empty register:
1. The NavRail `contracts` item had no guard, so a denied role could route to it.
2. `useContracts` / `usePersonContracts` / `useContract` issued their query
   regardless of role; on a security-trimmed **404** the screens rendered
   "Total Contracts 0 / No contracts yet" and "Related Contracts (0)".
3. `SharePointPersonService.listPersonContracts` **caught 404/403/network and
   returned `[]` "for PersonProfile stability"** — converting a denied read
   into a false empty contract summary for PER-0001 (the genuine GKE holder).

## 2. Service / hook / UI correction
- **`utils/rolePolicy.ts`** (new, shared): `canAccessContracts` (owner/
  operations/legal/finance/management — mirrors the Phase 3D C3Contracts ACL),
  `canViewPerDiem`, `canActionWorkItems`. Explicit role sets, not
  `canViewFinancials`.
- **NavRail**: Contracts gated on `canAccessContracts` (hidden for hr/visitor);
  Renewals unchanged (`role !== 'visitor'`).
- **Hooks**: all three contract hooks expose `roleDenied` and set
  `enabled: !roleDenied` — no contract read is issued during normal Visitor
  navigation.
- **Screens**: ContractsList / ContractProfile / RenewalsCenter render an
  explicit "unavailable for your role" state for denied roles; PersonProfile
  omits the numeric contract summary and shows a truthful unavailable tile +
  Related-Contracts state (never "0").
- **`listPersonContracts`**: fails closed — 404 → `ContractsListUnprovisionedError`,
  other non-OK → new `ContractReadFailedError`, network/parse → throw. No
  404/403 is ever converted to `[]`.

## 3. Role-denied vs empty vs unavailable semantics
- **Authorized empty**: query succeeds with `[]` → truthful empty register.
- **Role denied**: predicate false → "unavailable for your role"; NO query issued.
- **List unavailable / provisioning failure**: `ContractsListUnprovisionedError`
  / `ContractReadFailedError` → "Contracts are currently unavailable … not an
  empty register".
- **Unexpected read failure**: generic error → "Could not load contracts".
These are now distinct at the service and UI layers.

## 4. Per-diem policy and audited surfaces
`canViewPerDiem` = owner/operations/finance/management (denied visitor/legal/hr).
Audited surfaces: **MissionWorkspace** participant list (gated on `showPerDiem`),
**ApprovalInbox** payload summary (gated on `canViewPerDiem`). Denied roles
receive no per-diem in rendered text, innerHTML, aria-labels, or title
attributes — it is not rendered at all. SituationRoom/PersonProfile-missions do
not render the participant `PerDiemRate` (FinanceSection's "Per Diem" is a
mission-finance-line category, a separate canViewFinancials concern, empty
hosted — out of the participant-rate scope). Operations submission and Owner
execution flows are unchanged (per-diem input/execution untouched).

## 5. Command Center affordance correction
`WorkItemCard` renders a neutral status label (e.g., "Journey required",
"Roster gap") with **no button and no click handler** for read-only roles;
authorized (owner/operations) users keep the actionable CTA via
`canActionWorkItems`.

## 6. Parity and gate
`scripts/s33-parity-visitor-boundary.mjs` — 25 checks covering all 22 mandated
scenarios (compiled role predicates + static wiring for nav gate, query
disabling, denied-state screens, fail-closed reads, per-diem gating, work-item
CTA, Mock/SP alignment). `s32-parity-nav-activation` updated for the role
guard. **Gate PASS — 26 steps** (21 parity, both tsc, strict build,
verify:runtime, NUL audit).

## 7. Version and hashes
Solution **1.0.0.8**; runtime asset
`5c064623998529ae923d0d0c165aceb6b193f6de797e87d3a1c6cec0e81e1a34`; sppkg
`776d95740103fd127beafb708dd77e536441a297c414e89a7d30aa1a2eb46eed`
(286,523 B); host bundle `b2b778f1` sha `5808eff3…`; runtime chunk `51e44929`
sha `0d5d907e…`.

## 8. Deployment
One controlled tenant-wide Add(overwrite)+Deploy (Owner session): 200/200,
catalog 1.0.0.7 → **1.0.0.8 Deployed/Enabled/valid/"No errors."** No retract,
no per-site install. Live bytes re-hashed in-page (host `5808eff3…`, chunk
`0d5d907e…`) byte-match the package. Visitor cold load green (runtime-committed
26 ms, no recovery).

## 9. Visitor screen / denial matrix (hosted, 1.0.0.8)
Role = Visitor (Id 4 only). Nav = Command Center, People, Situation Room,
Missions, Diagnostics — **Contracts and Renewals absent**. Command Center
renders truthfully (17 items) with neutral work-item status labels and **no
Start Journey / Assign CTA**. People + Person Profile readable. Missions +
Situation Room truthful (no fabricated finance/milestone). Diagnostics
non-writing. **No contract query issued during Visitor navigation.** No in-app
route to Contracts exists (nav hidden, zero contract cross-links, no URL/hash
routing) — a Visitor cannot reach the register; the denied-state screens are
the parity-proven safety net.

## 10. Sensitive-data DOM evidence
- **PER-0001** (genuine GKE holder): no "Total Contracts 0", shows "Unavailable
  for your role", no "Related Contracts (0)", **GKE not shown**, no financial
  value.
- **Per-diem**: absent from Visitor DOM text, innerHTML, aria-labels, and title
  attributes on Missions (previously "35 USD/day" was exposed).
- **GKE-PL-2026-001**: not readable by the Visitor session (C3Contracts 404);
  no cross-link reaches it.
- No compensation values; no approval-payload exposure (Approvals nav hidden
  for Visitor); no credential-reference exposure.

## 11. Authorized-role regression (Owner, 1.0.0.8)
Owner still sees the Contracts nav, register (1 contract, GKE listed), the GKE
profile with financials, per-diem on missions, and actionable work-item CTAs.

## 12. Effective-permission confirmation (unchanged)
Visitor: C3Approvals/C3People/C3Missions = `V1 A0 E0 D0 ML0`; **C3Contracts =
HTTP 404** (security-trimmed). No ACL or group change was made.

## 13. Integrity reconciliation
Unchanged: People 15, Approvals 51, Journeys 12, Missions 4, Participants 5,
Kit 8, Apparel 5, Credentials 20. PER-0025 active; participant Id 5 inactive;
kit Id 7 & Id 8 inactive; CRED certification rows inactive; protected approvals
APR-0034/0045/0054 Submitted, APR-0066 ExecutionFailed; GKE-PL-2026-001
unchanged. No operational data changed (read-only recert).

## 14. Remaining defects
None from this correction. The three confirmed issues (contracts empty-success,
per-diem exposure, inert CTAs) are resolved and hosted-verified. FinanceSection
per-diem-category display remains a separate `canViewFinancials` concern
(empty/suppressed hosted) — noted, not in this scope.

## 15. Recommendation on Controlled Internal Beta entry
All role slices (Owner, Operations, Management, Visitor) are now hosted-certified
with truthful boundaries, no write leakage, and no sensitive-data exposure. The
governed-write, exemption, recovery, ACL least-privilege, reactivation,
submission-guard, and Visitor-boundary corrections are all deployed and green.
This is a strong position for Controlled Internal Beta; **the go/no-go call
remains the owner's — beta is not declared here.**
