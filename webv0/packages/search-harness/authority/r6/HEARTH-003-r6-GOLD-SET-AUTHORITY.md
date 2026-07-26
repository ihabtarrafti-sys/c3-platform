# HEARTH-003-r6 — Gold-set authority and r5 FIX-FIRST response

**Authority:** Apex Lumen
**Status:** `SUBMITTED_FOR_NEURAL_COUNTER_VERIFICATION`
**Measurement status:** `NOT_YET_MEASURED`
**Product source pin:** `dae27a400868c0c686788ab8e5520690dbf77334`
**Synthetic data only:** yes

This revision supersedes r5 as the operative authority package. It does not
rewrite any r5 artifact or r5 provenance. It implements Neural's r5
`FIX FIRST` verdict by naming each guarantee at the strength its evidence
supports.

## 1. The authority split

HEARTH-003 now keeps four different questions separate:

1. **G — relevance truth.** The 280 qrels are Lumen's human-adjudicated
   relevance judgments. Their relevance rationales were authored apart from the
   current search result order. `G` remains the only denominator for Recall and
   MRR.
2. **Register readability.** `AUTHORITATIVE-PREDICATES-v2` records the
   authoritative register-read model used to calculate the recall ceiling. It
   is not replaced by search behavior.
3. **B0/O0 — implementation drift.** `B0(a)` is the source, field, and
   projection set reconstructed from C3 search at `dae27a4` for actor profile
   `a`. `O0(a)` is the remainder of the bounded 17-register synthetic universe.
   Movement outside B0 is a drift finding. Equality inside B0 proves only
   equality to that pinned implementation.
4. **Runtime disclosure safety.** Only the real production-mode
   application → `reads.forActor(actor)` → RLS/authz path, together with the
   separately ruled hard L0 canaries, can supply runtime leak evidence. A B0
   drift PASS is never a leak-safety or authorization PASS.

There is no separate disclosure oracle in this package. C3 has no authority
source for the Wave-1 search field/projection set other than the implementation.
B0 therefore cannot detect the pinned implementation itself being wrong,
over-broad, incomplete, or unauthorized.

## 2. What changed from r5

### 2.1 B1 — guarantee corrected

`APPROVED-DISCLOSURE-PREDICATES-v3` is not carried as an operative r6 slot.
Its successor is
`HEARTH-003-SEARCH-DISCLOSURE-DRIFT-BASELINE-v1.json`.

The 64 match fields, 68 projection expressions, and 49,840 actor/fixture
observations are retained as reconstruction and drift evidence. They are not
evidence of a separate disclosure specification. The values formerly named
`sourceJudgments[].approvedActorClasses` are mechanically renamed
`baselineActorClasses` in QRELS-v7; their values remain unchanged and mean
only "predicted included by the dae27a4 implementation baseline."

The three known search under-exposures and the anchored-Comms case remain
visible as baseline recall ceilings. They are not normalized out of G and are
not treated as correct merely because B0 records them.

### 2.2 B4 — no-version-mixing proof repaired

The r5 root
`fe1fdd3fb4e9624b32485bc7967f98c663ff3c3f311dca61d887243927776249`
at authority commit
`915b4354cdb41a75b98053b3db51226222d2718e`
is the immutable baseline for the v2 bundle RED suite.

The suite clean-verifies the actual 37-slot r5 bundle and then runs ten typed
mutations. Four cases target the previously substitutable text slots:

- `.gitattributes`
- `HEARTH-003-r5-GOLD-SET-AUTHORITY.md`
- `HEARTH-003-r5-MATERIALIZATION-CONTRACT.md`
- `HEARTH-003-r5-freeze-hashes.mjs`

The v2 contract binds every active r6 text/source slot through exact
canonical-text hashes in `R6-AUTHORITY-VALIDATION-v1`. Internal binding prevents
single-slot substitution; a coordinated rewrite of contract, validation,
targets, and external root is outside that guarantee and remains dependent on
Neural's separate root verification.

### 2.3 B5 — residual meaning bound

`INHERITED-RESIDUALS-v2` assigns stable IDs and substantive content to:

- five r3 residuals;
- all eight r4 disposable-validator residuals;
- three r5 forward residuals;
- the r6 pinned-baseline correctness limit;
- the three r5 structural findings; and
- six non-blocking B2/B3 record defects.

`RESIDUAL-CONTINUITY-CONTRACT-v1` binds exact membership and canonical content.
Its RED suite proves that a same-ID hollow statement, empty required model,
generic rewrite, missing member, and duplicate ID all fail before seed, HTTP,
database, network, or metric activity.

## 3. Structural findings

### 3.1 Policy-dependency binding

The active contract binds `POLICY-DEPENDENCIES-v2` to all four semantic pins:

- product commit
  `dae27a400868c0c686788ab8e5520690dbf77334`;
- application-policy tree
  `c440971239e10dc0b7d3a09646f2b3d71635c9f7d4b31e72e46b303e590ac1cf`;
- migration-state tree
  `0440365537129073377bbea05aa3b760f25573d4c008aab473b7f59e1072a585`;
- complete dependency tree
  `bf76302b44c4ab3b5dab68270616dfa1a802f5720563008e3b56d2f09b585d1a`.

The values are repeated in Trust Chain v3 and R6 Authority Validation so that
the 113-file dependency artifact is no longer a semantic orphan.

### 3.2 Legacy canonical JSON plus LF

Two r4 physical fields use the now-documented legacy algorithm
`canonical-json-keysort-plus-one-lf-v1`: recursively key-sort JSON objects,
preserve array order and JSON scalar semantics, serialize with
`JSON.stringify`, append exactly byte `0x0A`, then SHA-256.

The contract recomputes and binds:

- Physical Manifest v3 `/migrationPinSetSha256` to Fixture-v5
  `/physicalSeedPlan/migrationFiles`; and
- Physical Validation v3 `/inputHashes/physicalSeedPlanSha256` to Fixture-v5
  `/physicalSeedPlan`.

No historical artifact is reinterpreted or repinned.

### 3.3 Physical Validation v3 scope

Physical Validation v3 is the r4-era report over QRELS-v5 and Fixture-v5. It
proves its recorded storability, PostgreSQL, RLS-mechanics, projection, and
negative-probe observations for that frozen scope. It does not prove B0
authorization, QRELS-v7 semantics, or an H4 baseline.

Its status remains `OPEN_BEFORE_H4`. QRELS-v7 changes no G judgment, fixture
binding, query string, or expected source set relative to QRELS-v6; its only
per-judgment change is the semantic key rename from `approvedActorClasses` to
`baselineActorClasses`.

## 4. Search disclosure and leak discipline

The search harness must still:

- execute production mode with a high non-zero rate ceiling and exclude HTTP
  429 responses from latency statistics;
- use only synthetic or deliberately approved scrubbed data;
- traverse application → `reads.forActor(actor)` → RLS with non-superuser
  credentials;
- fail on any unauthorized cross-tenant or cross-role ID or field;
- make denied indistinguishable from absent;
- keep the active-permitted-owner Attachment canary a hard L0 failure;
- preserve the three verified under-exposures as recall ceilings;
- keep the anchored-Comms recursive gate case explicit; and
- emit no H4 `RECORD` unless all run-integrity evidence exists.

The symmetric `getDocumentForDownload` record-kind follow-up remains outside
Wave 1. `claim.description`, `term.label`, and `line.refNo` remain H5 freeze
blockers with default disposition "narrow."

## 5. Metric meaning

For query `q` and actor `a`:

- `G(q,a)` is the human-adjudicated relevant source set;
- `B0(a)` is the dae27a4 baseline-included source set;
- `J(q,a) = G(q,a) ∩ B0(a)` is the expected baseline-visible relevant set;
- `C0(q,a) = |J(q,a)| / |G(q,a)|` is the pinned-baseline recall ceiling.

Recall and MRR continue to use `G`. C0 is diagnostic; it never lowers, renames,
or replaces the recorded acceptance target. The exact-ID target remains 100%.
If G cannot satisfy it under the pinned baseline, the honest classification is
`TARGET_FAIL_PINNED_BASELINE_RECALL_CEILING`, not a normalized pass.

## 6. Hash and provenance rules

All authority text uses strict UTF-8 canonical text: CRLF and lone CR normalize
to LF; every other byte, including terminal newline, remains significant.
Canonical JSON uses recursive key sorting, preserves array order and scalar
semantics, and has no trailing LF unless the explicitly named legacy algorithm
is selected.

The freezer enumerates every active slot from Bundle Contract v2, tests LF,
CRLF, and CR portability for every text path, and tests a substantive mutation.
Raw future HTTP capture bytes are never normalized.

SHA-256, local unsigned Git history, and Neural's separate recomputation provide
tamper evidence against accidental drift only. Real PKI or an external
append-only anchor remains an owner decision.

## 7. Authority boundary and disposition

This package changes no product code, seeder, search ranking, authorization
policy, RLS policy, database, deployment, or H4 result. Ember implements the
mechanics; Ember may not amend G, B0, the predicates, fixtures, or residuals.
Neural counter-verifies the authority and external root.

Until Neural counter-verification and a measured real-path H4 run:

`NOT_YET_MEASURED`
