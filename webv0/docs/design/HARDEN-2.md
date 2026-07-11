# HARDEN-2 — the deferred audit items + the standing-law repayments

**Status: BUILT. Migrations 0036 (closure) + 0037 (settings kernel).**

**Owner resequencing (2026-07-11): review AFTER full implementation.** The
codex second-eye pass and `/code-review ultra` run against the finished tree,
so every deferred disposition from HARDEN-1 gets built NOW and the review sees
the whole thing. Scope: M-01, M-02, M-03 (the deferred remainder), M-04
(folded into S3.1), M-07 + document-bytes export/exit, H-02 (unparked by the
resequencing), S-03 (LAST — the frozen artifact must snapshot the final
surface), plus the two standing-law repayments: **S3.1 Search Elevation**
("search ships with features") and **per-diem presets** (the homeless S2
rider: 65 SAR / 100 SAR / 25 USD quick-picks).

**Build finding (recorded honestly):** my first cut of 0036's exact-sum
trigger encoded the WRONG bps law (org + shares == 10000); the API
distribution suite refused it — players' share_bps split the PLAYER pool
among themselves (Σ == 10000 when rows exist; a rowless head must be a 100%
org cut). The migration, pre-check scan, and db.test proofs all carry the
corrected law. **Deploy finding:** the marathon doc's 1h paste (0034) had
mangled `$$` delimiters in its transcription; the HARDEN-2 deploy doc opens
with a read-only PREFLIGHT that makes staging answer whether 0034's objects
are real, plus a corrected repair paste if not.

## Chunk A — M-01 relational closure + M-03 version guards (migration 0036)

**M-01.** The S6–S9 generation stored business refs as bare text and kept its
shape promises app-side only. 0036 makes the database hold them:

- **14 composite tenant FKs**: invoice→entity/mission/line/document,
  team_membership→team/person, mission→team, distribution→mission/line,
  share→distribution/person, claim→person/mission, beneficiary→person (the
  0035 seat; freelancer/vendor seats stay dormant text until their target
  tables exist). `ADD CONSTRAINT` validates existing rows — an orphan fails
  the migration loudly, which is the point.
- **The exact-sum law at commit**: a deferred CONSTRAINT TRIGGER on
  distribution + distribution_share proves org_cut + Σshares == pool and
  org_bps + Σshare_bps == 10000 for the affected head at COMMIT (deferred so
  head+shares can be written in any order inside one tx). A migration-time DO
  scan proves existing data BEFORE the trigger claims protection.
- **State-shape CHECKs** (each encodes a promise the app already keeps):
  invoice total==subtotal+vat, Voided⇔reason; claim Rejected⇔reason,
  Paid⇔(paid_on ∧ payment-source LABEL), decided⇒reviewed_by;
  distribution Revoked⇔reason; share Paid⇔(paid_on ∧ label);
  delegation revoked fields move as one.

**M-03** (fx_rate stays ACCEPTED as a current-value cell — HARDEN-1
disposition). Version columns land on mission_participant + mission_budget
(0036); the guards live in code:

- **Per-diem**: `expectedVersion` on the command; the UPDATE predicate carries
  version AND is_active — a stale read or a concurrent roster removal refuses
  (409), never merges. Every participant write (reactivate/deactivate/
  per-diem) bumps the token.
- **Budgets**: no longer last-write-wins. The upsert is gone; the use case
  reads the cell in-tx and the caller's `expectedVersion` (null = "I saw an
  empty cell") must match reality: insert / guarded update / guarded delete.
  The audit before-image is the row actually replaced.
- **Team membership**: removal carries the roster version the caller
  displayed; reactivation is guarded by the version read in the same tx (the
  browser never sees inactive rows, so the tx read is the honest basis).

Evidence: db.test "HARDEN-2 M-01" (FK refusals by constraint name; the
59_999-of-100_000 share dies AT COMMIT with DISTRIBUTION_SUM_VIOLATION — both
as a fresh insert and as a direct tamper of a committed exact graph; shape
refusals named; version columns present), missions/missionLines/teams suites
carry stale-version 409 proofs at both the use-case and HTTP layers.

## Chunk B — M-02 exact money paths

- `parseDecimalToMinor` (money.ts): the ONLY lawful major-units→minor parse —
  digit-split, ≤2 fraction digits, bounded; the browser's
  `Math.round(Number(x) * 100)` call sites are replaced (mission lines,
  budgets, per-diem, agreements, claims).
- `amountMinorSchema` capped at MAX_AMOUNT_MINOR (9×10¹¹ minor units) — the
  proven-safe bound the VAT comment promised but never enforced.
- VAT + distribution allocation move their products to BigInt (floor and
  remainder semantics preserved; results return to Number inside the cap).
- The P&L blend implements its own contract: live-rate money converts ONCE
  per currency subtotal (mission totals AND category rows); a receipt FX
  snapshot still converts per line (each receipt is its own economic truth).
  Splitting one foreign-currency expense across rows can no longer move the
  USD total by a cent.

## Chunk C — M-07 document integrity + document-bytes export/exit

- Upload: magic-byte sniff against the declared content type (PDF/PNG/JPEG/
  WEBP signatures; OOXML = PK zip) — a mislabeled body is a 400, not evidence.
- Download: recompute SHA-256 of the fetched object and compare with the
  stored hash — a mismatch is a 502 refusal, never silently served bytes.
- Export/exit carry DOCUMENT BYTES (the H-03 follow-up): the tenant leaves
  with its evidence, not just its rows.

## Chunk D — H-02 signed restore manifest

Ed25519 producer signature over a canonical manifest (env, object key, byte
length, both hashes, schema version, timestamp, source commit); the restore
drill schema-validates marker+manifest and verifies the signature BEFORE any
decrypt/restore. Tamper tests cover marker, manifest, and artifact. Keys: the
backup cron signs with BACKUP_SIGNING_KEY (owner-set env); restore verifies
with BACKUP_VERIFY_PUBKEY. Unsigned legacy artifacts need an explicit,
loudly-warned override flag.

## Chunk E — S3.1 Search Elevation + M-04 scale repairs

Search moves into PostgreSQL (per-domain indexed queries, LIMIT, exactness+
recency ranking) and the missing domains register: invoices (number), teams,
claims, distributions, documents (filename), agreement terms, P&L lines (bank
ref), beneficiaries. Type-filter chips; command palette (find AND do — pulled
forward from Track B); input debounce + request cancellation. Distribution
reads batch heads+shares; P&L summaries group once instead of re-filtering
per mission.

## Chunk F — per-diem presets (the homeless S2 rider)

Settings-editable preset list (seed: 65 SAR / 100 SAR / 25 USD) surfacing as
quick-pick buttons in the per-diem dialog. Direct-audited settings row,
owner/ops editable.

## Chunk G — S-03 frozen v1 contract (LAST)

A generated, committed v1 contract artifact (routes × methods × response
shapes) with a gate test that fails on ANY drift: additive changes are
deliberate artifact regenerations reviewed in the diff; removals/retypes of
served fields demand /api/v2. Runs last so the frozen artifact covers
everything above.
