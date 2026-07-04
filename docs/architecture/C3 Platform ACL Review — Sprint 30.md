# C3 Platform ACL Review — Sprint 30

**Status:** ✅ COMPLETE — Phase B executed and PASS on all four lists (2026-07-04); hosted per-role tests green; Sprint 30 closure conditions in §7 SATISFIED
**Track:** Parallel security track beside Sprint 30 source work — closure rule in §7
**Method:** Proven S29A/S29B process, extended by the rev 2 console package (unique-child-scope preflight; `clearSubscopes=false` always; programmatic inherited-posture verification; post-mutation child re-audit)
**Prepared:** 2026-07-04 · **Completed:** 2026-07-04

---

## 1. Problem

Five operational lists still inherit site permissions: **C3People, C3Credentials,
C3Journeys, C3Missions**, and the Contracts surface. Inherited site **Members =
Edit** and **C3 Legal = Full Control** allow any site member to edit
operational-truth rows directly — a standing ADR-013 governance bypass, and
(new in Sprint 30) a direct integrity risk to the Mission Readiness Cockpit:
an edited C3Missions date or C3Credentials expiry silently changes every
readiness verdict.

C3Contracts remains **deferred** (list unprovisioned; activation is its own
future decision).

## 2. Phase A — source write-path audit (2026-07-04, from direct inspection)

Every SharePoint write call site was audited (`grep` over
`services/sharepoint/*.ts` + `useExecuteApproval.ts`). Findings:

| List | Application write paths | Executing session |
|---|---|---|
| C3People | AddPerson execution (POST TMP → MERGE PER-XXXX; stamp recovery) — full ADR-013 | **Owner only** (approval execution) |
| C3Credentials | AddCredential / DeactivateCredential execution (POST-then-MERGE; MERGE IsActive=false; recovery) — full ADR-013 | **Owner only** |
| C3Journeys | InitiateJourney execution (POST-then-MERGE) — owner; **journey lifecycle Complete/Suspend/Resume/Cancel (MERGE)** — S19 exemption, executed DIRECTLY from the operator's session | **Owner + Operations** |
| C3Missions | **NONE.** All SharePointMissionService writes target C3MissionParticipants / C3MissionKitAssignments. `confirmMission` / `updateMissionStatus` are throwing stubs (TD-26). Mission rows are created/maintained manually (owner browser REST provisioning) | Manual only |

Already hardened (S29A/S29B — unchanged): C3MissionKitAssignments,
C3PersonApparelProfiles, C3MissionParticipants, C3Approvals.

**Open question — RESOLVED (owner decision, 2026-07-04):** Platform Owners AND
Operations both legitimately create and edit C3Missions rows directly (manual
authoring — the code has no app write path; TD-26 remains intact). The §3
matrix reflects the confirmed posture: C3Missions Operations = Edit.

## 3. Target matrix (owner-confirmed 2026-07-04 — APPLIED)

| List | Platform Owners | Operations | HR | Finance | Management | Legal | Members (site) |
|---|---|---|---|---|---|---|---|
| C3People | Full Control | Read | Read | Read | Read | Read | Read (Edit removed) |
| C3Credentials | Full Control | Read | Read | Read | Read | Read | Read (Edit removed) |
| C3Journeys | Full Control | **Edit** (S19 lifecycle exemption) | Read | Read | Read | Read | Read (Edit removed) |
| C3Missions | Full Control | **Edit** (owner-confirmed manual authoring) | Read | Read | Read | Read | Read (Edit removed) |

Rationale notes:

- **C3Journeys Operations = Edit is mandatory** — journey lifecycle writes run
  in the operator's own session; Read would 403 a live approved path.
- **C3Missions Operations = Edit is the confirmed owner decision** (supersedes
  the earlier owners-only proposal): both roles legitimately author mission
  rows manually; no application write path exists (TD-26 stubs intact).
- Owner approval executions run in the owner session — no other role needs
  edit on People/Credentials.
- Requester flows (AddPerson/AddCredential/etc.) write only to C3Approvals
  (already Add-only hardened); they need no rights on the target lists.
- C3 Legal drops from inherited Full Control to Read on all four lists.
- Site Visitors retained at Read where previously granted (visitor rendering).

## 4. Phase B — application runbook (proven process, owner executes)

Per list, in order:

1. **Before-state export by principal ID:**
   `GET /_api/web/lists/getbytitle('<LIST>')/roleassignments?$expand=Member,RoleDefinitionBindings`
   Save JSON into §6 evidence.
2. **Verify administrators and role bindings:** confirm `IsSiteAdmin` for the
   executing account; confirm group identities by ID, not display name.
3. Re-confirm the write-path audit above (§2) — fail closed on any surprise.
4. Confirm the target matrix row (§3) — C3Missions requires the §2 owner
   answer first.
5. **Break inheritance without copying — and WITHOUT clearing child scopes:**
   `POST /_api/web/lists/getbytitle('<LIST>')/breakroleinheritance(copyRoleAssignments=false, clearSubscopes=false)`
   (rev 2 correction: `clearSubscopes=true` is PROHIBITED — it wipes child
   item/folder ACLs, which `resetroleinheritance` cannot reconstruct. A
   unique-child-scope preflight audit precedes any mutation and fails closed
   if child scopes exist.)
6. **Explicit least-privilege grants** via
   `POST .../roleassignments/addroleassignment(principalid=<id>, roledefid=<id>)`
   (Full Control 1073741829, Edit 1073741830, Read 1073741826 — verify IDs on
   the site first; custom levels differ).
7. **Direct-endpoint verification** (the `$select` shortcut can return stale
   `HasUniqueRoleAssignments` — use the direct endpoint):
   `GET .../lists/getbytitle('<LIST>')/HasUniqueRoleAssignments` and re-export
   role assignments as the after-state.
8. **Hosted per-role tests** (§5).
9. Record evidence in §6 and update this document's status line.

Never delete rows, lists, or groups. No `copyRoleAssignments=true`. Site-level
permissions remain untouched — this is list-scoped only.

## 5. Hosted per-role validation checklist (Part of Sprint 30 hosted gate)

For each hardened list, from live sessions:

- [ ] Owner: full CRUD unaffected; approval executions (AddPerson,
      AddCredential, DeactivateCredential, InitiateJourney) still execute green.
- [ ] Operations: **journey lifecycle transition succeeds** (Complete or
      Suspend on a test journey — the critical regression check);
      direct edit of a C3People/C3Credentials/C3Missions row → 403;
      governed submissions to C3Approvals still succeed (Add-only unchanged).
- [ ] HR / Finance / Management / Legal: rows readable; any direct edit → 403.
- [ ] Site member (no C3 group): no edit anywhere on the four lists.
- [ ] MissionWorkspace readiness strip renders identical before/after
      (reads are unaffected by the hardening).

## 6. Evidence (Phase B executed 2026-07-04 — rev 2 console package, one list at a time, dry-run first)

All four executions returned **PASS** with: `HasUniqueRoleAssignments=true` via the
direct endpoint; exact-match explicit assignments (no unexpected principals, no role
mismatches, no missing grants); **zero unique child scopes before AND after mutation**
(preflight + post-check); inherited-posture verification green before mutation (site
Members Edit + C3 Legal Full Control confirmed, then removed); acting-admin self
assignment removed (site-admin bypass retained). Full BEFORE-STATE / AFTER-STATE JSON
console captures archived by the owner from the execution session.

| List | Before-state export | Break (copy=false, clearSubscopes=false) + grants | After-state verified (direct endpoint) | Per-role hosted tests |
|---|---|---|---|---|
| C3People | ✅ 2026-07-04 (inherited; Members Edit, Legal FC) | ✅ PASS | ✅ unique; matrix exact; 0 child scopes | ✅ Ops/HR/Legal/member edit → 403; owner executions green |
| C3Credentials | ✅ 2026-07-04 | ✅ PASS | ✅ unique; matrix exact; 0 child scopes | ✅ direct edits → 403; owner executions green |
| C3Journeys | ✅ 2026-07-04 | ✅ PASS | ✅ unique; matrix exact; 0 child scopes | ✅ **Operations lifecycle transition SUCCEEDS**; other roles 403 |
| C3Missions | ✅ 2026-07-04 | ✅ PASS | ✅ unique; matrix exact; 0 child scopes | ✅ **Operations mission authoring SUCCEEDS**; other roles 403 |

## 7. Sprint 30 closure rule (primary lead architect directive, 2026-07-04) — **SATISFIED**

> **Outcome (2026-07-04):** C3People, C3Credentials, and C3Journeys hardened and
> hosted-validated per the rule below. C3Missions authorship was CONFIRMED by the owner
> (Owners + Operations), so the controlled-deferral path was not needed — C3Missions was
> hardened and validated in the same pass. C3Contracts remains deferred to its
> provisioning/activation decision (tracked in the Tech Debt Register).

**C3People, C3Credentials, C3Journeys** — their audited matrices are
unambiguous (§2/§3): Phase B hardening AND hosted per-role validation MUST be
complete and green **before Sprint 30 closes**. Should any of these matrices
become ambiguous during Phase B, stop and escalate — do not harden on an
unresolved matrix.

**C3Missions** — do NOT change live permissions until the legitimate manual
authoring role is confirmed (§2 open question). If authorship remains
unresolved at closeout, Sprint 30 may close ONLY as a **controlled deferral**
with ALL of the following recorded:

1. an explicit owner-approved deferral of the C3Missions hardening;
2. the inherited-permission risk (site Members Edit / Legal Full Control on
   C3Missions) re-entered as an open item in the Tech Debt Register and
   backlog;
3. current C3Missions permissions left unchanged — no partial hardening;
4. the exact evidence still required documented here: the confirmed list of
   principals who legitimately create/maintain C3Missions rows, after which
   §4 applies to the C3Missions row of §3 unchanged.

This is a controlled deferral, not an ambiguous unfinished checklist item.
