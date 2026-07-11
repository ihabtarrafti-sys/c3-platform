# Track B6 — Guest intake (tokenized sandbox submissions)

**Status: BUILT. Migration 0040.** Sixth Track B item; ships solo (a public
surface). Scope confirmed by the owner 2026-07-11: the **new-joiner onboarding**
door **with quarantined file uploads** (the full backbone), on top of the
tokenized-sandbox framework.

Retires the manager-as-typist: a new joiner fills their own details instead of
a manager transcribing a WhatsApp message. **Unlocks the parked S12 variance 2**
(the bank-form one-time-fill → wipe ceremony) — the same tokenized-sandbox
scaffold.

## The shape

A staff member (owner/operations) mints a **single-purpose, expiring capability
link** and sends it to a guest. The guest opens it — no account, no login —
fills an onboarding form, optionally attaches files, and submits. The answers
land in a **sandbox** (`intake_submission`), never in live data. Staff review,
then **promote** it through the existing AddPerson governed pipeline (under the
reviewer's own identity) or **reject** it (details wiped).

## How a public surface stays safe

1. **Capability tokens.** Mint returns a 256-bit URL-safe token ONCE; only its
   SHA-256 is stored (`intake_link.token_hash`). Unguessable ⇒ no tenant
   enumeration. The token is the whole capability.
2. **Atomic claim.** Submitting resolves + validates + consumes the link in one
   row-locked step (`intake_claim`, SECURITY DEFINER) — no double-use, no TOCTOU.
   A non-consuming `intake_peek` backs the form load.
3. **Sandbox quarantine.** The guest's answers land in `intake_submission` only;
   files land in a `intake/<tenant>/<submission>/…` R2 prefix, never the live
   document store. Tenant-isolated by RLS.
4. **The guest is never an actor.** No auth, no privilege, a tiny public route
   allowlist (`/api/v1/intake/public/*` — the only `/api/v1` auth exemption
   beyond the dev login), and a write path (`p.guest`) that touches only the
   sandbox table.
5. **Governed promotion.** Promote mints an AddPerson approval exactly as
   `submitAddPerson` does, in ONE transaction with the sandbox stamp (no
   half-promote → dup-approval on retry). The person exists only after an owner
   approves + executes. The joiner's contact/DOB/sizes ride the approval's
   NOTES (never a silent write of governed fields from a public form); uploads
   attach to the person post-execute (copy quarantine→live via the S4 attach).
6. **Wipe-on-reject.** Rejecting scrubs the payload + upload metadata to NULL
   and deletes the quarantined blobs, leaving a Rejected tombstone — respecting
   the no-hard-DELETE law (the CHECK makes a Rejected row with a surviving
   payload unrepresentable).
7. **Rate-limited.** The global per-IP ceiling applies to the public routes.
   Files are per-file size-capped (the S4 ceiling) + type-allowlisted
   (`documentBytesMatchDeclaredType`) + count-bounded (6); stored incrementally
   with drain-on-failure compensation (no orphan blobs).

## Signals law

Guest intake creates a review queue, not an obligation on the cockpit — **no
new cockpit signal**. The sandbox page is the surface; the S10 bell is untouched.
Recorded as deliberate (the passive-feature pattern of B2/B3/B4).

## The one deliberate RLS exception

`intake_link` is `ENABLE` (NOT `FORCE`) RLS — every other tenant table is
`FORCE`. This lets the owner-owned SECURITY DEFINER resolvers (`intake_peek`,
`intake_claim`) bypass RLS to resolve a token to its tenant BEFORE any tenant
context exists (the guest has none). Staff access (c3_app, not the owner) is
still RLS-scoped to its own tenant. `intake_submission` keeps `ENABLE + FORCE`.

## Mechanics

- **0040** `intake_link` + `intake_submission` (RLS, grants, composite tenant
  FK, state-shape CHECK) + `intake_peek` / `intake_claim` SECURITY DEFINER
  gateways + tenantTables registry (export/exit).
- **domain/intake.ts** kinds/statuses/schemas + `onboardingToAddPerson`
  (operational fields → AddPerson; contact/sizes → notes, capped at 2000).
- **authz** `canManageIntake` (owner/operations) + `assertManageIntake`.
- **application/intakeOps.ts** staff (create/list/revoke, sandbox review,
  promote/reject, resolvePromotedPerson) + guest (`submitGuestIntake`).
- **persistence** the `guest` port (raw tx: definer claim → RLS-scoped insert),
  staff read/write methods.
- **api** staff routes `/api/v1/intake/links|submissions/*` + the public
  `/api/v1/intake/public/:token` (GET peek, POST multipart submit); token
  mint/hash server-only (`intakeToken.ts`); DTOs never expose the storageKey.
- **web** staff `IntakePage` (mint + sandbox review, gated on `canManageIntake`)
  + the PUBLIC `GuestIntakePage` at `/intake/:token` (OUTSIDE the shell/session,
  plain fetch, no bearer).

## Deferred (honest follow-ups)

- **A dedicated `c3_guest` DB-role floor.** V1's sandbox-only guarantee is the
  app + schema layer + the narrow allowlist + the definer claim. A NOLOGIN
  `c3_guest` role reached via `SET LOCAL ROLE` (INSERT on `intake_submission`
  only) would add a DB-level privilege floor — flagged as **B6-followup**, since
  roles are bootstrap-provisioned infra.
- **A behavioral E2E** of the two-context flow (staff mint → guest submit →
  promote) — the API integration test (`apps/api/test/intake.test.ts`, 9 cases:
  full lifecycle incl. upload/download/attach, single-use, revoke, unknown,
  type-refusal, reject-wipe, role gating, cross-tenant, public-scope) is the
  behavioral proof for this cut.
- **More doors** (travel / vendor-invoice) — thin additions to the framework.
- **S12 variance 2** (bank-form one-time-fill → wipe) — now unblocked.

## Verification

Gate (typecheck all + vitest all: 619) + E2E 25/25 green. New: `intake.test.ts`
(api, 9), `intake.test.ts` (domain), `db.test.ts` (0040 applies; registry =
catalog; RLS isolation holds). The public SW is unaffected. The service worker
and guest form are verified on live staging after deploy.
