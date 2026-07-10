# Tier 0.5 — Approver delegation + backup-status tile

**Status: BUILT + CERTIFIED (this increment). Migration 0031.**

## Approver delegation

The single-approver reality: today only the OWNER can review/execute. When the
owner travels, governance stalls (the S41 wedge class, people-shaped). The
remedy: the owner grants **review+execute standing as one unit** ("act as
approver") to a named active member for a **bounded window**, revocable at any
moment, fully audited.

### The law
- **Grant** = owner-only, direct-but-audited (`DelegationGranted`).
  *Interpretation note:* the recorded phrase "governed+audited" is implemented
  as direct-audited — routing the grant through the approval pipeline would
  wedge single-owner tenants (no second approver exists to approve the
  delegation that creates the second approver). Same posture as member/role
  management, which this is a species of. Flagged for owner ratification.
- **Window**: `starts_on..ends_on` (dates, inclusive). Active =
  not revoked AND today within window. Expiry is automatic — nothing to clean up.
- **One unrevoked delegation per grantee** (partial unique index, friendly 409).
- **Grantee** must be an active member; roles that already hold review standing
  (owner) are refused (meaningless grant = probably a mistake).
- **Separation of duties is NOT delegable**: a delegate can never decide or
  execute their OWN submission — `checkSelfReview` runs on every path exactly
  as before.
- **Revoke** = owner-only, reason mandatory, `DelegationRevoked`, immediate.
- Rows are never deleted (revoked/expired stay as history; no DELETE grant).

### Enforcement (fail-closed, data-driven)
`policy.ts` stays pure role-math. The pipeline usecases (review family +
execute) ask, inside the transaction: role allows? else
`tx.hasActiveDelegation(identity, today)`. The approvals READ surface
(`listApprovals`/`getApproval`/history) gets the same effective check.
`/api/v1/me` reflects it: an active delegate's capability view reports
`canReviewApproval/canExecuteApproval = true` — the UI stays truthful with the
API (the buttons a delegate sees are buttons that work).

### Cockpit truth
New check kind `DelegationActive` (watch band): an active delegation is
ELEVATED AUTHORITY and stays visible in the Situation Room for its entire
life — "Review authority delegated to X until Y". First crossing lands one
bell row (dedupe key `DelegationActive:DLG-XXXX`); expiry/revocation silences
the check automatically. Signals-ship-with-features law honored.

### Surface
Settings → "Approver delegation" (owner-only section): grant form (member,
window, reason), register (grantee, window, state: Scheduled/Active/Expired/
Revoked), revoke with reason. API: `GET/POST /api/v1/delegations`,
`POST /api/v1/delegations/:delegationId/revoke`.

## Backup-status tile

Settings gets a "Backups" tile answering one question honestly: **when did the
last backup succeed?**

- Optional env `BACKUP_STATUS_R2_ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET`
  (all-or-none; partial refuses boot; none → tile says "Not configured").
- Reads ONLY `status/latest-success.json` (the marker the backup cron already
  writes) with a read-only credential — never lists, downloads, or decrypts dumps.
- Staleness threshold 36h (same as the GitHub monitor — one truth).
- `GET /api/v1/settings/backup-status` (owner-gated).
- States: Not configured (neutral, honest) / Healthy: last backup Xh ago /
  STALE: no success in Xh (attention).

## Production split
Runbook only — `docs/runbooks/production-split.md`. Owner infrastructure acts;
zero code changes required (the API is env-driven end to end).

## Evidence
- `apps/api/test/delegations.test.ts` — owner-only grant/revoke; grantee
  validation; window math; one-live-per-grantee 409; delegate can review+
  execute OTHERS' requests within window; self-review still blocked; expired/
  revoked refused; /me reflects standing; DelegationActive check + bell row.
- `apps/api/test/env.test.ts` — BACKUP_STATUS_* all-or-none.
- `apps/web/e2e/delegation.spec.ts` — grant → delegate decides (reject, no
  side effects) → revoke → standing gone. Creates no people/teams; leaves one
  Rejected approval + one Revoked delegation as history.
