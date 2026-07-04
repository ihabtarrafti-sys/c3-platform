# Canonical Contracts Reset — Sprint 32

**Status:** Approved (owner decisions, 2026-07-05) — Phases 1–2 implemented; SharePoint mutation DEFERRED to the owner-executed two-stage gate
**Sprint:** 32 — Read-only Contracts Activation + TD-30 Canonical Gate → C3 Internal V1.0
**Direction:** Option A — recycle the mock-era `C3Contracts` list and provision the canonical replacement

---

## 1. Live truth (owner discovery, corrected record)

`C3_Contracts` (underscore) **does not exist** — the historical migration framing of TD-22
was based on stale documentation. `C3Contracts` **exists** and contains **nine
owner-confirmed mock/test rows; none are real operational contract records. There is no
business-data migration or preservation requirement.**

The live list already carries many canonical-named fields — recorded accurately:
FullName, DisplayName, ContractTypeName, AgreementCategory, ContractStage1,
Disposition1, StartDate, EndDate, SignatureDate, TerminationDate, HasSignedContract,
MonthlyCompensation, CurrencyCode, PrizeSharePct, ContractOwnerEmail.

The incompatibilities are architectural, not cosmetic:

- `PersonID` (plain-text canonical FK) is **absent**;
- `Person`, `Team`, `GameTitle` are **SharePoint lookup-based domain relationships**
  (banned by the locked relationship model);
- `AgreementCategory`, `ContractStage1`, `Disposition1` are **Choice**, not the
  documented canonical Text posture;
- required flags and indexes differ; **`EndDate` is neither required nor indexed**;
- `ContractOwnerName` is absent — a **User field** exists instead of the flat
  plain-text owner pair;
- `IsActive` is absent;
- versioning is 50, not the documented 10;
- many noncanonical legacy/mock columns exist;
- the list **inherits site permissions while containing financial columns**.

## 2. Approved remediation — Option A (clean canonical reset)

1. Recycle (never permanently delete) the existing mock-era list — identity-gated (§5);
2. verify `getbytitle('C3Contracts')` → 404;
3. provision the new canonical `C3Contracts` via REST field-by-field
   (`CreateFieldAsXml`, exact internal names — never grid/Excel import);
4. apply the documented flat plain-text schema (§3);
5. apply verified indexes, unique ContractID enforcement, versioning (major/10,
   attachments off), and the approved ACL matrix (§4) — ACLs BEFORE any real row;
6. activate the read-only Contracts surface only after hosted verification.

The lookup-based schema is not preserved for mock-data compatibility. No contract-write
application path is created.

## 3. Canonical schema (authoritative: `SPContractItem` + C3Contracts SP List Schema.md)

Flat 19-column model: Title (=ContractID), PersonID, FullName, DisplayName,
ContractTypeName, AgreementCategory, ContractStage1, Disposition1, StartDate, EndDate,
SignatureDate, TerminationDate, HasSignedContract, MonthlyCompensation, CurrencyCode,
PrizeSharePct, ContractOwnerName, ContractOwnerEmail, IsActive. `OpsStatus` is computed
in the mapper from EndDate — never stored. Required: Title, PersonID, FullName,
ContractTypeName, ContractStage1, EndDate. Indexed: PersonID, EndDate, Title.

**Explicit Sprint 32 schema alignment (owner-approved, not a silent addition):**
`Title` stores the canonical ContractID, is required, indexed, and
**`EnforceUniqueValues=true`** — the same concurrent-create race guard as every
S27+ list. The schema document is updated at closeout with provisioning evidence.

## 4. Approved Internal V1 ACL matrix (owner policy decision)

| Principal | Access |
|---|---|
| C3 Platform Owners | Full Control — **the only manual list authors for Internal V1** |
| C3 Operations | Read |
| C3 Legal | Read |
| C3 Finance | Read |
| C3 Management | Read |
| C3 HR | **no list access** |
| site Members / Visitors | **no access** |

Recorded explicitly: Operations and Legal are authorized to read the complete
SharePoint contract row — **including financial columns via REST**. UI financial-field
hiding (`canViewFinancials`) remains UX only; the list ACL is the security boundary.
Applied via the locked rev 2 process immediately after provisioning, before any real row.

## 5. Two-stage destructive gate (owner-executed)

**Stage A (GET-only snapshot):** list GUID, Title, server-relative URL, ItemCount,
LastItemModifiedDate, the nine `Id|Title` pairs, a deterministic SHA-256 fingerprint of
the sorted identity set, full field metadata, role assignments, child scopes, all
site-wide fields whose `LookupList` targets the list GUID, and repository-reference
confirmation. All other row values redacted. No digest, no mutation requests.

**Stage B (armed recycle + reprovision):** embeds the owner-confirmed Stage A values
(GUID, ItemCount=9, LastItemModifiedDate, sorted identity set, fingerprint); re-reads
and compares every value immediately before recycling; any difference stops the run;
`DRY_RUN=true` default + literal confirmation phrase; fails if inbound lookup
dependencies exist; prints the exact GUID and nine identities being recycled; recycles
(recycle bin, never permanent delete); verifies 404 before provisioning may run;
provisioning verifies every field programmatically after creation.

## 6. TD-22 reframed (owner directive)

From "legacy-list data migration" to: **remediation/replacement of the pre-existing
mock `C3Contracts` list whose live schema predates the canonical plain-text
relationship model.** Resolvable when: canonical list provisioned and verified; mock
list removed (recycled) or explicitly archived; the read-only contract service is
compatible; ACLs hardened per §4; hosted Contracts, Contract Profile, and Renewals are
truthful. Documentation updates only with implementation evidence.

## 7. Phase 1–2 scope (implemented this session)

**P1 — TD-30 canonical gate:** `scripts/validate-gate.mjs` + `npm run gate`: explicit
ordered parity list, both tsc checks, strict build and every child spawned shell-free
(`shell:false`, direct node invocation; npm via its cli.js — never `shell:true`), full
`error`/`status`/`signal` inspection, first-failure propagation, changed-file NUL/
truncation audit, step summary + runtime SHA, unchanged-SHA warning after
runtime-affecting source changes (investigation trigger, not auto-failure), and a
documented `--self-test-failure` flag proving failure propagation.

**P2 — contract read integrity:** all swallowed network/HTTP/parse/mapping failures
removed from `SharePointContractService`; 404-unprovisioned distinguished from a
genuine empty list (`ContractsListUnprovisionedError` vs `[]`); row-level canonical
validation (missing required fields and lookup-object inputs REJECTED, never coerced —
`ContractReadIntegrityError` with item ids); `getContract` fails truthfully; Renewals
can no longer translate unavailable contract data into empty-success; native fetch and
the flat mapper retained; injectable fetch boundary for the s32 harness; no lookup
handling added; Contracts navigation guard NOT yet removed.

**Deferred beyond this session:** all SharePoint mutation (Stage A/B), ACL application,
NavRail activation, deployment, hosted Part 19, closeout, V1 marker.

## 8. Internal V1.0 release criteria (unchanged)

Canonical Contracts live read-only + hosted-green (three screens truthful, ≥1 real
owner-authored row, failure drill) · TD-30 gate in use · nine lists ACL-hardened per
approved matrices · full gate green via `npm run gate` · owner-signed accepted-debt
review (TD-29 et al.) · V1 baseline + release marker published.
