# C3 Second-Eye Audit Report

**Owner copy — independent local review**

**Scope:** webv0 only  
**Final observed snapshot:** 2026-07-10  
**Method:** migrations in filename order, then domain, authz, application use cases, API/backup, and web; REVIEW-INPUT-PLAN.md was read only after the independent view was formed.

## Executive summary

- No confirmed Critical finding; eight High findings require owner attention before treating the platform as operationally safe.
- The sharpest security issues are unrestricted delegated access to approval payloads and an unsigned backup-restore trust boundary.
- Financial state is not transactionally closed: settlement, source receipts, allocations, revocation, and payouts can diverge under valid edits or concurrency.
- The displayed organization/team P&L omits per-diem expense while presenting totals and ROI without that limitation in the user-facing copy.
- Tenant export/exit is nine tenant tables behind the schema; export loses current-domain data and exit rolls back when those omitted tables contain rows.
- The migration ledger records filenames only, so editing an already-applied migration can silently split deployed schema from the repository.
- The final full gate passed 9 workspace typechecks and 531 tests, but the confirmed gaps are cross-transaction, cross-registry, or trust-boundary properties the gate does not exercise.
- Strong controls do exist: ordinary read models structurally omit PII/financial fields, core approval payloads are DB-immutable, self-review fails closed, and the normal allocator produces exact sums.

## Scope, test result, and snapshot note

No network request, deployment command, cloud CLI, or external host was used. All inspection and verification were local and confined to the repository.

- The first standalone npm run typecheck encountered a web error at apps/web/src/components/PersonV2Sections.tsx:49 because People-v2 source files were changing during the audit.
- npm run test:unit then passed: 25 files, 245 tests.
- After the source settled, npm run gate passed in 840.3 seconds: all 9 workspace typechecks, 67 test files, 531 tests, embedded-PostgreSQL suites, production-bundle auth inspection, and the tracked-file NUL audit.
- Citations below refer to the final observed files. Migration 0032_people_v2.sql and related People-v2 files changed in place during the review. That is not itself treated as a product defect, but it makes H-08 immediately relevant.

## Controls independently verified

- Approval payload/operation/submitter/target immutability is enforced by the approval_payload_immutable trigger, not merely convention (webv0/packages/persistence/migrations/0001_schema.sql:145-164).
- Identity comparison blocks equal or indeterminate requester/reviewer identities (webv0/packages/domain/src/identity.ts:53-62), including delegated review and execution (webv0/packages/application/src/usecases/reviewApproval.ts:45-63; webv0/packages/application/src/usecases/executeApproval.ts:151-169).
- Approval decision/execution locks the approval row and uses an expected-version predicate; already-executed requests return idempotently (webv0/packages/application/src/usecases/executeApproval.ts:151-197; webv0/packages/persistence/src/writeTx.ts:169-185).
- Ordinary Person output structurally omits the PII keys when the caller lacks standing (webv0/apps/api/src/dto.ts:348-381); ordinary Agreement queries similarly remove financial value before DTO serialization (webv0/packages/application/src/usecases/queries.ts:89-118).
- The normal prize allocator uses largest remainder, asserts the final sum, and has odd-pool tests (webv0/packages/domain/src/distribution.ts:112-137; webv0/packages/domain/test/distribution.test.ts:20-46).
- Product routes consistently use an /api/v1 prefix, which is a useful versioning baseline.

## Critical

No confirmed Critical findings.

## High

### H-01 — Delegation grants unscoped access to PII and financial approval payloads

**Evidence**

Delegation substitutes for the normal approval-view assertion:

> const delegated = await p.reads.forActor(actor).hasActiveDelegation(actor.identity.toLowerCase(), today);
>
> if (!delegated) throw err;
>
> — webv0/packages/application/src/usecases/queries.ts:137-145

The API then sends the complete payload:

> export function toApprovalDto(a: Approval): ApprovalDto {
>
> ...
>
> payload: a.payload,
>
> — webv0/apps/api/src/dto.ts:408-416

The list and detail routes both use that serializer directly (webv0/apps/api/src/app.ts:568-582). Approval payload variants include protected fields:

> dateOfBirth: dateOnly.optional(),
>
> nationality: trimmedOptional(120).optional(),
>
> — webv0/packages/domain/src/person.ts:108-118

> amountMinor: positiveAmountMinor.nullish().transform(...)
>
> currency: currencyCodeSchema.nullish().transform(...)
>
> percentBps: percentBpsField.nullish().transform(...)
>
> — webv0/packages/domain/src/agreementTerm.ts:175-195

This is not limited to operations/HR/finance. The API test deliberately permits an active visitor delegation:

> granteeIdentity: 'visitor@alpha.com'
>
> expect(visitorDlg.state).toBe('Active');
>
> — webv0/apps/api/test/delegations.test.ts:153-157

The base role matrix still gives legal, finance, HR, management, and visitor different PII/financial capabilities (webv0/packages/domain/src/roles.ts:181-189), while /me only overlays review/execute standing (webv0/apps/api/src/app.ts:489-495).

**Impact**

A delegated visitor, legal user, HR user, or other active member can list and retrieve every approval payload, including DOB, contacts, member-administration inputs, import rows, agreement values, and term amounts outside that role's ordinary disclosure boundary. Delegation also substitutes for execution capability (webv0/packages/application/src/usecases/executeApproval.ts:155-167), and the execution response can return an unprojected Agreement (webv0/apps/api/src/app.ts:637-645). This defeats the platform's stated structural-omission model.

**Recommended fix**

Make delegation explicit and scoped by operation family and disclosure entitlement. Return a small approval summary from list endpoints; build an actor/effective-delegation-aware detail projection for each payload variant. Refuse a grant whose scope requires PII/financial disclosure the grantee may not receive. Apply the same projection to transition and execution responses. Add tests for visitor, legal, finance, HR, and management across every payload union member.

### H-02 — Restore accepts unsigned bucket metadata before privileged pg_restore

**Evidence**

The restore drill trusts two bucket-controlled JSON documents without schema or signature verification:

> const latest = JSON.parse(Buffer.from(await latestRes.Body!.transformToByteArray()).toString('utf8'));
>
> const manifest = JSON.parse(Buffer.from(await manRes.Body!.transformToByteArray()).toString('utf8'));
>
> — webv0/apps/backup/src/restore-main.ts:96-102

The encrypted and plaintext hashes are compared only with values from that same unsigned manifest:

> if (encSha !== manifest.encryptedSha256) throw new Error('Encrypted artifact sha256 mismatch.');
>
> ...
>
> if (plainSha !== manifest.plaintextSha256) throw new Error('Decrypted dump sha256 mismatch.');
>
> — webv0/apps/backup/src/restore-main.ts:104-116

The encryption recipient is intentionally public:

> /** age recipient (public) — e.g. age1... . NEVER a private identity. */
>
> — webv0/apps/backup/src/env.ts:19-20

The accepted archive is then restored using the administrative URL:

> const restoreUrl = new URL(adminUrl);
>
> ...
>
> await run('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '-d', restoreUrl.toString(), dumpPath]);
>
> — webv0/apps/backup/src/restore-main.ts:122-128

**Impact**

A principal able to replace the bucket marker, manifest, and object can create a matching encrypted artifact because recipient encryption proves confidentiality, not producer authenticity. When an operator runs the drill, attacker-chosen archive contents reach a privileged PostgreSQL restore. The disposable database limits direct data overwrite, but restored SQL can still execute with the restore role's privileges.

**Recommended fix**

Sign a canonical manifest with a key unavailable to bucket writers and verify it before any download/decryption/restore. Bind environment, immutable object version, object key, byte length, both hashes, schema version, backup timestamp, and source commit into the signature. Schema-validate both JSON documents, pin an object version rather than a mutable key, use the least-privileged restore role possible, and test tampered marker/manifest/artifact cases.

### H-03 — Tenant export and exit omit nine current tenant tables and document bytes

**Evidence**

The export registry ends with the older finance/mission/event set:

> { name: 'agreement_term', ... },
>
> { name: 'mission_line', ... },
>
> { name: 'mission_budget', ... },
>
> { name: 'mission_participant', ... },
>
> { name: 'approval_event', ... },
>
> { name: 'audit_event', ... },
>
> — webv0/packages/persistence/src/exportTenant.ts:112-118

The exit registry likewise stops after the pre-0024 tables:

> const TENANT_TABLES = [
>
> 'audit_event',
>
> ...
>
> 'role_assignment',
>
> 'tenant_membership',
>
> ] as const;
>
> — webv0/packages/persistence/src/exitTenant.ts:58-80

An exhaustive migration-to-registry comparison found these omitted tenant tables: document, invoice, team, team_membership, distribution, distribution_share, claim, notification, and delegation. Their tenant keys are introduced at webv0/packages/persistence/migrations/0024_documents.sql:15-17, 0026_invoices.sql:21-23, 0027_teams.sql:18-20 and 46-48, 0028_distributions.sql:17-19 and 50-52, 0029_claims.sql:16-18, 0030_notifications.sql:14-16, and 0031_delegations.sql:8-10.

The Mission projection is also stale:

> SELECT id, tenant_id, mission_id, name, game_title,
>
> starts_on::text AS starts_on, ends_on::text AS ends_on,
>
> notes, is_active, version, created_at, updated_at
>
> — webv0/packages/persistence/src/exportTenant.ts:99-103

It omits code, organizer, city, finance_stage, and team_id added by migrations 0023 and 0027 (webv0/packages/persistence/migrations/0023_mission_finance_upgrade.sql:21-30; 0027_teams.sql:72).

Finally, exitTenant accepts only a database Client (webv0/packages/persistence/src/exitTenant.ts:96), while storage describes delete as compensation only:

> /** Compensation only (failed registration) — never a user-facing operation. */
>
> delete(key: string): Promise<void>;
>
> — webv0/apps/api/src/storage.ts:22-27

**Impact**

Tenant export silently loses current documents, invoices, teams, distributions, claims, notifications, delegations, and Mission fields. Exit dry-run understates the erasure set. Execute reaches DELETE FROM tenant while omitted rows still hold non-cascading tenant foreign keys, so it fails and rolls the transaction back; tenants using any omitted domain cannot complete exit. Document objects are neither exported nor erased.

**Recommended fix**

Create one authoritative tenant-data registry shared by export, exit, restore verification, and tests. Compare it at test time with pg_catalog for every final table carrying tenant_id. Export every current Mission column and define a blob manifest plus streamed object export. Make exit coordinate database rows and object deletion through a retryable, auditable ceremony; preserve the existing transactional rollback for the relational phase.

### H-04 — Concurrent owner changes can leave a tenant with zero active owners

**Evidence**

Role demotion checks for another owner, then deletes/reinserts without locking a tenant-scoped serialization row:

> IF position('owner' IN coalesce(prev, '')) > 0 AND p_role <> 'owner' AND NOT EXISTS (
>
> SELECT 1 FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id
>
> WHERE ra.tenant_id = tid AND ra.role = 'owner' AND u.is_active AND ra.user_id <> p_user
>
> ) THEN
>
> ...
>
> END IF;
>
> DELETE FROM role_assignment WHERE tenant_id = tid AND user_id = p_user;
>
> — webv0/packages/persistence/migrations/0008_member_admin.sql:104-113

Deactivation has the same check-then-write shape:

> IF EXISTS (... role = 'owner')
>
> AND NOT EXISTS (... ra.user_id <> p_user) THEN
>
> ...
>
> END IF;
>
> ...
>
> UPDATE app_user SET is_active = false WHERE id = p_user;
>
> — webv0/packages/persistence/migrations/0008_member_admin.sql:137-152

A full search of this migration found no FOR UPDATE, advisory lock, or table lock.

**Impact**

With two active owners, concurrent demotions or deactivations of different owners can each observe the other, both pass the last-owner check, and both commit. The result is an ownerless tenant that cannot perform owner-only governance, delegation, or recovery operations—the exact availability wedge delegation is meant to reduce.

**Recommended fix**

Serialize all member-role and active-state changes per tenant before evaluating the invariant, preferably by SELECTing the tenant row FOR UPDATE or taking a transaction-scoped advisory lock keyed by tenant UUID. Re-read the active-owner set under that lock, then mutate. Add a two-connection integration test with barriers that proves at least one transaction is refused.

### H-05 — Finance lifecycle invariants do not compose across missions, lines, distributions, and payouts

**Evidence**

First, Settled is not an absorbing state for child finance writes. Their shared guard checks only active status:

> const mission = await tx.getMission(missionId);
>
> ...
>
> if (!mission.isActive) {
>
> throw new ConflictError('P&L records may only be changed on an active mission.', { missionId });
>
> }
>
> — webv0/packages/application/src/usecases/missionPnlOps.ts:131-138

That guard is used before adding lines, changing/removing lines, changing receipt truth, and setting budgets (webv0/packages/application/src/usecases/missionPnlOps.ts:152-162, 188-207, 232-238, 269-284, 326-351). Settlement itself reads lines through a separate read port inside the write transaction:

> const lines = await p.reads.forActor(actor).listMissionLines(missionId);
>
> const outstanding = lines.filter((l) => l.direction === 'Income' && l.paymentStatus !== 'Received').length;
>
> ...
>
> const updated = await tx.setMissionFinanceStage(missionId, parsed.expectedVersion, parsed.stage);
>
> — webv0/packages/application/src/usecases/missionPnlOps.ts:371-396

Second, revoke and payout inspect/update different version domains without a shared row lock:

> const shares = await tx.listDistributionSharesTx(distributionId);
>
> if (shares.some((s) => s.payoutStatus === 'Paid')) { ... }
>
> const revoked = await tx.revokeDistribution(distributionId, expectedVersion, trimmed);
>
> — webv0/packages/application/src/usecases/distributionOps.ts:171-180

> const head = await tx.getDistribution(distributionId);
>
> if (head.status !== 'Live') throw new ConflictError(...);
>
> ...
>
> const flipped = await tx.setPayout(distributionId, personId, parsed.expectedVersion, ...);
>
> — webv0/packages/application/src/usecases/distributionOps.ts:208-221

getDistribution is an unlocked SELECT (webv0/packages/persistence/src/writeTx.ts:1006-1008); revoke versions only the head and payout versions only the share (webv0/packages/persistence/src/writeTx.ts:1033-1062).

Third, allocation snapshots an unlocked line:

> const line = await tx.getMissionLine(parsed.lineId);
>
> ...
>
> const pool = line.receivedAmountMinor ?? line.amountMinor;
>
> — webv0/packages/application/src/usecases/distributionOps.ts:103-116

Later line amount, currency, receipt, or active-state changes do not check for a live distribution (webv0/packages/application/src/usecases/missionPnlOps.ts:176-207, 252-284).

**Impact**

The database can truthfully contain a Settled mission with new Expected income, a Revoked distribution with a Paid share, or a live/paid distribution whose stored pool no longer matches the source receipt. A revoked head also frees the one-live-distribution index, so a replacement distribution can be created after the revoke/payout race, creating double-payment exposure.

**Recommended fix**

Define and enforce one lock order: mission, mission line, distribution head, then shares. Run settlement checks through the same transaction/connection after locking the mission; reject every finance-child mutation once Settled. Lock and version the source line when allocating. Make revoke and payout lock the same head. Add DB triggers that prevent Paid under a non-Live head and prevent source-money mutation while a Live distribution exists. Exercise all races with two real database connections.

### H-06 — Organization and team P&L omit per-diem expenses while presenting total P&L and ROI

**Evidence**

The all-missions summary fetches participants, discards them, and explicitly computes with an empty participant list:

> const [missions, allLines, allBudgets, allParticipants, rates] = await Promise.all([
>
> ...
>
> reads.listAllMissionParticipants(),
>
> ...
>
> ]);
>
> ...
>
> void allParticipants;
>
> ...
>
> const pnl = computeMissionPnl({ ... participants: [], rates });
>
> — webv0/packages/application/src/usecases/missionPnlOps.ts:91-114

The team report repeats the omission:

> const pnl = computeMissionPnl({
>
> ...
>
> participants: [],
>
> rates,
>
> });
>
> — webv0/packages/application/src/usecases/teamOps.ts:228-238

The team UI presents an unqualified financial report:

> <h2 className={s.h2}>Profit &amp; loss — this team's missions</h2>
>
> ...
>
> <th className={r.th}>Expense ≈USD</th>
>
> <th className={r.th}>Profit ≈USD</th>
>
> ...
>
> Total · ROI ...
>
> — webv0/apps/web/src/pages/TeamDetailPage.tsx:307-358

The all-missions page's source comment says “Line-based blends only,” but the visible column headings simply say Expenses and Profit (webv0/apps/web/src/pages/MissionFinancePage.tsx:13-18, 54-63).

**Impact**

Where participant per diems exist, organization/team expense is understated and profit/ROI overstated. A code comment is not a user disclosure, and the team report explicitly calls itself “the report” and “P&L + ROI.”

**Recommended fix**

Add a bulk participant/per-diem read and pass the actual entries into computeMissionPnl for both summaries. Avoid N+1 by loading all relevant participants once and grouping by mission. Until corrected, expose a typed scope such as linesOnly and label every affected UI total “excludes per diem”; do not call it total P&L or ROI.

### H-07 — The governed approval UI hides the material values the reviewer is deciding

**Evidence**

Agreement additions show type and anchor, not value; financial-term changes show kind/IDs, not amount/currency/percentage; identity changes render only the changed key names:

> a.payload.operationType === 'AddAgreement'
>
> — webv0/apps/web/src/pages/ApprovalDetailPage.tsx:120-121

> a.payload.operationType === 'AddAgreementTerm'
>
> ...
>
> a.payload.operationType === 'UpdateAgreementTerm'
>
> — webv0/apps/web/src/pages/ApprovalDetailPage.tsx:126-131

> Object.keys(a.payload.input.patch).join(', ')
>
> — webv0/apps/web/src/pages/ApprovalDetailPage.tsx:134-135

The approval confirmation repeats no proposed-value summary:

> title="Approve this request?"
>
> description="Approving records your decision. It does not execute the change — execution is a separate step."
>
> — webv0/apps/web/src/pages/ApprovalDetailPage.tsx:216-222

**Impact**

The immutable payload exists, but the normal reviewer experience does not show the money or identity fact being approved. This turns dual control into a status click rather than an informed decision and makes mistaken or malicious requests materially easier to approve.

**Recommended fix**

Render an operation-specific immutable “proposed change” panel with all decisive values and, where applicable, locked before/after context. Repeat a concise version in approve and execute confirmations. Couple this with H-01: show sensitive values only when the effective, scoped delegation authorizes that operation and disclosure.

### H-08 — Applied migrations are tracked by filename only, so in-place edits are silently ignored

**Evidence**

The migration ledger stores only id and time:

> CREATE TABLE IF NOT EXISTS _migrations (
>
> id text PRIMARY KEY,
>
> applied_at timestamptz NOT NULL DEFAULT now()
>
> )
>
> — webv0/packages/persistence/src/migrate.ts:71-76

Any matching filename is skipped without reading or hashing its content:

> const done = new Set(
>
> (await client.query('SELECT id FROM _migrations')).rows.map(...)
>
> );
>
> ...
>
> if (done.has(file)) {
>
> log(...);
>
> continue;
>
> }
>
> — webv0/packages/persistence/src/migrate.ts:77-89

Only the filename is inserted after apply:

> await client.query('INSERT INTO _migrations (id) VALUES ($1)', [file]);
>
> — webv0/packages/persistence/src/migrate.ts:90-95

During this audit, 0032_people_v2.sql changed in place; the final version now expands the approval-operation CHECK and Person columns (webv0/packages/persistence/migrations/0032_people_v2.sql:10-30).

**Impact**

A database that already recorded the filename will never receive later edits to that migration. Fresh databases and previously migrated databases can therefore have different constraints while both report “fully migrated,” and the fresh-DB gate cannot reveal that split.

**Recommended fix**

Treat migrations as immutable once shared or applied; correct them only with a new filename. Add a SHA-256 column to the migration ledger, backfill known hashes, and fail startup/migration if an applied filename's current hash differs. Add a CI check that rejects changes to released migration files.

## Medium

### M-01 — Later finance tables are not relationally closed at the database boundary

**Evidence**

The distribution migration claims an exact-sum database rule:

> integer allocation - org cut + shares == pool EXACTLY, enforced by CHECK
>
> — webv0/packages/persistence/migrations/0028_distributions.sql:3-5

Its actual checks only constrain individual values:

> pool_minor bigint NOT NULL CHECK (pool_minor > 0),
>
> org_share_bps integer NOT NULL CHECK (org_share_bps BETWEEN 0 AND 10000),
>
> org_cut_minor bigint NOT NULL CHECK (org_cut_minor >= 0),
>
> — webv0/packages/persistence/migrations/0028_distributions.sql:23-27

> share_bps integer NOT NULL CHECK (share_bps BETWEEN 1 AND 10000),
>
> amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
>
> — webv0/packages/persistence/migrations/0028_distributions.sql:55-64

An exhaustive migration search found no aggregate/deferred trigger. The same generation of tables stores business references without composite tenant FKs. For example:

> entity_id text NOT NULL,
>
> mission_id text NOT NULL,
>
> line_id text NOT NULL,
>
> ...
>
> document_id text,
>
> — webv0/packages/persistence/migrations/0026_invoices.sql:23-47

> tenant_id uuid NOT NULL REFERENCES tenant(id),
>
> team_id text NOT NULL,
>
> person_id text NOT NULL,
>
> — webv0/packages/persistence/migrations/0027_teams.sql:46-56

Distribution/share and claim references are similarly unlinked (webv0/packages/persistence/migrations/0028_distributions.sql:19-34, 52-64; 0029_claims.sql:18-38). This departs from the earlier tenant-safe precedent:

> FOREIGN KEY (tenant_id, mission_id) REFERENCES mission (tenant_id, mission_id),
>
> FOREIGN KEY (tenant_id, person_id) REFERENCES person (tenant_id, person_id)
>
> — webv0/packages/persistence/migrations/0012_missions.sql:56-58

Invoice total/VAT/void reason, claim decision fields, payout Paid metadata, distribution revoke reason, and delegation revocation fields also lack cross-column state-shape checks (webv0/packages/persistence/migrations/0026_invoices.sql:34-42; 0028_distributions.sql:27-28, 57-60; 0029_claims.sql:28-34; 0031_delegations.sql:17-28).

**Impact**

A future write path, maintenance script, migration, or application defect can persist orphan/cross-record references, malformed lifecycle rows, or an allocation whose shares do not equal the pool. RLS prevents cross-tenant visibility, but it does not make these references true.

**Recommended fix**

Add composite tenant FKs for invoice→entity/mission/line/document, team membership→team/person, mission→team, distribution→mission/line, share→distribution/person, and claim→person/mission. Add deferred exact-sum and basis-point constraint triggers, plus named state-shape CHECKs for invoice, claim, distribution/share, and delegation. Use deferrable constraints where creation order requires it.

**Counterevidence**

The normal application allocator does produce and assert exact sums, including remainders, and the unit/API tests cover representative odd pools (webv0/packages/domain/src/distribution.ts:112-137; webv0/apps/api/test/distributions.test.ts:116-143). The confirmed gap is the database boundary and lifecycle around that allocator.

### M-02 — Integer storage is undermined by unsafe Number intermediates and fragmentation-dependent FX rounding

**Evidence**

The shared amount schema accepts the entire JavaScript safe-integer range:

> z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
>
> — webv0/packages/domain/src/money.ts:43-44

Invoice VAT documents a much lower safe multiplication ceiling but does not enforce it:

> safe while subtotal × 10000 stays under 2^53
>
> ...
>
> return Math.floor((subtotalMinor * vatRateBps + 5000) / 10000);
>
> — webv0/packages/domain/src/invoice.ts:76-85

Distribution also multiplies pool values by basis points using Number (webv0/packages/domain/src/distribution.ts:112-121), and FX conversion uses binary floating point and Math.round (webv0/packages/domain/src/money.ts:80-90).

The browser repeats major-unit floating conversion across domains:

> const cents = valueUsd.trim() === '' ? undefined : Math.round(Number(valueUsd) * 100);
>
> — webv0/apps/web/src/pages/AgreementsPage.tsx:92-95

> return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
>
> — webv0/apps/web/src/pages/ClaimsPage.tsx:52-55

> return Math.round(n * 100);
>
> — webv0/apps/web/src/pages/MissionDetailPage.tsx:530-534

Finally, the P&L contract says expenses/per diems blend per currency subtotal (webv0/packages/domain/src/missionLine.ts:266-270), but implementation converts and rounds each line and per-diem entry before adding (webv0/packages/domain/src/missionLine.ts:342-365).

**Impact**

Contract-valid large inputs can lose integer precision in VAT and distribution arithmetic. Browser strings can be silently rounded through IEEE-754 rather than rejected at the two-decimal boundary. Splitting one foreign-currency expense into multiple rows can change USD P&L by cents even when the economic amount is unchanged.

**Recommended fix**

Parse decimal strings exactly by splitting whole/fraction components and rejecting excess precision. Use BigInt or a decimal/rational representation for basis-point arithmetic, sums, and scaled FX rates; serialize only at API boundaries. Either cap accepted amounts to a mathematically proven safe range or remove Number intermediates. Group live-rate expenses/per diems by currency and convert each subtotal once; retain per-line conversion only for receipt-specific FX snapshots.

### M-03 — FX rates, per diems, budgets, and team membership are last-write-wins

**Evidence**

Per-diem input has no expectedVersion:

> export const setParticipantPerDiemSchema = z.object({
>
> missionId: ...,
>
> personId: ...,
>
> perDiemMinor: ...,
>
> perDiemCurrency: ...,
>
> })
>
> — webv0/packages/domain/src/mission.ts:230-240

The update predicate uses mission/person only:

> .update(schema.missionParticipant)
>
> .set({ perDiemMinor, perDiemCurrency })
>
> .where(and(
>
> eq(schema.missionParticipant.missionId, missionId),
>
> eq(schema.missionParticipant.personId, personId),
>
> ))
>
> — webv0/packages/persistence/src/writeTx.ts:644-655

FX is an unconditional conflict update (webv0/packages/application/src/usecases/entityOps.ts:178-182; webv0/packages/persistence/src/writeTx.ts:557-564), while budget schemas have no version token and persistence uses unconditional upsert/delete (webv0/packages/domain/src/missionLine.ts:199-211; webv0/packages/persistence/src/writeTx.ts:725-755). Team membership status changes likewise have no expected version (webv0/packages/application/src/usecases/teamOps.ts:161-208; webv0/packages/persistence/src/writeTx.ts:1124-1151).

**Impact**

Concurrent operators silently overwrite rates, allowance inputs, budgets, or membership status. Audit before-images can describe a stale read rather than the row actually overwritten. A per-diem update can also race participant removal because the update does not require is_active.

**Recommended fix**

Add version columns where absent and expectedVersion to every mutable command. Read/lock the row inside the write transaction; update with version and valid-state predicates; return 409/412 on mismatch. Record the locked before-image in the audit event.

### M-04 — Search, finance summaries, and distribution reads have whole-tenant and N+1 scale cliffs

**Evidence**

Search explicitly loads nine whole registers:

> Mechanics: in-memory case-insensitive substring over the existing RLS'd list reads
>
> — webv0/packages/application/src/usecases/search.ts:13-16

> const [people, missions, agreements, entities, credentials, journeys, kit, apparel, approvals] = await Promise.all([
>
> reads.listPeople(),
>
> reads.listMissions(),
>
> ...
>
> ])
>
> — webv0/packages/application/src/usecases/search.ts:61-71

Filtering and the five-row cap happen only after transfer (webv0/packages/application/src/usecases/search.ts:73-130). The web uses useDeferredValue, not an input debounce, so changing text can still issue successive full fan-outs (webv0/apps/web/src/components/GlobalSearch.tsx:97-104).

Mission/team summaries load every active line and every budget, then repeatedly filter arrays per mission:

> const lines = allLines.filter((l) => l.missionId === m.missionId);
>
> const budgets = allBudgets.filter((b) => b.missionId === m.missionId);
>
> — webv0/packages/application/src/usecases/missionPnlOps.ts:111-114

Distribution listing performs one share read per head (webv0/packages/application/src/usecases/distributionOps.ts:45-50), and seed generation nests member→agreement→term reads (webv0/packages/application/src/usecases/distributionOps.ts:62-76).

**Impact**

At 10× data, database work, transfer, heap use, and query count scale with the tenant's complete history rather than the requested result. Repeated array filtering also becomes O(missions × lines/budgets).

**Recommended fix**

Push search into PostgreSQL with indexed normalized fields or pg_trgm, per-domain LIMIT, stable ranking, pagination, and request cancellation/debounce. Add mission/team-scoped aggregate queries. Batch distribution heads+shares and seed agreement terms with joins or IN queries, then group once in memory.

### M-05 — Two authorization-control tables have RLS ENABLED but not FORCED

**Evidence**

The data-plane loop does both:

> ALTER TABLE ... ENABLE ROW LEVEL SECURITY
>
> ALTER TABLE ... FORCE ROW LEVEL SECURITY
>
> CREATE POLICY tenant_isolation ...
>
> — webv0/packages/persistence/migrations/0002_rls.sql:21-30

The control-plane loop for tenant_membership and role_assignment only enables RLS:

> FOREACH t IN ARRAY ARRAY['tenant_membership','role_assignment'] LOOP
>
> EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
>
> ...
>
> CREATE POLICY tenant_isolation ...
>
> — webv0/packages/persistence/migrations/0002_rls.sql:33-43

No later migration adds FORCE. Final coverage is therefore 26 of 28 tenant-keyed tables with FORCE.

**Impact**

The table owner can bypass RLS on the two tables that determine membership and role. The production API is designed not to hold that role, so this is defense-in-depth rather than a normal c3_app exploit, but it falls short of the requested universal tenant-table invariant.

**Recommended fix**

FORCE RLS on both tables. Preserve cross-tenant identity resolution through the existing explicit c3_auth policy and narrow SELECT grants, not table-owner exemption. Keep integration tests proving c3_app and c3_auth are NOBYPASSRLS.

**Counterevidence**

c3_auth is SELECT-only with an explicit resolution policy (webv0/packages/persistence/migrations/0004_auth_role_grants.sql:17-32), and tests verify c3_app/c3_auth are non-superuser and NOBYPASSRLS (webv0/packages/persistence/test/db.test.ts:87-93, 407-409). Every other tenant-keyed table has ENABLE, FORCE, and a policy.

### M-06 — “Append-only even for owner” streams can still be TRUNCATEd

**Evidence**

The denial triggers cover only row updates/deletes:

> CREATE TRIGGER approval_event_append_only BEFORE UPDATE OR DELETE ON approval_event ...
>
> CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event ...
>
> — webv0/packages/persistence/migrations/0001_schema.sql:166-177

> CREATE TRIGGER access_event_append_only BEFORE UPDATE OR DELETE ON access_event ...
>
> — webv0/packages/persistence/migrations/0007_access_events.sql:28-29

A complete migration search found no BEFORE TRUNCATE trigger and no event-specific owner-side TRUNCATE denial.

**Impact**

A privileged operator mistake or compromised migration/admin credential can erase the entire approval, audit, or access stream without firing the row triggers, contrary to the stated owner-resistant append-only posture.

**Recommended fix**

Add statement-level BEFORE TRUNCATE denial triggers and explicit TRUNCATE revokes. If exceptional destruction must exist, expose it only through a separate, audited break-glass ceremony.

**Counterevidence**

c3_app is not granted TRUNCATE, c3_backup has it explicitly revoked (webv0/packages/persistence/migrations/0006_backup_role_grants.sql:39-40), and UPDATE/DELETE denial is tested as admin (webv0/packages/persistence/test/db.test.ts:290-297, 352-375).

### M-07 — Document integrity trusts client MIME and does not verify stored bytes on download

**Evidence**

Upload gates the caller-supplied multipart MIME value, then buffers the entire file:

> const contentType = file.mimetype;
>
> if (!isAllowedDocumentContentType(contentType)) { ... }
>
> const body = await file.toBuffer();
>
> — webv0/apps/api/src/app.ts:1144-1152

The test explicitly records that posture:

> bytes are bytes; the type gate is the content-type
>
> — webv0/apps/api/test/documents.test.ts:120

Download retrieves and sends object bytes without comparing them with the stored SHA-256:

> const body = await deps.documentStorage.get(doc.storageKey);
>
> ...
>
> return reply.send(body);
>
> — webv0/apps/api/src/app.ts:1182-1191

**Impact**

Mislabeled or malicious Office/PDF content can enter the evidence store, object-store alteration can be served without detection, and concurrent 25 MB toBuffer calls create avoidable memory pressure. Attachment disposition reduces browser execution risk but not the risk of a staff member opening a malicious file.

**Recommended fix**

Stream uploads while hashing; detect canonical MIME from magic/signature and validate container formats such as OOXML; quarantine and malware-scan before making a document available. On read, use storage checksum metadata or recompute/compare SHA-256 before serving.

**Counterevidence**

The API enforces count/size/type allowlists, authorization through the owning record, server-generated storage keys, safe attachment filenames, Content-Disposition attachment, X-Content-Type-Options nosniff, and compensation cleanup (webv0/apps/api/src/app.ts:314-316, 1132-1161, 1182-1190).

## Low

### L-01 — Concrete DDL/Drizzle drift remains

**Evidence**

DDL adds a real app_user column:

> ALTER TABLE app_user ADD COLUMN last_seen_at timestamptz;
>
> — webv0/packages/persistence/migrations/0005_external_identity.sql:23-25

The Drizzle table ends without it:

> export const appUser = pgTable('app_user', {
>
> ...
>
> createdAt: timestamp('created_at', ...),
>
> });
>
> — webv0/packages/persistence/src/schema.ts:29-35

Journey DDL makes created_by_approval_id non-null during migration (webv0/packages/persistence/migrations/0010_journeys.sql:29-39), while Drizzle declares:

> createdByApprovalId: text('created_by_approval_id'),
>
> — webv0/packages/persistence/src/schema.ts:145-160

Migrations define external_identity and access_event, but schema.ts has no corresponding pgTable definitions.

**Impact**

Typed code can omit a real column and represent a nullability state the database rejects. The missing table definitions may be an intentional raw-SQL boundary, but that boundary is not mechanically documented.

**Recommended fix**

Reconcile app_user and Journey. Either add external_identity/access_event schemas or codify an explicit exclusion list. Add a migrated-catalog-versus-Drizzle shape test covering columns, types, nullability, keys, and intended raw-only tables.

### L-02 — The checked-in staging compose configuration cannot satisfy API production validation

**Evidence**

Compose sets production Entra mode but supplies no ENTRA_TENANT_ID or document R2 variables:

> NODE_ENV: production
>
> ...
>
> AUTH_PROVIDER: entra
>
> ENTRA_ISSUER: ...
>
> ENTRA_AUDIENCE: ...
>
> ENTRA_JWKS_URI: ...
>
> — webv0/infra/docker-compose.staging.yml:36-49

Startup requires both the tenant ID and complete R2 document configuration:

> if (!e.ENTRA_TENANT_ID) {
>
> throw new Error('AUTH_PROVIDER=entra requires ENTRA_TENANT_ID ...');
>
> }
>
> — webv0/apps/api/src/env.ts:126-141

> if (isProduction && r2Given === 0) {
>
> throw new Error('Production requires the documents R2 configuration ...');
>
> }
>
> — webv0/apps/api/src/env.ts:158-165

**Impact**

The repository's local/containerized staging recipe fails closed at API startup. This does not weaken production security; it makes the documented configuration incoherent and less useful for recovery/reproduction.

**Recommended fix**

Add the required variable wiring with no secret defaults and document the expected env file. Add a config-only compose smoke test that resolves the environment and starts env validation without contacting external services.

### L-03 — Not every authenticated route/use case reaches a purpose-named authorization assert

**Evidence**

Import templates authenticate but deliberately discard the actor:

> const actor = actorOf(req);
>
> void actor; // authenticated route; templates carry no data
>
> — webv0/apps/api/src/app.ts:1104-1107

Entity and FX reference reads use actor-scoped persistence without a capability assertion:

> export function listEntities(p: Persistence, actor: Actor): Promise<Entity[]> {
>
> return p.reads.forActor(actor).listEntities();
>
> }
>
> ...
>
> export function listFxRates(...) {
>
> return p.reads.forActor(actor).listFxRates();
>
> }
>
> — webv0/packages/application/src/usecases/entityOps.ts:168-176

Own-notification reads similarly rely on identity scoping without a purpose-named assertion (webv0/packages/application/src/usecases/notificationOps.ts:20-30).

**Impact**

Current exposure appears low and may be intentional: templates contain no tenant data, and other reads remain authenticated/RLS scoped. But the architectural claim “every route reaches an authorization assert” is false; future roles or data additions can inherit access by omission.

**Recommended fix**

Add explicit assertions such as assertReadReferenceData, assertDownloadImportTemplate, and assertReadOwnNotifications. Maintain a route-to-authz matrix test so intentional universal-authenticated access is visible rather than implicit.

## Suggestions

### S-01 — Generate coverage checks from the migrated catalog instead of maintaining parallel lists

**Evidence**

Tenant export has a hand-written table-spec list (webv0/packages/persistence/src/exportTenant.ts:50-118), exit has a separate TENANT_TABLES list (webv0/packages/persistence/src/exitTenant.ts:58-80), and RLS coverage is maintained through migration-local arrays (webv0/packages/persistence/migrations/0002_rls.sql:21-43 and later per-table migrations).

**Impact**

Each new table creates multiple definition-of-done obligations that can drift independently; H-03 and M-05 are the observed result.

**Recommended fix**

Keep explicit deletion order where necessary, but add one catalog test that enumerates tenant-keyed tables and requires a declared export strategy, exit strategy/order, ENABLE, FORCE, and policy for each. Make omissions fail the gate with the exact table name.

### S-02 — Add deterministic two-connection invariant tests

**Evidence**

The suite already has a real concurrency harness for sequence allocation:

> const results = await Promise.all(
>
> — webv0/packages/persistence/test/db.test.ts:170-171

An exhaustive test search found no paired-transaction cases for concurrent owner demotion/deactivation, settle-versus-line mutation, revoke-versus-payout, or allocation-versus-receipt correction. The full 531-test gate therefore passes despite H-04 and H-05.

**Impact**

Sequential state-machine and expected-version tests cannot validate invariants spanning different rows/version domains.

**Recommended fix**

Reuse the embedded PostgreSQL harness with explicit barriers: pause each transaction after its predicate read, let the competing transaction reach the same point, then release both and assert the final database invariant—not merely one response code.

### S-03 — Freeze an API-v1 compatibility contract before external integrations depend on it

**Evidence**

Routes are consistently prefixed /api/v1, but response construction frequently maps live domain unions directly through DTO functions, for example approval list/detail at webv0/apps/api/src/app.ts:568-582 and the raw payload mapping at webv0/apps/api/src/dto.ts:408-426.

**Impact**

The prefix creates a version boundary, but without a stored OpenAPI/JSON-schema snapshot and compatibility check, domain-union growth can accidentally become a breaking or disclosure-expanding v1 response change.

**Recommended fix**

Publish a generated v1 contract artifact from the existing schemas, snapshot it in tests, classify additive versus breaking changes, and require an explicit v2 route for incompatible semantics. Keep actor-specific projections as API models rather than serializing domain objects wholesale.

## Unverified hypotheses

1. **Previously migrated databases may not match the final 0032_people_v2.sql.** Because the file changed in place and the ledger is filename-only, any environment that recorded 0032 before the final edit may lack part of its current CHECK/column shape. External/database inspection was prohibited, so this was not verified. Verify by querying the deployed constraint definition and columns, then issue a new 0033 migration for any correction—do not edit 0032 again.
2. **Bucket policy or object-lock controls may reduce H-02's exploitability.** Those controls are outside the repository and were not inspected. They do not replace producer authentication in the restore code.
3. **The roadmap's “deployed live on staging” and owner joint-test claims were not independently verified.** Network and cloud access were prohibited by the commission. This report assesses repository behavior only.

## Plan vs reality

- **S8 exact-sum:** the roadmap says “BUILT + CERTIFIED” with a largest-remainder exact-sum law (REVIEW-INPUT-PLAN.md:45). That is true of the normal domain allocator and its tests, but not of the DDL: migration 0028's comment claims CHECK enforcement while no aggregate constraint exists (M-01).
- **S7 team P&L/ROI:** the roadmap says the per-team P&L + ROI report is built/certified (REVIEW-INPUT-PLAN.md:44). The surface exists, but both team and organization summaries pass participants: [], so real per-diem expense is excluded while the UI labels totals as P&L/ROI (H-06).
- **Search definition of done:** the roadmap says every new domain ships in global search and explicitly calls for invoices, teams, claims, distributions, documents, agreement terms, and P&L lines (REVIEW-INPUT-PLAN.md:25). Current SEARCH_RESULT_KINDS contains only person, mission, agreement, entity, credential, journey, kit, apparel, and approval (webv0/packages/application/src/usecases/search.ts:22-32).
- **People v2 status:** the roadmap records S11 as “Agreed in principle” and says its build had started (REVIEW-INPUT-PLAN.md:34, 48). The final repository is ahead of that status: migration 0032 adds the fields and three governed operations, and API/web/tests are wired (webv0/packages/persistence/migrations/0032_people_v2.sql:10-30).
- **Delegation/bus factor:** the roadmap says Tier 0.5 delegation “kills the owner-wedge bus factor” (REVIEW-INPUT-PLAN.md:50). Delegation does provide review+execute continuity, but H-04 can still create zero active owners, and H-01 widens protected approval data to any active delegated member.
- **Documents:** the roadmap accurately claims private object storage, ownership-gated API access, a 25 MB cap, allowlisted types, and production fail-closed R2 configuration (REVIEW-INPUT-PLAN.md:41). The narrower contradiction is that “type allowlist” means the caller's declared MIME, not verified file content, and stored SHA-256 is not checked on download (M-07).
- **Deployment claims:** roadmap statements about staging migrations, deployed bundles, and live joint tests (REVIEW-INPUT-PLAN.md:34-50) are outside the locally verifiable scope and remain unverified rather than accepted or rejected.

## If I owned this codebase: first three actions

1. **Close the two security trust boundaries:** suspend unscoped delegation until payload projections/scopes are fixed, and require a signed restore manifest before the next restore drill.
2. **Make money state transactional and database-backed:** introduce the mission→line→distribution→share lock order, make Settled absorbing, couple live distributions to source receipts, add exact-sum/FK/state constraints, and replace Number-based money parsing/arithmetic.
3. **Make schema evolution mechanically complete:** freeze/checksum migrations; build the catalog-derived RLS/export/exit/Drizzle coverage gate; then repair tenant export/exit, including document objects, before calling exit/restore ceremonies complete.
