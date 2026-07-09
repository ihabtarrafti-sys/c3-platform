# Finance Sprint 3 — agreement financial terms

Third finance sprint. An agreement's money stops being a single headline number
(`valueUsdCents`) and becomes a **typed sub-collection of terms** — the real
money story of a contract: a monthly **Salary**, one-off **Performance bonuses**,
**Milestone** payments (amount + trigger), and **Prize shares** (a percentage,
one **personal** cut and one **team** cut).

## The shape

Two shapes, discriminated by `kind`:

- **Monetary** kinds — `Salary`, `PerformanceBonus`, `Milestone` — carry a money
  amount: integer **minor units** + an ISO **currency** (the `money.ts`
  discipline). `Milestone` additionally requires a **label** (its trigger).
- **Percent** kinds — `PrizeSharePersonal`, `PrizeShareTeam` — carry a share as
  integer **basis points** (`1..10000` = 0.01%..100% — never a float).

`assertTermShape(kind, values)` is the ONE rule (shared by add + update); the DB
`CHECK` in migration 0019 is the ultimate backstop. Kind is **immutable** — to
change it, remove the term and add another.

## Governance — direct-but-audited (the per-diem posture)

Terms are **money detail hung on a governed parent**, exactly like per-diem on a
mission roster. Owner/operations **write** (version-guarded, audited in the same
transaction: `AgreementTermAdded` / `Updated` / `Removed`); the **read** is gated
to **`canViewFinancials`** (owner/operations/finance/management). Legal reads the
agreement but the whole terms endpoint is a **section-level 403** — a truthful,
fail-closed denial, never a false "no terms recorded". Removal is a soft
`is_active` flip (the data plane grants no `DELETE`).

The agreement's **material lifecycle** (existence, term dates, termination) stays
**governed** (the approval pipeline). Term writes require the parent agreement to
be **Active** — a terminated agreement's terms are frozen historical record.

> **Deliberately NOT governed (an honest fork for the owner):** if changing a
> salary should itself require dual-control (requester ≠ approver), promoting
> term *amendments* to the governed pipeline is a clean follow-up. V1 ships them
> direct-audited, consistent with per-diem.

## What shipped (every layer)

- **Domain** (`agreementTerm.ts`): kinds, `assertTermShape`, `percentToBps` /
  `formatPercentBps`, create/update input schemas; `TRM-XXXX` business id;
  audit actions.
- **Migration 0019**: `agreement_term` (composite FK → agreement; currency +
  percent-range + amount-positive + per-kind shape CHECKs; RLS ENABLE+FORCE; no
  DELETE grant; `TRM` counter kind). Added to export/exit bundles.
- **Persistence**: schema/mapper/writeTx (insert/get/update/deactivate) +
  `listAgreementTerms` (active, oldest first).
- **Application** (`agreementTermOps.ts`): list (canReadAgreements +
  `assertViewFinancials`), add/update/remove (`assertSubmitApproval`,
  active-agreement guard, `assertTermShape`, same-tx audit).
- **authz**: `assertViewFinancials`.
- **api-contracts / api**: term DTO + list/response/param/input schemas; routes
  `GET/POST /agreements/:id/terms`, `PATCH/DELETE …/terms/:termId`; openapi regen.
- **Web** (`AgreementDetailPage`): a **Financial terms** section (canViewFinancials
  only) — a table of terms with native-currency money or a percent, plus
  **Add / Edit / Remove** governed-confirm actions (owner/ops, active only). The
  legacy `valueUsdCents` row is preserved (superseded, a later-removal candidate).

## Evidence

Typecheck all 9 projects. Gate PASSED — **433 tests** (+20): domain (percent
math, `assertTermShape` per kind, schemas, TRM id), authz (`assertViewFinancials`
role matrix), persistence (add/update/remove + audit, shape enforcement, write
gate, the `canViewFinancials` read gate with legal denied, active-only rule, RLS
isolation), api (the four routes over HTTP with financial gating + write gate).
E2E 11/11 — `agreements.spec` adds a monthly salary (AED) + a prize share (%),
edits the salary, removes the share, and asserts the terms panel is hidden for
legal.

## Deploy

Migration 0019 (owner paste) → API (owner paste) → web (me). Deploy pastes:
`C:\Projects\C3-FINANCE-S3-DEPLOY-PASTES.md`.
