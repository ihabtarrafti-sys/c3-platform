# C3Missions Provisioning Post-Mortem

**Sprint:** 26 (S26-5 — SP DSM activation)
**Date:** 2026-07-02
**Status:** Resolved — list remediated in place, TD-25 closed, Missions live in SP DSM
**Related:** `C3Missions SP List Schema.md`, `C3 Tech Debt Register.md` (TD-25 resolution record),
commit `e4c9d98` (`fix(s26): Enable Missions in SharePoint DSM`)
**Provisioning script:** `docs/architecture/scripts/Create-C3Missions.ps1` (archived — see §5)

---

## 1. What happened

The Sprint 26 post-provisioning validation found the `C3Missions` list **not schema-conformant**,
even though the provisioning script had been run and reported success:

- The list **already existed** before the script ran — it had been created via grid/Excel
  import rather than by the script.
- Columns created by the import received **generic internal names** (`field_1` through
  `field_14`) instead of the schema internal names. Display names looked correct
  ("Name", "Game", "MissionStatus", …), masking the problem in every UI view.
- The script's `Add-FieldIfMissing` helper checks for existing columns **by internal name**.
  Since none of the schema internal names existed, the script believed the columns were
  missing — but column creation collided with the import's display names for most fields,
  and only four columns were actually added correctly (`StartDate`, `EndDate`,
  `SettlementDate`, `IsActive`). Those four were correct but **never populated with data**.
- Additional defects in the imported columns:
  - `Entity` choice set was `UAE, KSA` — missing `Multi`.
  - `OperatingCurrency` choice set was `UAE, KSA, Multi` — **entity values, not currency
    values** (the row values themselves were correct: `USD`, `SAR`).
- Net effect: the app's `spMissionMapper` read the schema internal names, received `undefined`
  for every required field, and **hard-rejected both rows** — `listMissions()` returned `[]`.
  This was the mapper's gate-integrity protection working exactly as designed.

## 2. Why display names were not enough

SharePoint REST (`$select`, `$filter`, item payload keys) operates on **internal names**, and
internal names are **immutable after column creation**. A list can look perfectly provisioned
in the browser while being unreadable by the application. Any validation that only inspects
display names — including eyeballing the list settings page — is insufficient.

## 3. Remediation (non-destructive, user-approved)

1. The 11 malformed columns were display-renamed with a **`zzOLD` prefix** (e.g. `zzOLD Name`)
   to free the display names and mark them deprecated. Nothing was deleted.
2. Correct columns were created via REST `CreateFieldAsXml`, which gives exact control of
   `Name`/`StaticName` — internal names verified afterwards (`MissionStatus` exact, not
   `Status`/`Status0`).
3. Choice sets were provisioned to match the TypeScript unions exactly:
   - `MissionStatus`: `Planning, FinancePending, Confirmed, Active, PostMission, Settled, Canceled`
   - `Entity`: `UAE, KSA, Multi`
   - `OperatingCurrency`: `USD, AED, SAR, EUR`
4. Row data was copied from the `zzOLD` columns into the new columns; the missing span dates
   were populated from the schema doc §9 sample rows.
5. Dates were written as **explicit UTC midnight** (`2026-07-08T00:00:00Z`). The site's
   regional timezone is the tenant default (UTC-8 Pacific); dates entered via the UI are
   stored in site-local time and can shift by one day when the app normalises to UTC
   (`normalizeSpDate` uses `toISOString()`). Date-Only display format was set on the three
   span-date columns.
6. Required flags were set (`Name`, `Game`, `Organizer`, `Entity`, `MissionStatus`,
   `Jurisdiction`, `CreatedBy`, `Title`), and `Title` was display-renamed "Mission ID".
7. Validation: both service queries returned correct rows; the live REST payload run through
   the real compiled `spMissionMapper` produced **2 mapped, 0 rejected, 0 warnings**.

**Residual cleanup:** the `zzOLD *` columns remain on the list as deprecated duplicates with
no app dependency. Delete them via List Settings whenever convenient.

## 4. Operator rules going forward

These apply to **every** C3 list provisioning, not just missions:

1. **Never pre-create a C3 list via grid/Excel import.** Imports assign `field_N` internal
   names that can never be corrected in place.
2. **Always verify internal names through REST after provisioning** — this is the schema doc
   §8.3 step and it is mandatory, not advisory:
   `{site}/_api/web/lists/getbytitle('C3Missions')/fields?$select=InternalName,Title&$filter=Hidden eq false`
3. `MissionStatus` must be the **exact internal name** (never `Status` — SP reserved word —
   and never an SP-renamed `Status0`).
4. **Choice values must match the TypeScript unions exactly**, including spelling and casing
   (`Canceled`, single L). An unknown choice value hard-rejects the row silently from the
   app's perspective.
5. `OperatingCurrency` takes **currency values** (`USD, AED, SAR, EUR`) — not entity values.
6. `Entity` must include all three values: `UAE`, `KSA`, `Multi`.
7. **Write dates as explicit UTC** (`YYYY-MM-DDT00:00:00Z`) when seeding data via REST or
   script, and prefer REST/script seeding over UI entry for date columns while the site
   regional timezone remains UTC-8.

## 5. Script disposition and lessons

`Create-C3Missions.ps1` is archived at `docs/architecture/scripts/Create-C3Missions.ps1` as a
**provisioning helper, not a guaranteed idempotent migration tool**:

- It creates columns correctly on a **fresh list**, but its existence checks match by internal
  name only — against a pre-existing list with display-name collisions it partially succeeds
  and reports success, leaving a mixed, broken schema.
- It does not set Date-Only display format, does not seed rows, and does not verify the
  resulting internal names.

**Future versions should:**

1. Detect a pre-existing list and **stop with a warning** (or require an explicit
   `-AllowExisting` switch).
2. **Validate internal names after every column creation** and fail loudly on any mismatch
   (including SP silent renames).
3. Validate choice sets against the authoritative schema doc values.
4. Set Date-Only display format where the schema specifies it.
5. Emit the REST verification URL and refuse to report success until the field check passes.
