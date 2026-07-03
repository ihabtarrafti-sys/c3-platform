# C3 Logistics List Permissions — Sprint 29A

**Date:** 2026-07-03
**Status:** Remediated and REST-verified (scope: the two S29A logistics lists only)
**Operator:** site collection administrator (`IsSiteAdmin = true`, verified pre-change)
**Relates to:** ADR-013 Addendum — Mission Kit Logistics Exemption · C3 Beta Checkpoint — Sprint 29A Part 15.0

> **Principle:** UI role guards are UX controls (affordance). Service validation is
> application authority. **SharePoint list ACLs are the security boundary.** All three
> layers are required; none substitutes for another.

---

## 1. Pre-remediation finding

Both lists **inherited site permissions** (`HasUniqueRoleAssignments = false`). Inherited
assignments (recorded via REST with principal IDs before any change):

| Principal (Id) | Inherited level | Problem |
|---|---|---|
| C3 - Contract Command Center Owners (3) | Full Control | ok |
| C3 - Contract Command Center Visitors (4) | Read | ok |
| **C3 - Contract Command Center Members (5)** | **Edit** | any site member could edit operational rows directly (ADR-013 bypass) |
| **C3 Operations (12)** | **Read** | S29A kit writes would 403 for the primary operator role |
| **C3 HR (13)** | **Read** | apparel edits would 403 for HR |
| C3 Finance (15) / C3 Management (17) | Read | ok |
| **C3 Legal (18)** | **Full Control** | far beyond the read-only application role |
| C3 Platform Owners (19) | Full Control (+bindings) | ok |

## 2. Remediation performed (2026-07-03, REST)

Per list: `breakroleinheritance(copyroleassignments=false, clearsubscopes=true)` — inherited
assignments were **not** copied (SharePoint automatically retains the acting site
administrator; site collection admins always retain access) — followed by explicit
`addroleassignment(principalid, roledefid)` grants using **exact principal IDs** and
**built-in permission levels only** (Full Control 1073741829 / Edit 1073741830 /
Read 1073741826; no custom levels created). No SharePoint groups were deleted; no
site-level or unrelated-list permissions were altered; no item-level settings changed.

## 3. Post-remediation state (REST-verified)

**Both lists:** `HasUniqueRoleAssignments = true` (direct endpoint; note the `$select`
projection of this property can return a stale value — verify via
`…/lists/getbytitle('<list>')/HasUniqueRoleAssignments`). Site web ACL unchanged
(Members still Edit, Legal still Full Control **at site level** — see §5).

### C3MissionKitAssignments

| Principal (Id) | Level |
|---|---|
| C3 - Contract Command Center Owners (3) | Full Control |
| C3 Platform Owners (19) | Full Control |
| **C3 Operations (12)** | **Edit** |
| C3 HR (13) · C3 Legal (18) · C3 Finance (15) · C3 Management (17) | Read |
| C3 - Contract Command Center Visitors (4) · Members (5) | Read |
| Ihab Tarrafti (9) | Full Control (auto-retained acting admin) |

### C3PersonApparelProfiles

Identical, except **C3 HR (13) = Edit**.

### Decisions worth recording

- **Site Members/Visitors were granted Read (not removed entirely):** every authenticated
  C3 user — including the fail-closed `visitor` app role — must still *read* these lists
  for MissionWorkspace/PersonProfile to render. Edit was stripped; read posture preserved.
  Tighten further only as part of the site-wide review (§5).
- The acting administrator's direct Full Control assignment (auto-added by SharePoint on
  inheritance break) was retained per the "do not remove owner/admin access" requirement.

## 4. Practical role checks

| Role | Check | Status |
|---|---|---|
| Owner | add/transition/deactivate kit; edit apparel | **Pending — executed as part of the S29A hosted checklist** (owner session available) |
| Operations | add/transition/deactivate kit; edit apparel | **Pending — no operations session available**; REST evidence: Edit on both lists |
| HR | apparel edit works; kit edit denied | **Pending — no HR session**; REST evidence: Edit on apparel, Read on kit |
| Legal / Finance / Management | read both; edit denied | **Pending**; REST evidence: Read only |

REST role-assignment evidence above stands as the verification of record until role
sessions are exercised; the hosted checklist (Part 15.4) includes the per-role checks.

## 5. Out of scope — flagged for a separate owner decision

- **Site-wide hardening:** at the *site* level, the generic Members group still has Edit and
  C3 Legal still has Full Control — which means **all other operational lists**
  (C3People, C3Credentials, C3Journeys, C3Approvals, C3Missions, C3Contracts) remain
  directly editable by those principals, bypassing ADR-013. Recommended: schedule a
  permissions hardening pass with the same break-inheritance pattern.
- **C3MissionParticipants (S29B posture, documented — NOT applied):** Edit = C3 Platform
  Owners only; all other groups Read. Operations submit Add/RemoveMissionParticipant
  approvals through C3 and must not be able to bypass governance by editing rows directly.
  Apply together with the S29B governed-write implementation.
