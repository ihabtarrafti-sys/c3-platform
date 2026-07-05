# C3 Contracts ACL — Sprint 32 Phase 3D

**Status:** 🟡 TOOLING COMPLETE — hosted mutation PENDING owner execution (dry-run
evidence required first). Phase 3D is NOT complete and NOT hosted-green.
**Scope:** Exact ACL configuration of the canonical `C3Contracts` list only.
**Prepared:** 2026-07-05

---

## 1. Boundary

Phase 3C (canonical schema remediation) is **hosted-green and permanently closed**
(see `Canonical Contracts Reset — Sprint 32.md` §9). Phase 3D changes **only** list
role assignments. It must not touch schema, Title configuration, list settings,
GUID, URL, or list contents, and its tooling verifies all of those dimensions
before, during (per mutation), and after execution.

List identity (closed Phase 3C state):

| Property | Value |
|---|---|
| Title | `C3Contracts` |
| GUID | `88e835ad-ffd8-4565-9364-c1c1b4f0fc2f` |
| URL | `/sites/C3/Lists/C3_Contracts` (retitled-in-place legacy URL, accepted) |
| ItemCount | `0` |
| Inbound lookups | `[]` |
| Reduced schema fingerprint | `3a13b28f94ccc462e5b5001a56a0d543cab3a74a4ba96c5913498087334bea98` |
| Settings | versioning on, major limit 10, attachments off |

## 2. Exact ACL target (owner-approved matrix)

Unique list permissions containing **exactly five principals — no extras**:

| # | Principal (SharePoint group) | Role |
|---|---|---|
| 1 | C3 Owners | Full Control |
| 2 | C3 Operations | Read |
| 3 | C3 Legal | Read |
| 4 | C3 Finance | Read |
| 5 | C3 Management | Read |

**C3 HR, C3 Members, C3 Visitors, and any other copied or direct principal must
NOT retain direct list role assignments.** V1 authoring remains Owners-only.
ACLs are the security boundary; UI role checks are UX only.

Recorded group names are NOT assumed sufficient: the 3D-0 probe resolves the
actual hosted principals (exact title, principal id, login name, principal type
= SharePoint group) and the armed run re-resolves and re-verifies them. A
missing, ambiguous, duplicated, or wrong-type group is a recorded blocker.

## 3. Method — deviation from the S30 rev2 runbook (deliberate)

S30 rev2 used `breakroleinheritance(copyRoleAssignments=false, clearSubscopes=false)`
followed by immediate grants. Phase 3D upgrades to a **grant-before-remove**
sequence that can never orphan administrative access:

1. Resolve all five principals + `Full Control`/`Read` role definitions (live).
2. Two stable, complete, read-only pre-state snapshots (list + schema + settings
   + items + ACL + inheritance + scopes + inbound + fingerprints).
3. Bind dry run and armed run to reviewed 3D-0 evidence (principal ids, role
   definition ids, pre-ACL fingerprint, field-inventory fingerprint, list ETag
   as a drift witness, and the exact deterministic plan strings).
4. Verify empty list + exact Phase 3C schema/settings.
5. `breakroleinheritance(copyRoleAssignments=true, clearSubscopes=false)` —
   **copy=true preserves every existing principal** (including the executing
   administrator's path) until replacement access is proven.
   `clearSubscopes=true` remains PROHIBITED (locked S30 rev2 rule).
6. Grant each required target binding (fixed target order, Owners first).
7. Owners Full Control is proven on the fresh witness before ANY removal; the
   executing user's `EffectiveBasePermissions` must include ManagePermissions
   before every mutation.
8. Revoke extra bindings on target principals, then remove non-target
   principals — one at a time, deterministic sorted order.
9. Fresh witness before each mutation + full reconciliation after each mutation
   (predicted ACL delta only; all non-ACL dimensions byte-stable).
10. Final verification: exactly five principals, unique permissions, zero
    non-ACL drift; final ACL fingerprint + exact role-assignment inventory printed.
11. Explicit stop — NavRail activation / deployment / Part 19 are later phases.

## 4. Concurrency semantics (documented)

SharePoint role-assignment endpoints (`breakroleinheritance`,
`roleassignments/addroleassignment`, `roleassignments/removeroleassignment`,
`roleassignments/getbyprincipalid` + DELETE) expose **no ETag / IF-MATCH
semantics**. Therefore Phase 3D uses **no IF-MATCH header anywhere** (mechanically
enforced by the parity harness), never `IF-MATCH: *`, and never substitutes the
parent-list ETag for a child/ACL resource. Concurrency safety = fresh complete
witnesses, exact target re-reads, one mutation at a time, bounded read-only
post-verification, and full post-mutation reconciliation. The list ETag is
captured as a drift **witness** only (role-assignment mutations may or may not
advance it) and is excluded from per-mutation non-ACL invariants.

The narrow `S32-P3C-FIELD-ETAG-EXCEPTION` **expired with Phase 3C closure and is
not reused**: Phase 3D performs no field or list-settings mutation at all.

## 5. Tooling (this repository)

| File | Mode | Purpose |
|---|---|---|
| `scripts/phase3d/acl-plan-core.mjs` | pure module | Single source of truth: principal/role resolution, ACL normalization + frozen fingerprint formula, exact five-principal evaluation, deterministic grant-before-remove planner, non-ACL preservation dimensions |
| `scripts/phase3d/C3-3D0-Probe-C3Contracts-ACL.js` | read-only probe | Owner-executed, GET-only, zero mutations; resolves live principals/roles/current-user/site+list ACL; two-snapshot stable; records blockers; exports `window.__C3_PHASE3D0_EVIDENCE`; prints every binding value and the deterministic plan for 3D-1 |
| `scripts/phase3d/C3-3D1-Configure-C3Contracts-ACL.js` | dry run (default) / armed / recovery / terminal recovery | Owner-executed mutation script implementing §3; evidence-bound; one witnessed reconciled mutation at a time; `NO MUTATION CONFIRMED` vs potentially-committed distinction; partial states emit fresh recovery evidence and prohibit normal reruns; terminal recovery is verification-only |
| `scripts/s32-parity-acl-phase3d.mjs` | gate test | 56 checks (see §6); also proves the browser scripts embed the pure core byte-identically and obey the mutation-class/ETag discipline |

Tenant-specific principal ids are **not** embedded in the tooling: 3D-1's
`EXPECTED_TARGET_PRINCIPALS` / `EXPECTED_ROLE_DEFS` are empty until the owner
pastes the values printed by the reviewed 3D-0 probe.

## 6. Test coverage (s32-parity-acl-phase3d, wired into `npm run gate`)

Exact five-principal evaluation · Owners-must-be-Full-Control · four Read
assignments · missing/duplicate/wrong-type group rejection · missing/duplicate
role-definition rejection · HR/Members/Visitors and arbitrary-extra detection ·
Limited-Access-on-target blocker · inherited vs unique handling (break only when
inherited) · deterministic ordering + grant-before-remove · Owners never
revoked/removed invariant · recovery planning (partial → remaining actions only;
complete → terminal empty plan) · frozen ACL fingerprint formula · non-ACL
preservation dimensions (schema, field inventory, settings, identity, contents,
inbound, scopes; list ETag deliberately excluded) · no IF-MATCH / no wildcard /
`clearSubscopes=false`-only · 3D-0 GET-only · 3D-1 ACL-only mutation classes ·
byte-identical embedded core.

## 7. Execution runbook (owner)

1. Run `C3-3D0-Probe-C3Contracts-ACL.js` in the site console. Review blockers
   (must be `[]`), resolved principals, plan, and evidence JSON.
2. Paste the printed values into 3D-1's `EXPECTED_*` constants. Run 3D-1 with
   `DRY_RUN = true` (default). Expected dry-run evidence: preflights PASS,
   identical plan to 3D-0, zero mutations.
3. Return dry-run output for review. Only after review: set `DRY_RUN = false`,
   `CONFIRM` to the literal phrase, and execute. Any partial failure prints
   fresh recovery evidence; resume only via `RECOVERY_MODE`.
4. Post-green: paste the final ACL inventory + fingerprint into §8.

## 8. Evidence (pending)

- 3D-0 probe evidence: _pending owner execution_
- 3D-1 dry-run evidence: _pending owner execution_
- 3D-1 armed execution + final ACL fingerprint: _pending owner execution_

Phase 3D must not be recorded complete until hosted evidence lands here.
