# Finance Sprint 1 — the money foundation

**Owner "make C3 whole" session (2026-07-10):** two-stage roadmap, Stage 1 =
whole-for-Geekay, keystone = the finance layer. This is its foundation — the
currency + rate substrate the per-diem, agreement-terms, and mission-P&L sprints
all stand on. Get the money model right once.

## What shipped

- **Money primitive** (`domain/money.ts`): every amount = integer minor units +
  ISO currency code (no floats — the cents discipline, generalised). Currencies
  **USD, AED, SAR, EUR, GBP** (extensible; all 2-decimal). `formatMoney`,
  `convertMinor` (cross-rate via the USD pivot), `usdPerUnitMap`.
- **Entity local currency** — each entity carries its base currency (UAE→AED,
  KSA→SAR), the default for money booked under it. Required in the create form,
  editable; existing rows defaulted to USD by migration.
- **FX cross-rate table** (`fx_rate`, tenant-scoped, RLS): one editable rate per
  non-pivot currency — its value in USD. Every cross-rate (any pair) is DERIVED
  from those, so `convertMinor(A→B) = amount × usdPerUnit(A)/usdPerUnit(B)`. USD
  is pinned at 1 and cannot be overridden. Upsert (`setFxRate`, owner/ops via
  `canManageEntities`), audited (`FxRateSet`); broad read.
- **Settings page** (the real home D-6 was waiting for): nav-gated to owner/ops,
  hosting **Exchange rates** — set each currency's value in USD, see the derived
  inverse live, persist. "Nothing is fetched automatically" — manual is the
  reliable floor; online auto-get is a later, optional enhancement.
- **Export/exit ceremony** kept whole: `fx_rate` added to the export bundle and
  the FK-safe exit order; entity export carries `local_currency` (SELECT *).

## Deliberately NOT in this sprint

- Money AMOUNTS on domains (per-diem on participants, salary/bonus/milestone/
  prize-share on agreements, mission income/expense P&L) — those are Finance
  Sprints 2–4, each consuming this foundation.
- The existing agreement `valueUsdCents` is left as-is; it is superseded by the
  typed-terms model in Sprint 3 (no double migration).
- Online FX auto-fetch (needs an external provider; manual is the floor).

## Evidence

Typecheck all projects; gate PASSED (403 tests incl. new money-domain unit tests
— cross-rate math, pivot pinning, rate validation — and FX persistence tests:
owner/ops upsert, visitor forbidden, RLS isolation, end-to-end cross-rate);
E2E 11/11 (new `settings.spec` sets a rate, sees the inverse, persists across
reload, visitor sees no Settings nav; `entities.spec` now sets + asserts a
non-USD local currency). Screenshot self-check in the E dark theme.

## Deploy

Migration 0017 (owner paste) → API (owner paste) → web (me).
