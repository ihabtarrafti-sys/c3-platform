# HEARTH-003-r6 — Mechanical materialization contract

**Authority:** Apex Lumen
**Implementation owner:** Ember
**Counter-verifier:** Neural
**State:** `NOT_YET_MEASURED`

This contract makes r6 reproducible without allowing the implementation to
author its own answer key.

## 1. Immutable roles

- **Lumen authors:** G qrels, register predicates, B0/O0 baseline, fixtures,
  residual meanings, metric semantics, bundle contract, and expected RED
  failures.
- **Ember implements mechanically:** seed, adapter, capture, evaluation, and
  reporting exactly from the authority artifacts.
- **Neural counter-verifies:** semantic predicates, executable negative
  controls, content roots, and any eventual H4 verdict.

Ember may reject an impossible or inconsistent authority input. Ember may not
invent, normalize, repair, or silently omit a qrel, actor class, fixture,
predicate, projection, residual, or expected failure.

## 2. Active semantic inputs

- `HEARTH-003-QRELS-v7.json` — 280 G judgments and baseline predictions.
- `HEARTH-003-FIXTURE-CONTRACT-v5.json` — synthetic physical corpus and
  overlays.
- `HEARTH-003-ACTOR-CLASSES-v2.json` — actor facts and D1-D4 definitions.
- `HEARTH-003-AUTHORITATIVE-PREDICATES-v2.json` — register-read ceiling.
- `HEARTH-003-AUTHORITATIVE-FIELD-SCOPE-v1.json` — DTO-visible field scope.
- `HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1.json` — dae27a4 B0/O0
  drift baseline, not approval authority.
- `HEARTH-003-DELEGATION-MEASUREMENT-v2.json` — expanded actor/case mechanics
  with baseline terminology.
- `HEARTH-003-INHERITED-RESIDUALS-v2.json` and its continuity contract.

QRELS-v7's `baselineActorClasses` are predictions of B0. Fixture-v5's legacy
field name `approvedProjection` means only the pinned dae27a4 baseline
projection in r6. Neither name authorizes a field or source.

## 3. Pre-side-effect order

Before seed, database mutation, HTTP request, or metric capture, the consumer
must:

1. canonicalize and verify `HEARTH-003-SHA256SUMS-v7.json` against the external
   Neural-pinned root;
2. verify the exact closed slot set, identities, and every cross-binding in
   `HEARTH-003-BUNDLE-CONTRACT-v2.json`;
3. verify all 5 + 8 + 3 inherited residuals by exact content, plus the r6
   claim-limit, structural, and record-defect groups;
4. verify QRELS-v7 has 280 cases, exactly one classification per source
   judgment, and no `approvedActorClasses` key;
5. verify QRELS-v7 is judgment-equivalent to QRELS-v6 after the ruled
   `approvedActorClasses` → `baselineActorClasses` key normalization;
6. execute the B0/O0 drift RED and exact projection RED;
7. execute target-satisfiability classification against unmodified G; and
8. stop on the first typed failure.

The side-effect barrier must record actual attempted events. Authored booleans
such as `seedStarted:false` are not proof.

## 4. Runtime planes must remain separate

### 4.1 Real authorization plane

Leak checks execute only through production-mode application →
`reads.forActor(actor)` → RLS/authz using non-superuser credentials. They
evaluate cross-tenant, role, capability, entitlement, participant, delegation,
owner-type, record-kind, and field denial as applicable.

The active-permitted-owner Attachment canary is a hard L0 failure. Denied must
be observationally indistinguishable from absent. This plane supplies runtime
authorization evidence.

### 4.2 B0 drift plane

B0 compares the captured source/field/projection shape with dae27a4. A result
outside B0 is a drift finding. A result inside B0 proves equality only. This
plane cannot certify the baseline itself as safe.

### 4.3 Quality plane

Recall@10, MRR@10, and exact-ID Recall@1 use G without subtraction or
normalization. `C0 = |G ∩ B0| / |G|` is reported separately as
`PINNED_BASELINE_RECALL_CEILING`.

### 4.4 Performance plane

Latency is calculated only from valid, non-429 production-mode requests.
p50/p95/p99, warm/cold status, query class, corpus density, actor class, and
timeout status are retained. Timing-density residuals remain documented.

No plane can substitute for another.

## 5. Physical evidence

Physical Validation v3 is frozen r4 evidence over QRELS-v5 and Fixture-v5. It
is not rerun or re-earned by r6. Its two sorted-JSON-plus-LF hashes are checked
with `canonical-json-keysort-plus-one-lf-v1`, which appends exactly `0x0A`.

The r6 chain must reject if:

- the physical manifest migration pin differs from Fixture-v5
  `physicalSeedPlan.migrationFiles` under that algorithm; or
- the physical validation seed-plan pin differs from Fixture-v5
  `physicalSeedPlan` under that algorithm.

Physical v3 remains `OPEN_BEFORE_H4`.

## 6. Produced authority artifacts

The authority materializer writes only
`HEARTH-003-R6-AUTHORITY-VALIDATION-v1.json`. It must not rewrite QRELS,
fixtures, predicates, B0, residuals, metric receipts, RED receipts, documents,
or the product repository.

The freezer reads Bundle Contract v2 and writes only
`HEARTH-003-SHA256SUMS-v7.json`. It derives the slot list solely from the
contract, normalizes every text hash path consistently, and refuses a missing,
extra, duplicate, case-colliding, or non-portable filename.

## 7. Eventual H4 disposition

A structurally valid r6 package does not certify a baseline. A measured H4
record additionally requires real-path captures, non-superuser/RLS
attestations, zero leak findings, hard-canary conformance, unnormalized G
metrics, latency statistics, timeout-density evidence, and a separately
repeated run.

Until those artifacts exist, the only valid disposition is:

`NOT_YET_MEASURED`
