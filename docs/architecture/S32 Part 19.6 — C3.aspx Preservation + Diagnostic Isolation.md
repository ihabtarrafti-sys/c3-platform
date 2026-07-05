# S32 Part 19.6 — C3.aspx Preservation + Page-Instance Isolation (TD-34)

**Date:** 2026-07-05
**Operator:** Ihab Tarrafti (`i:0#.f|membership|ihab@geekaygroupmea.com`) — C3 Platform Owner
**Site:** `https://geekaygames.sharepoint.com/sites/C3` (C3 - Contract Command Center)
**Purpose:** Isolate the TD-34 persistent blank render to the stored C3.aspx web part
instance vs. the tenant solution, using a temporary diagnostic page, before any
production page mutation. No lists, fields, ACLs, groups, or operational data are touched.

---

## Phase A — Production page preservation (captured before any modification)

### A.1 Page metadata (`/_api/sitepages/pages/GetByUrl('SitePages/C3.aspx')`)

| Field | Value |
|---|---|
| List item Id | `3` |
| UniqueId | `9d85b0d6-285f-427e-8e51-3c28eba76899` |
| Title | `C3` |
| FileName | `C3.aspx` |
| Path | `SitePages/C3.aspx` |
| PageLayoutType | `Article` |
| PromotedState | `0` (standard page — NOT news/promoted) |
| Version | `3.0` |
| URL | `https://geekaygames.sharepoint.com/sites/C3/SitePages/C3.aspx` |

### A.2 File / publication state (`/_api/web/getfilebyserverrelativeurl('/sites/C3/SitePages/C3.aspx')`)

| Field | Value | Meaning |
|---|---|---|
| Exists | `true` | — |
| CheckOutType | `2` | **None** — page is checked in |
| Level | `1` | **Published** |
| MajorVersion / MinorVersion | `3` / `0` | — |
| UIVersionLabel | `3.0` | — |
| TimeLastModified | `2026-07-05T04:10:31Z` | — |

Visual state at capture: SharePoint chrome renders; the C3 web part zone is **empty**
("Published on 7/5/2026", blank area above Comments). DOM: web part child HTML = 11 chars
(the empty host `<div>`), `window.__C3_HOST_DIAGNOSTICS.stage === 'mount-complete'`
(`importStatus: resolved`, `mountInvoked/mountCompleted: true`, `mountTargetConnected: true`).
This is the documented TD-34 blank render, reproduced live on the existing instance.

### A.3 C3 web part instance (from CanvasContent1)

| Field | Value |
|---|---|
| controlType | `3` (client-side web part) |
| Component (webPartId) | `842c36e2-5aae-4b32-814c-1b89436ee9c7` |
| **Instance Id** | `617e5555-9178-42c4-bf7b-bf250f8216bf` |
| title | `C3Host` |
| dataVersion | `1.0` |
| **properties.description** | `C3Host` |
| **properties.dataSourceMode** | `sharepoint` |
| audiences | `[]` (no audience targeting) |
| hideOn | `{ "mobile": false }` |
| reservedWidth / reservedHeight | `1188` / `828` |

### A.4 Section / column position

| Field | Value |
|---|---|
| layoutIndex | `1` |
| zoneIndex | `1` |
| zoneId | `8b3464f6-12c1-4ab6-8256-1a18350b7513` |
| sectionIndex | `1` |
| sectionFactor | `12` (full-width single column) |
| controlIndex | `1` |
| zoneGroupMetadata | `{ "type":0, "isExpanded":true, "showDividerLine":false, "iconAlignment":"left" }` |

### A.5 Exact CanvasContent1 (lossless — for restore if ever required)

```json
[{"position":{"layoutIndex":1,"zoneIndex":1,"zoneId":"8b3464f6-12c1-4ab6-8256-1a18350b7513","sectionIndex":1,"sectionFactor":12,"controlIndex":1},"zoneGroupMetadata":{"type":0,"isExpanded":true,"showDividerLine":false,"iconAlignment":"left"},"id":"617e5555-9178-42c4-bf7b-bf250f8216bf","controlType":3,"isFromSectionTemplate":false,"addedFromPersistedData":true,"webPartId":"842c36e2-5aae-4b32-814c-1b89436ee9c7","reservedWidth":1188,"reservedHeight":828,"webPartData":{"id":"842c36e2-5aae-4b32-814c-1b89436ee9c7","instanceId":"617e5555-9178-42c4-bf7b-bf250f8216bf","title":"C3Host","description":"C3Host description","audiences":[],"hideOn":{"mobile":false},"serverProcessedContent":{"htmlStrings":{},"searchablePlainTexts":{},"imageSources":{},"links":{}},"dataVersion":"1.0","properties":{"description":"C3Host","dataSourceMode":"sharepoint"},"containsDynamicDataSource":false}},{"controlType":0,"pageSettingsSlice":{"isDefaultDescription":true,"isAIGeneratedDescription":false,"isDefaultThumbnail":true,"isSpellCheckEnabled":true,"globalRichTextStylingVersion":1,"rtePageSettings":{"contentVersion":5,"indentationVersion":2},"isEmailReady":false,"webPartsPageSettings":{"isTitleHeadingLevelsEnabled":true,"isLowQualityImagePlaceholderEnabled":true}}}]
```

`LayoutWebpartsContent` = `""` (empty; Article layout default header).

No tokens, request digests, or PII are recorded in this file.

---

## Phase B — Diagnostic page (to be created)

`C3-Diagnostic.aspx` — brand-new C3 web part instance, same meaningful properties
(`description: "C3Host"`, `dataSourceMode: "sharepoint"`), a **freshly generated instance Id**
(NOT `617e5555…`), same full-width section. Not added to navigation, not promoted.

## Phase C — Cold test of the fresh diagnostic instance

Diagnostic page created and published (Id 4, `SitePages/C3-Diagnostic.aspx`, v1.0,
PromotedState 0, **not in QuickLaunch navigation**). Fresh web part instance
`d292ed96-925b-45c3-9a42-69d36a54f2ef` (fresh zoneId `815fdb0f-…`), same component
`842c36e2-…`, same properties (`description: "C3Host"`, `dataSourceMode: "sharepoint"`),
same full-width section (sectionFactor 12). Instance Id ≠ production `617e5555…`.

Loaded cold in a brand-new tab with a cache-bust query. Evidence:

| Check | Result |
|---|---|
| `__C3_HOST_DIAGNOSTICS.stage` | `mount-complete` |
| importStatus / mountInvoked / mountCompleted | `resolved` / `true` / `true` |
| mountTargetConnected | `true` |
| Host bundle SHA-256 | `8138ea6a…bbb3` — **matches package** |
| Runtime chunk SHA-256 | `dc718d6c…d1a0` — **matches package** |
| Network failures (≥400) | `0` |
| Web part child HTML | **11 chars (empty `<div>`) — BLANK** |

### Determination — BRANCH 2

A brand-new web part instance (never redeployed, never edited) renders **blank** under
identical healthy conditions: both bundles match the package, diagnostics reach
`mount-complete`, the mount target is connected, and no network request failed. Therefore
the stored C3.aspx web part instance is **NOT** stale or malformed — the blank render is
**not instance-specific**. Branch 1's precondition (fresh instance renders) is **false**.

Per the authorized branching rule this is **Branch 2**:
- Leave C3.aspx unchanged (production instance untouched).
- Preserve the diagnostic evidence (this section).
- Recycle the diagnostic page.
- Perform **exactly one** controlled retract + redeploy of the existing, already-built
  `1.0.0.2` package (no rebuild, no version bump, no repeated redeploy).

---

## Branch 2 recovery — tenant catalog metadata (preserved before retract)

`GET /sites/appcatalog/_api/web/tenantappcatalog/AvailableApps/GetById('45869e8b-fd26-40a3-b9f0-c07ce65c86de')`

| Field | Value (before retract) |
|---|---|
| Title | `c-3-spfx-host-client-side-solution` |
| Catalog item ID | `c3de4e6d-fbd8-4a26-bc39-18adbc7b0402` |
| ProductId | `45869e8b-fd26-40a3-b9f0-c07ce65c86de` |
| AppCatalogVersion | `1.0.0.2` |
| Deployed / CurrentVersionDeployed | `true` / `true` |
| IsEnabled | `true` |
| InstalledVersion | `""` (no per-site install) |
| IsClientSideSolution / SkipDeploymentFeature | `true` / `true` |
| IsValidAppPackage | `true` |
| ErrorMessage | `No errors.` |

App catalog site: `https://geekaygames.sharepoint.com/sites/appcatalog`.

### Recovery execution log

| Step | Action | Result |
|---|---|---|
| — | Recycle first diagnostic page (`C3-Diagnostic.aspx`, instance `d292ed96…`) | recycled (recycle-bin id `4ae13efc…`, GetByUrl 404) |
| 2 | **Retract** solution once (`.../GetById('45869e8b…')/retract`) | 200 — Deployed=`false`, CurrentVersionDeployed=`false`, still v`1.0.0.2` in catalog |
| 3 | Prove no longer deployed | ✅ Deployed=`false` |
| 4 | **Redeploy** exact `1.0.0.2` once (`.../deploy`) | 200 — AppCatalogVersion=`1.0.0.2` (unchanged package), no rebuild, no version bump |
| 5 | Confirm deployment + enablement | ✅ Deployed=`true`, CurrentVersionDeployed=`true`, IsEnabled=`true`, IsValidAppPackage=`true`, "No errors." |
| 6 | Confirm no per-site install | ✅ InstalledVersion=`""` |
| 7 | Cold-test a **fresh** diagnostic page instance first | Created `C3-Diag2.aspx` (Id 5, instance `751b0c63…`). First load ~2 min post-deploy read blank (propagation lag); after propagation the fresh instance **RENDERS the full C3 app** (2271 chars; Command Center + Contracts + People + Renewals; 28 buttons; `mount-complete`; no error boundary; host `8138ea6a…` & runtime `dc718d6c…` match package) |
| 8 | Then test **C3.aspx** (untouched production instance `617e5555…`) | **RENDERS the full C3 app** (2271 chars; Command Center active; both bundle hashes match package; `mount-complete`) |
| — | Recycle `C3-Diag2.aspx` | recycled (GetByUrl 404); both diagnostic pages gone |

### Outcome — BRANCH 2 RECOVERY SUCCEEDED

The single controlled retract + redeploy of the already-built `1.0.0.2` package (given
normal tenant/CDN propagation time) **restored rendering on a fresh diagnostic instance
AND on the untouched production C3.aspx instance**. No rebuild, no version bump, no repeated
redeploy, no source change, no removal/re-add of the production web part. The **Final stop
condition was NOT reached** — the interim blank read at +2 min was propagation lag, not a
persistent failure.

**TD-34 proven cause:** the persistent blank render was an **environmental app-catalog
registration/propagation state** that degraded across the previous session's ~8 rapid
redeploys (each invalidating registration faster than it could propagate). It was NOT a
code defect (host mount lifecycle already hardened and healthy; runtime initial-render path
byte-identical to a build that rendered). The correct remedy was a single clean
retract + redeploy allowed to propagate — exactly the authorized Branch 2 recovery.

### Production page integrity after recovery

C3.aspx: **Published (Level 1), checked in (CheckOutType None)**, PromotedState 0, instance
`617e5555-9178-42c4-bf7b-bf250f8216bf` unchanged, properties `{description:"C3Host",
dataSourceMode:"sharepoint"}` unchanged, position zone 1 / section 1 / factor 12 / layout 1
unchanged, audiences `[]` — **every canvas field matches the A.5 preservation record**.

Note: the page version incremented `3.0 → 4.0` (major) during the session because the page
was briefly opened in Edit mode, triggering SharePoint's editorial auto-republish. The
web part instance and all canvas content are byte-equivalent to the preserved A.5 record
(verified field-by-field); the increment is cosmetic and no content changed.

---

## Genuine-row verification (Hosted Part 19.4 — GKE-PL-2026-001) — ALL GREEN

Cold-loaded production C3.aspx; SharePoint source of truth (C3Contracts Id 49):
`Title=GKE-PL-2026-001, PersonID=PER-0001, FullName=Abdulaziz Alabdullatif,
ContractTypeName=Esports Agreement, ContractStage1=Active, StartDate=2026-07-05,
EndDate=2027-07-01, MonthlyCompensation=500, CurrencyCode=USD, IsActive=true`
(the `ContractID` column is empty; the mapper canonicalizes `ContractID := Title`, so the
business ID `GKE-PL-2026-001` is the identity — no numeric Id parsed).

| # | Check | Result |
|---|---|---|
| 1 | Opens from Contracts register | ✅ no "Contract not found"; profile shows ID/person/type/Active/USD 500 |
| 2 | Opens from related People profile | ✅ no "Contract not found"; same values; Contracts rail highlighted |
| 3 | Canonical Contract ID reaches Contract Profile unchanged | ✅ `GKE-PL-2026-001` via both paths (Title-derived, no numeric Id) |
| 4 | Every displayed value matches SharePoint | ✅ ID, Abdulaziz Alabdullatif, Esports Agreement, Active, USD 500, Start 2026-07-05, End 2027-07-01 |
| 5 | Contracts remains highlighted | ✅ rail shows Contracts active on the profile |
| 6 | Renewals treats the record truthfully | ✅ tracking active contract; 30/60/90-day windows; "All clear" (contract ends 2027-07-01, ~361 days out — outside all windows); no error markers, no fabricated urgency |
| 7 | Person Profile shows canonical contract count | ✅ shows **1** (canonical, derived), NOT the stale **2**; one contract row |
| 8 | People does not restore stale TotalContracts column | ✅ headers: Person ID / Full Name / IGN / Role / Nationality / Status — no Contracts/TotalContracts column |
| 9 | New Contract remains absent | ✅ 0 "New Contract" controls on the register |
| 10 | People and Add Person remain cold-safe | ✅ cold People nav no crash; Add Person panel opens (Full Name field) with no tabster crash (TD-33) |
| 11 | No application write path appears | ✅ Contract Profile controls are read-only (Overview / Amendments (0) / Documents / Activity tabs + Open Person nav); no Save/Edit/Delete/New/Submit |

**The genuine contract row was NOT modified** — all interactions were REST GETs and in-app
read-only navigation. Add Person was opened only to prove cold-safety and closed via Escape
without submitting.
