# Runbook — Tenant Exit & Erasure Ceremony (B-5, Phase E1 → E2)

**Purpose:** terminate an organization's access (E1), return their data (export), then erase their records (E2) — with the deliberate friction the design mandates. **Erasure is a ceremony, not an API call.** Design: [B5-org-scoped-export-and-exit.md](../design/B5-org-scoped-export-and-exit.md).
**Tooling:** `npm run exit:tenant` (dry-run by default) — `packages/persistence/scripts/exit-tenant.ts`. Owner-run, `DATABASE_ADMIN_URL` only (trigger control needs table ownership). Never automated.

## Phase E1 — access termination (immediate, reversible)

1. **Sole-tenant members** (this org is their only membership): set `app_user.is_active = false`. Effect is next-request (A-7 hosted-certified).
2. **Shared members** (also belong to another tenant): DELETE their `role_assignment` + `tenant_membership` rows for this tenant only — they stay active elsewhere.
3. Record the E1 action + date in the exit register. The retention clock (per the Owner+Counsel policy) starts here.

`exit:tenant` **refuses to execute while any active user still holds a membership** in the tenant — E1 incompleteness is a hard blocker, not a warning.

## Data return — export before erasure

Run the organization-scoped export and deliver the bundle per the exit agreement:
```
npm run export:tenant -- --tenant-slug <slug> --out <dir>
```
Keep `manifest.json` — the execute step **requires** it as proof of data return.

## Phase E2 — erasure (after the retention window; irreversible)

**1. Dry-run first (cannot mutate — read-only transaction):**
```
npm run exit:tenant -- --tenant-slug <slug>
```
Review the report: active members must be 0; sole vs shared user split correct; per-table counts plausible against the export manifest.

**2. Execute (dual authorization):** the requester types `--confirm`; the **second authorizer** personally sets `C3_EXIT_SECOND_CONFIRM` — two humans, two typed entries:
```
C3_EXIT_SECOND_CONFIRM=<slug> npm run exit:tenant -- \
  --tenant-slug <slug> --execute --confirm <slug> --manifest <dir>/manifest.json
```

What actually happens is **three phases plus a separate finalize — deliberately NOT
one transaction** (CR-022: an earlier version of this page said "ONE transaction",
which was false, and false in the *reassuring* direction — the real design is safer
than the prose was):

- **Phase 0 (its own committed transaction):** the tenant is marked `Exiting` and
  every intake link is revoked, *then* commit. From this moment no new upload can
  start and no new lease can be acquired. **A crash after this point leaves a
  resumable state, not a partial erasure** — re-running execute on an `Exiting`
  tenant is a no-op re-entry, which is exactly what "ONE transaction" could not
  have given you: a single transaction that died would have to start over from a
  tenant that still looked live.
- **Data phase (the big transaction):** in-flight upload leases drained to zero →
  append-only triggers (`audit_event`, `approval_event`) disabled → tenant-scoped
  deletes in FK-safe order → sole-tenant users + identity bindings erased (shared
  users preserved) → triggers re-enabled → **in-transaction zero-row post-checks**
  → commit. Any failure rolls back this phase including trigger state. The tenant
  ROW survives this phase — identity is held for finalize.
- **Blob phase (after commit):** object-store prefixes deleted and re-listed to
  zero. Storage deletes cannot ride a database transaction, which is one more
  reason the one-transaction sentence could never have been true.

**3. Finalize — the explicit point of no return.** The data-phase output prints the
tenant uuid; finalizing is its own invocation, with the same dual authorization:
```
C3_EXIT_SECOND_CONFIRM=<slug> npm run exit:tenant -- --finalize <tenant-uuid> --confirm <slug>
```
This removes the tenant row itself and registers the permanent erasure authority
(`erased_tenant_prefix`) that the post-finalize janitor sweeps forever after.
**Until finalize runs, the exit is resumable; after it, the tenant's identity is
gone and only the janitor's opaque prefixes remain.**

**4. File the printed reconciliation report** in the exit register (the record *of* the erasure is retained; it contains counts, not content). Note the backup-residual horizon: encrypted backups keep the data until lifecycle expiry (max 180 days), and **any post-exit restore must re-apply this erasure** before serving traffic.

## Refusal conditions (all fail closed, nothing changes)

- unknown tenant slug;
- execute without BOTH confirmations matching the slug;
- execute while any active user holds a membership (E1 incomplete);
- execute without a matching export `manifest.json` (unless `--no-export-bundle` is explicitly and deliberately passed);
- any in-transaction post-check failure → rollback.

## What is never touched

`access_event` (platform-level denial stream — not the org's records), platform logs (expire on platform schedule), other tenants' rows (proven by test: the ceremony erases exactly one tenant), and shared users' accounts/identities.
