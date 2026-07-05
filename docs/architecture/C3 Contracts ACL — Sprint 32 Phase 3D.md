# C3 Contracts ACL — Sprint 32 Phase 3D

**Status:** ✅ HOSTED-GREEN — CLOSED 2026-07-05. The armed 3D-1 rev 3 run
completed with the terminal verification banner (§8); C3Contracts now has
unique permissions with exactly the five target principals and no Limited
Access. NavRail activation, deployment, and Part 19 are SEPARATE later phases.
**Scope:** Exact ACL configuration of the canonical `C3Contracts` list only.
**Prepared:** 2026-07-05 · **rev 2:** 2026-07-05 (after reviewed 3D-0 hosted
evidence) · **rev 3:** 2026-07-05 (gate-order correction + field-inventory
drift classification, under delegated engineering authority) · **Closed:**
2026-07-05

---

## 1. Boundary

Phase 3C (canonical schema remediation) is **hosted-green and permanently closed**
(see `Canonical Contracts Reset — Sprint 32.md` §9). Phase 3D changes **only** list
role assignments. It must not touch schema, Title configuration, list settings,
GUID, URL, or list contents, and its tooling verifies all of those dimensions
before, during (per mutation), and after execution.

List identity (closed Phase 3C state, re-confirmed by the reviewed 3D-0 probe):

| Property | Value |
|---|---|
| Title | `C3Contracts` |
| GUID | `88e835ad-ffd8-4565-9364-c1c1b4f0fc2f` |
| URL | `/sites/C3/Lists/C3_Contracts` (retitled-in-place legacy URL, accepted) |
| ItemCount | `0` |
| Inbound lookups | `[]` · unique child scopes `[]` |
| Reduced schema fingerprint | `3a13b28f94ccc462e5b5001a56a0d543cab3a74a4ba96c5913498087334bea98` |
| Settings | versioning on, major limit 10, attachments off |

## 2. Exact ACL target (owner-approved matrix, rev 2 principal names)

Unique list permissions containing **exactly five principals — no extras, no
Limited Access bindings**:

| # | Principal (SharePoint group, exact hosted title) | Role |
|---|---|---|
| 1 | **C3 Platform Owners** | Full Control |
| 2 | C3 Operations | Read |
| 3 | C3 Legal | Read |
| 4 | C3 Finance | Read |
| 5 | C3 Management | Read |

**rev 2 correction (reviewed 3D-0 hosted evidence):** the assumed group
`C3 Owners` does not exist. The operational owner principal is
**`C3 Platform Owners`** (hosted principal id 19 observed — recorded as evidence
only, never hard-coded; the tooling resolves by exact hosted title and binds the
reviewed run to the resolved id). **`C3 - Contract Command Center Owners` is the
associated site-shell Owners group and is NOT the operational target** — the
probe records a blocker if the operational title ever resolves to it.

Must NOT retain direct list role assignments: `C3 - Contract Command Center
Owners`, `C3 - Contract Command Center Members`, `C3 - Contract Command Center
Visitors`, `C3 HR`, and any individual principal (including the acting
administrator, whose temporary assignment is removed last — §3). V1 authoring
remains Owners-only. ACLs are the security boundary; UI role checks are UX only.

## 3. Method — proven Sprint 32 rev-2 uncopied break (supersedes the rev 1 copy=true proposal)

The reviewed inherited ACL carries **Limited Access on all relevant principals,
C3 Legal at Full Control, multi-binding C3 Platform Owners, the associated
site-shell groups, C3 HR, and the executing user as an individual principal.**
Copying that ACL (rev 1 proposal) would require unproven Limited Access cleanup.
Phase 3D therefore uses the proven rev-2 method:

```
breakroleinheritance(copyRoleAssignments=false, clearSubscopes=false)
```

`clearSubscopes=true` remains PROHIBITED (locked S30 rev2 rule). Because the
inherited ACL is discarded, **no revoke actions are ever generated for inherited
bindings** — the final ACL is constructed from a clean unique-permissions state
plus the possible temporary acting-user assignment SharePoint creates.

Deterministic normal-mode sequence (one mutation per fresh witness, full
reconciliation after each):

1. Resolve all five exact target groups + `Full Control`/`Read` role definitions.
2. Verify the executing account is site admin (or Platform Owners member) and
   holds ManagePermissions.
3. Two stable, complete, read-only pre-state snapshots.
4. Bind the run to the reviewed schema fingerprint, field-inventory fingerprint,
   ACL fingerprint, list ETag (drift witness only), group identities,
   role-definition ids, executing-user identity, inherited inheritance state,
   empty-list state, dependency state, and the exact plan strings.
5. `breakroleinheritance(copyRoleAssignments=false, clearSubscopes=false)`.
6. Immediately re-read `HasUniqueRoleAssignments`, the direct role assignments
   (only the acting-user assignment may appear), the executing user's effective
   permissions, and all non-ACL invariants.
7. Grant **C3 Platform Owners = Full Control**.
8. Verify Platform Owners Full Control + executing-user administrative access.
9. Grant Read to Operations, Legal, Finance, Management — in that fixed order,
   each individually witnessed and reconciled.
10. Verify all five required grants.
11. Identify the auto-added acting-user assignment (modeled explicitly:
    `remove-acting-user:<title>#<id>`, conditional).
12. Remove it ONLY when: it is a principal distinct from every target; Platform
    Owners Full Control is already proven on the current witness; and the
    executing user retains site-admin authority or Platform Owners membership.
    If absent, the step is a verified zero-mutation no-op.
13. Final verification: exactly five principals with exactly the target roles.
14. Zero extra principals, zero extra bindings, zero Limited Access.
15. GUID, URL, schema, field inventory, settings, ItemCount, inbound lookups,
    and item scopes unchanged (per-mutation and end-to-end).

**Recovery mode** plans from LIVE direct assignments: missing grants in fixed
order + the conditional acting-user removal. It fails closed (zero actions) on
any direct Limited Access binding, any unexpected/ambiguous direct binding on a
target, or any non-target direct principal other than the acting user. An empty
recovery plan is the terminal verification-only state.

## 4. Concurrency semantics (documented)

SharePoint role-assignment endpoints (`breakroleinheritance`,
`roleassignments/addroleassignment`, `roleassignments/getbyprincipalid` +
DELETE) expose **no ETag / IF-MATCH semantics**. Phase 3D uses **no IF-MATCH
header anywhere** (mechanically enforced), never `IF-MATCH: *`, and never
substitutes the parent-list ETag for a child/ACL resource. Concurrency safety =
fresh complete witnesses, exact target re-reads, one mutation at a time, bounded
read-only post-verification, no automatic mutation retries, and full
post-mutation reconciliation. The list ETag is a drift **witness** only. The
expired `S32-P3C-FIELD-ETAG-EXCEPTION` is not reused: Phase 3D performs no field
or list-settings mutation at all.

## 5. Tooling (this repository, rev 2)

| File | Mode | Purpose |
|---|---|---|
| `scripts/phase3d/acl-plan-core.mjs` | pure module | Single source of truth: resolution, normalization + frozen ACL fingerprint formula, exact five-principal evaluation, acting-user modeling, split normal/recovery planners, non-ACL preservation dimensions |
| `scripts/phase3d/C3-3D0-Probe-C3Contracts-ACL.js` | read-only probe | GET-only, zero mutations, two-snapshot stable; resolves live principals/roles/current user; records blockers (incl. associated-group collision); exports `window.__C3_PHASE3D0_EVIDENCE`; prints every 3D-1 binding value and the deterministic plan |
| `scripts/phase3d/C3-3D1-Configure-C3Contracts-ACL.js` | dry run (default) / armed / recovery / terminal recovery | Implements §3; evidence-bound (incl. executing-user identity — the SAME administrator must run 3D-1); `NO MUTATION CONFIRMED` vs potentially-committed distinction; partial states emit fresh recovery evidence and prohibit normal reruns |
| `scripts/s32-parity-acl-phase3d.mjs` | gate test | 66 checks (§6); proves byte-identical embedded core and the mutation-class/ETag/inheritance-argument discipline |

Tenant principal ids are **never** embedded: 3D-1's `EXPECTED_TARGET_PRINCIPALS`,
`EXPECTED_ROLE_DEFS`, and `EXPECTED_EXECUTING_USER_ID/_TITLE` are empty until the
owner pastes the reviewed 3D-0 output.

## 6. Test coverage (s32-parity-acl-phase3d, 66/66, wired into `npm run gate`)

C3 Platform Owners exact-title resolution · associated site-shell Owners group
never accepted as the target · missing/duplicate/wrong-type group rejection ·
role-definition resolution failures · exact five-principal evaluation · Platform
Owners must be Full Control · four Read assignments · Legal Full Control
corrected to Read · site-shell Owners/Members/Visitors + HR + individual extras
detection · no final Limited Access bindings · normal plan exact deterministic
sequence with `copyRoleAssignments=false` and grant-Platform-Owners-before-
acting-user-removal · no revoke actions for inherited bindings · executing-user
collision/unresolved refusals · recovery from partial unique states (acting-only,
Owners-granted, five-granted, terminal) · recovery fail-closed on Limited
Access/ambiguous bindings/stranger principals · frozen ACL fingerprint formula ·
non-ACL preservation dimensions · prohibition of `copyRoleAssignments=true` and
`clearSubscopes=true` (call form) · no IF-MATCH / no wildcard · 3D-0 GET-only ·
3D-1 ACL-only mutation classes (no `removeroleassignment` binding revokes) ·
byte-identical embedded core.

## 7. Execution runbook (owner) — CURRENT STOP: dry-run evidence only

1. Run the revised `C3-3D0-Probe-C3Contracts-ACL.js` (rev 2). Review
   `window.__C3_PHASE3D0_EVIDENCE`: blockers must be `[]`; confirm
   `C3 Platform Owners` resolves as a SharePoint group distinct from the
   associated site-shell Owners group; review the plan strings.
2. Paste the printed values into 3D-1's `EXPECTED_*` constants and run 3D-1 with
   `DRY_RUN = true` (default). Zero mutations.
3. Return both outputs for review. **Arming is NOT authorized by this revision**
   — the armed run is a separate later approval after the dry-run evidence is
   reviewed.

## 8. Evidence

**3D-0 probe (rev 1, executed + reviewed 2026-07-05):** GET-only, two stable
snapshots, zero mutations. Confirmed: GUID/URL/ItemCount 0; schema fingerprint
`3a13b28f…` (exact Phase 3C closure value); field-inventory fingerprint
`b3e726b0ad97b75a48ab77cdcaef8b80f20044391a7f5a0a150faefb5f1e7842`; ACL
fingerprint `87f278b2a2b1518b6103ece62e745cc0b6f025f75d041463d4d3982727299acc`;
list ETag `"255"`; `HasUniqueRoleAssignments=false`; inbound `[]`; scopes `[]`;
executing user is site administrator with ManagePermissions. The probe **stopped
correctly** on a real blocker: the assumed group `C3 Owners` does not exist —
the operational owner principal is `C3 Platform Owners` (id 19 observed), and
the inherited ACL contains Limited Access on all relevant principals, Legal Full
Control, multi-binding Platform Owners, the site-shell groups, HR, and the
executing user. This evidence drove the rev 2 target matrix and the uncopied
inheritance strategy.

**3D-0 rev 3 probe (executed + approved 2026-07-05):** blockers `[]`; drift vs
the rev 2 inventory classified **sharepoint-managed-metadata** (reduced schema
fingerprint intact, all 19 canonical fields exact, managed comment fields
intact); fresh field-inventory fingerprint bound:
`67a8d38477e5d9dc502b3ba09de8735a97c13f72c829723a8855c759c4f1e43d`. All other
bindings unchanged (ACL fp `87f278b2…`, ETag `"255"`, executing user #9).

**3D-1 rev 3 dry run (2026-07-05):** owner-reported terminal —
"3D-1 DRY RUN (normal) — preflights AND ALL evidence bindings PASSED; zero
mutations." (rev 3 semantics: every binding validated against live state
before the success return.)

**3D-1 rev 3 ARMED run (2026-07-05): COMPLETE — Phase 3D hosted-green.**
Owner-reported terminal banner (reachable ONLY after the script's final
verification — exact five principals, no Limited Access,
`HasUniqueRoleAssignments=true`, zero non-ACL drift — passed):

> ═══ 3D-1 COMPLETE: C3Contracts ACL = exactly five principals (C3 Platform
> Owners FC; Operations/Legal/Finance/Management Read) · no Limited Access ·
> every mutation individually witnessed + reconciled · schema/settings/
> contents/GUID/URL/inbound/scopes unchanged. STOP — NavRail activation,
> deployment, and Part 19 are SEPARATE later phases. ═══

Final direct ACL: C3 Platform Owners #19 = Full Control; C3 Operations #12,
C3 Legal #18, C3 Finance #15, C3 Management #17 = Read. Site-shell groups,
HR, and the acting administrator hold no direct list assignments.

_Evidence appendix (to append from the owner's preserved console output):_
_the seven per-action ✔ lines (or the acting-user ○ no-op), the final
normalized role-assignment inventory, and the final ACL fingerprint._

**Armed 3D-1 rev 2 run (2026-07-05): STOPPED FAIL-CLOSED, ZERO mutations.**
The `EXPECTED_PRE_FIELD_INVENTORY_FP` binding (`b3e726b0…`) no longer matched
live state. Confirmed at failure: `HasUniqueRoleAssignments=false`, ACL
fingerprint unchanged (`87f278b2…`), list ETag unchanged (`"255"`), plan
unchanged, no inheritance break, no grant, no removal, no PARTIAL STATE.
Normal mode remains valid after fresh evidence rebinding; recovery mode is not
required. This exposed the rev 2 defect fixed in §9.

Phase 3D must not be recorded complete until hosted evidence lands here.

## 9. rev 3 — gate-order correction and field-inventory drift policy

**Defect:** in rev 2, the dry run returned BEFORE evidence-binding validation,
so a stale binding could only surface in the armed run. **Correction:** 3D-1 is
now strictly ordered — (1) common live preflight; (2) full evidence-binding
validation for the active mode (targets, role definitions, ACL fingerprint,
field-inventory fingerprint, list-ETag witness, executing-user identity,
inheritance state, exact plan; schema/settings/contents/inbound/scopes enforced
by the fail-closed preflight); (3) dry-run return; (4) armed confirmation gate —
the phrase is the ONLY armed-only validation; (5) mutation execution. Recovery
mode follows the same ordering. Parity checks prove the dry-run success banner
is unreachable until every binding has passed.

**Field-inventory drift policy** (delegated classification): the full inventory
fingerprint includes `SchemaXml` and other SharePoint-managed metadata, which
the platform may change without any business meaning. Drift is **safe to
rebind** ONLY when ALL of the following remain true — reduced canonical schema
fingerprint `3a13b28f…` intact · all 19 canonical business fields genuinely
exact (verified field-by-field by the rev 3 probe, incl. Title as the base
field) · the two SP-managed comment fields keep every invariant · GUID/URL/
settings/ItemCount 0/inbound []/scopes [] unchanged · ACL inherited and
unchanged. Then the difference is by construction confined to SharePoint-managed
metadata, is documented, and the FRESH full fingerprint is bound. Anything else
is a mandatory stop. Tooling: the 3D-0 rev 3 probe classifies live drift and
prints per-field state hashes; `diff-3d0-field-inventories.mjs` diffs two saved
evidence files property-by-property (exit 1 on business-relevant drift).
