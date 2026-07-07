# A-4 — Role Model Hosted Certification (+ A-8 full-green exercise)

**Gate items:** A-4 (all roles' enforcement hosted) + the final A-8 condition (governed access-administration exercised hosted). **Author:** Architect-of-record · **Date:** 2026-07-07.
**Result: PENDING — protocol designed, owner prep = ONE disposable guest.** No pre-written results.

## Design — one drill, two gate items

Owner + Operations are already hosted-certified. What remains: the five read-only roles (legal, finance, hr, management, visitor) enforced hosted, and the Sprint-35 governed member operations exercised hosted end-to-end.

**One disposable B2B guest, role-rotated through the product**: each rotation is a real governed `ChangeRole` (exercising A-8's flows), and each landing is a role-surface certification (A-4). The drill runs in **`c3-internal`** — its two real members (owner + operations) already satisfy requester ≠ approver, so every step goes through the product with zero operator SQL. The retired fixture (an Inactive member row + its audit trail) remains as a durable, honest artifact, same discipline as the SP-era durable fixtures.

**Design finding recorded (resolver constraint):** `resolveMembership` assigns a multi-org user to their **oldest** tenant (`ORDER BY t.created_at ASC LIMIT 1`) — deterministic, consistent with claim C6 ("active org context assigned by C3"), but it means a user shared into a NEWER org cannot act there through the product until org-context switching ships (roadmap). This ruled out running the drill in certbeta with a shared operations account, and is exactly the kind of fact tenant-admin's next iteration must design for.

In V1 the five read-only roles carry an IDENTICAL capability set (read People; no submit, no review, no members). The honest certification is therefore: **each role resolves correctly from the DB assignment and lands on the read-only surface with every write/administration affordance absent and server-side denial enforced** — plus distinct-role display.

## Owner prep (one step)

**Create ONE disposable B2B guest** in Entra (exactly like E-1's): suggested display name `Role Test`, any mailbox you control. Send me its **email + Object ID**. Everything else happens in the product.

## Protocol (owner-driven in the product; Architect verifies read-only)

**Phase 1 — Provision through the product (A-8 exercise: ProvisionMember)**
1. Sign in as **m.khalailah (operations)** → Members → Provision Member: guest's email/display, role `visitor`, the guest's **real oid**, tenant id `295213e5-bd32-455e-b519-658e8fa9afce`.
2. Sign in as **owner** → Approvals → begin review → approve → execute (governed dialogs).
3. Architect verifies: `MemberProvisioned` audit row; member visible in the register.

**Phase 2 — Role surface certification × 5 (A-4) with governed rotation (A-8 exercise: ChangeRole ×4)**
For each role in `visitor → management → hr → finance → legal`:
4. Guest signs in (incognito) → certify the surface: role displays correctly; People **readable**; **no** Add Person; Approvals shows the denied state; **no** Members nav and `/members` shows the denied state; one-time spot-check: deep-link another org's record → not found.
5. Rotate: ops submits ChangeRole → owner executes → guest **re-signs in**, new role shows (per-request resolution; no session magic).
6. Architect verifies after each rotation: `MemberRoleChanged` audit rows with before/after.

**Phase 3 — Retire the fixture (A-8 exercise: DeactivateMember)**
7. Ops submits DeactivateMember → owner executes → guest's next request **denied** (AccessDenied forensic row verified).
8. Owner deletes the disposable guest in Entra. The Inactive member row remains as the durable audit-backed fixture.

**Witnessed once along the way:** the requester cannot approve their own member request (UI absence); a read-only role receives a server-side 403 on a member-change probe (Architect, direct API, read-only-safe).

## Acceptance

- Five read-only roles certified hosted: correct resolution, absent affordances, server-side denial.
- ProvisionMember / ChangeRole ×4 / DeactivateMember executed hosted through governance with same-transaction audit rows verified.
- **Consequence: A-4 green; A-8 FULLY green; Sprint 35 hosted-certified.**
- Estimated owner effort: ~30–40 minutes (mostly sign-in cycles).
