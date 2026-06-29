# M365 / SharePoint Access Readiness Matrix
**C3 Contract Control Center**
**Date:** 2026-06-29
**Scope:** Sprint 15 (live credential validation) + Sprint 16 planning prerequisites
**Purpose:** Know exactly what you can do yourself, what requires IT, and what to request — before discovering blockers one task at a time.

---

## Permission Level Reference

The matrix uses shorthand codes. Definitions:

| Code | Permission level | What it grants |
|---|---|---|
| **A — Contribute** | Site member with Contribute access | Add/edit/delete list items. Cannot create lists or columns. |
| **B — Edit** | Site member with Edit permission level | Contribute + create and modify list schemas (add columns, change settings, set indexes). Default for "Site Members" group in many tenants. |
| **C — Full Control / Site Owner** | Member of the Site Owners group, or explicit Full Control grant | Everything in B + manage site permissions, manage pages, manage subsites. Can enable Site Collection App Catalog (SCAC). Does NOT grant access to Tenant App Catalog. |
| **D — SharePoint Admin** | M365 role: SharePoint Administrator | Manage all SharePoint sites from Admin Center. Upload/approve solutions in Tenant App Catalog. Enable/disable site features. |
| **E — Power Automate maker** | M365 license with Power Automate included (Business Standard, Business Premium, or E3/E5) | Create and run flows. SharePoint connector is standard (no premium license needed for basic read/write flows). |
| **F — M365 / Entra ID Admin** | Global Admin or Exchange/Entra Admin role | Manage users, groups, licenses, app registrations. Required for service accounts and multi-tenant app permissions. |

> **Important distinction:** Site Owner (C) and SharePoint Admin (D) are different. A Site Owner controls one site. A SharePoint Admin controls all sites from the Admin Center. You can have C without D and vice versa.

---

## Sprint 15 — Task-by-Task Matrix

### S15-T1 — Create the `C3Credentials` list

| Question | Answer |
|---|---|
| Can I do this myself with normal edit access? | Only if you have **Edit (B)** or higher. Contribute (A) alone cannot create lists. |
| Minimum permission required | **Edit (B)** — grants "Manage Lists" capability |
| Site Owner / Full Control needed? | Not strictly, but Site Owner (C) is cleanest if you're provisioning a net-new operational list |
| SharePoint Admin needed? | No |
| Power Automate needed? | No |
| Entra ID / M365 Admin needed? | No |
| Exact permission to request from IT | **"Edit" permission level on the `https://geekaygames.sharepoint.com/sites/C3` site**, or membership in the Site Members group if it has Edit-level access |
| Fallback if denied | Provide IT with the column-by-column schema document (C3Credentials SP List Schema.md) and ask them to create the list on your behalf. Offer to review via screen share. |

---

### S15-T2 — Create exact columns with correct internal names

| Question | Answer |
|---|---|
| Can I do this myself? | Yes, with **Edit (B)** or higher — List Settings → Add column |
| Critical internal name note | SharePoint sets a column's internal name permanently at creation time from the first name you type. Once saved, the internal name cannot be changed without PowerShell/REST. **Always type the exact internal name first** (e.g., `HolderPersonID`), then change the display name afterwards if needed. Never create a column with a placeholder name intending to rename it. |
| Minimum permission | **Edit (B)** |
| SharePoint Admin needed? | No |
| Fallback | If someone else creates the list with wrong internal names, the only clean fix is to delete and recreate the column. Provide the schema doc proactively to avoid this. |

---

### S15-T3 — Add Choice column values (e.g. `CredentialType` choices)

| Question | Answer |
|---|---|
| Can I do this myself? | Yes, with **Edit (B)** — done via column settings at list creation or via column editing afterwards |
| Minimum permission | **Edit (B)** |
| Risk | Choice values must match the C3 type system exactly (spacing, capitalisation). A choice labelled `"Employment visa"` instead of `"Employment Visa"` is a silent mapper failure — it falls through to `Other`. Provide the schema doc with exact values. |
| Fallback | If choices are wrong after provisioning, an Edit-level user can update them. Values already stored against the wrong choice are not automatically remapped. |

---

### S15-T4 — Add indexes to columns

| Question | Answer |
|---|---|
| Can I do this myself? | Yes, with **Edit (B)** — List Settings → Indexed columns |
| Minimum permission | **Edit (B)** |
| Which columns to index | `HolderPersonID` (primary filter in all listCredentialsForPerson queries), `IsActive` (filtered on every query). `Title` (CredentialID) is indexed by default as the list's Title column. |
| SharePoint Admin needed? | No |
| Fallback | Non-indexed columns still work; queries just run slower against large lists. At pilot scale (10–50 records) this is not critical. Index before real data load, not after. |

---

### S15-T5 — Enter 7 mirror test records

| Question | Answer |
|---|---|
| Can I do this myself? | Yes — only **Contribute (A)** needed to add list items |
| Minimum permission | **Contribute (A)** |
| Notes | Records must be entered with exact field values per the S15 test dataset. Use the `Title` (CredentialID) field as the primary identifier (e.g., `CRED-0001`). `HolderPersonID` values must match exactly the PersonID values that will be in `C3People` (once provisioned). |
| Fallback | None needed — this is the lowest permission level task. |

---

### S15-T6 — Enter 3 stress test records

| Question | Answer |
|---|---|
| Can I do this myself? | Yes — **Contribute (A)** |
| Minimum permission | **Contribute (A)** |
| Notes | Stress record 10 requires an intentionally invalid `ExpiryDate` string value. SharePoint Date columns enforce date format validation on the UI. To enter an invalid date string, you may need to use the SP REST API directly: `POST /_api/web/lists/getbytitle('C3Credentials')/items` with the raw string in the body, bypassing UI validation. This requires knowing the bearer token or using the SPFx request digest — effectively a developer-level task even though the permission level is Contribute. |
| Fallback | If invalid date injection is blocked, enter the stress record with a blank/empty ExpiryDate instead. The missing-date path is exercised; the invalid-string path remains untested until a REST API call can be made. Document the gap. |

---

### S15-T7 — Deploy the SPFx web part

This is the most permission-sensitive task in Sprint 15.

| Question | Answer |
|---|---|
| **Path 1: Tenant App Catalog** | Upload `.sppkg` to `https://[tenant].sharepoint.com/sites/appcatalog`. Requires **SharePoint Admin (D)** or delegated App Catalog Owner. You almost certainly do not have this yourself. |
| **Path 2: Site Collection App Catalog (SCAC)** | Upload `.sppkg` to a per-site app catalog scoped to `https://geekaygames.sharepoint.com/sites/C3`. Requires **Site Owner (C)** to manage the SCAC — BUT enabling the SCAC on the site in the first place requires **SharePoint Admin (D)** to run the feature activation once. After that, a Site Owner can manage it independently. |
| Can I do this myself? | Only if: (a) a SCAC is already enabled on the C3 site, AND (b) you have Site Owner (C) on that site. |
| Minimum permission | **Site Owner (C)** for SCAC path (after one-time admin activation). **SharePoint Admin (D)** for Tenant App Catalog path or for SCAC initial setup. |
| Power Automate needed? | No |
| Entra ID / M365 Admin needed? | No |
| Exact permission to request | "Please enable a Site Collection App Catalog on `https://geekaygames.sharepoint.com/sites/C3` and grant me Site Owner access to that site. I will handle solution deployment and testing from there." This is a one-time request. |
| Fallback | Provide IT with the compiled `.sppkg` file (from `gulp bundle --ship && gulp package-solution --ship` in `packages/c3-spfx-host`) and ask them to upload it to the Tenant App Catalog. Once deployed tenant-wide, any Site Owner can add the web part to a page. The drawback: IT becomes the deploy bottleneck for every subsequent version. SCAC is the better long-term path. |
| Local dev alternative | During testing only, `gulp serve` in the SPFx project runs the web part against the live SharePoint workbench without any App Catalog deployment. This requires only Read access to SharePoint and a local development environment. Sufficient for S15 live credential fetch validation. |

---

### S15-T8 — Switch web part property pane from `mock` to `sharepoint`

| Question | Answer |
|---|---|
| Can I do this myself? | Yes, if you have edit access to the SharePoint page the web part is on. |
| Minimum permission | **Contribute (A)** on the page library (Page Contributor). "Edit page" access is typically granted to Site Members. |
| How | Navigate to the page in edit mode → click the C3 web part → open the property pane → change the "Data source mode" dropdown from "Mock (local / dev)" to "SharePoint (live data)" → republish the page. |
| Fallback | If the page is locked down (approval required), request temporary page edit access from the page owner. |

---

### S15-T9 — Confirm `spSiteUrl` resolves from page context

| Question | Answer |
|---|---|
| Can I do this myself? | Yes — this is a read-only diagnostic. View the page with the web part loaded in SP mode, open browser DevTools (F12), check the console for the `[C3]` diagnostics service output or add a temporary `console.log(config.spSiteUrl)` in a local build. |
| Minimum permission | **Read** — only need to view the page |
| Expected resolved value | `https://geekaygames.sharepoint.com/sites/C3` (from `pageContext.web.absoluteUrl`) |
| Fallback | If spSiteUrl resolves to a sub-site or wrong URL, the normalisation guard in `C3HostWebPart.ts` still passes it through — the REST calls will simply target the wrong URL and return errors. Use the Diagnostics screen to confirm. |

---

### S15-T10 — Run real SharePoint credential fetch validation

| Question | Answer |
|---|---|
| Can I do this myself? | Yes — requires only the ability to view the C3 page in SP mode. The fetch runs automatically on page load. |
| Minimum permission | **Read** on the `C3Credentials` list. The SPFx web part uses the signed-in user's session token for same-site REST calls. |
| Auth note | Native fetch to `{siteUrl}/_api/...` from within an SPFx web part is authenticated automatically via the user's SharePoint session cookie (same-origin). No bearer token or request digest injection is needed for GET reads. If a 401 is returned, the likely cause is a list-level permission restriction, not a C3 code issue. |
| Fallback | If fetch returns 401: check that the signed-in user has at least Read access to the C3Credentials list specifically (item-level permissions may restrict it). If fetch returns an empty array unexpectedly: confirm list internal name is exactly `C3Credentials` (case-sensitive in OData queries). |

---

## Sprint 16 Planning Prerequisites — Task Matrix

### S16-T1 — Create `C3People` list

| Question | Answer |
|---|---|
| Minimum permission | **Edit (B)** |
| Same as | S15-T1/T2/T3 — identical provisioning process, different schema |
| Special consideration | PersonID (`Title` column) values must exactly match the `HolderPersonID` values already entered in `C3Credentials`. Cross-list FK consistency is manual — SharePoint does not enforce referential integrity unless using Lookup columns (which C3 intentionally avoids). |
| Fallback | IT provisions from the C3People schema doc (pending, to be written per S16-1) |

---

### S16-T2 — Create `C3Journeys` list

| Question | Answer |
|---|---|
| Minimum permission | **Edit (B)** |
| Special consideration | The `ObligationAssignmentsJSON` column is a Multi-line text column (plain text, not rich text). Ensure "Allow unlimited length in document libraries" is not required — this is a list, not a document library. Maximum stored JSON length for pilot use is well under the 63,999 character SP limit. |
| Fallback | IT provisions from the C3Journeys schema doc (pending, to be written per S16-2) |

---

### S16-T3 — Decide `ObligationAssignmentsJSON` pilot field

| Question | Answer |
|---|---|
| Permission needed | None — architectural decision |
| Already decided | JSON blob approach accepted as Sprint 16 pilot simplification. Documented in Sprint 16 Planning Memo with explicit long-term caveat (ADR-003 preferred model remains normalised child list). |

---

### S16-T4 — Seed People and Journey test data

| Question | Answer |
|---|---|
| Minimum permission | **Contribute (A)** |
| Same as | S15-T5/T6 |
| Notes | PersonID values in C3People must be entered before Journey records (FK dependency). Enter all 10 people records before any journey records. |

---

### S16-T5 — Prepare operator pilot page

| Question | Answer |
|---|---|
| What this means | Create a dedicated SharePoint page (e.g., `/sites/C3/SitePages/C3-Operations.aspx`) with the C3 web part added, configured in SharePoint mode, accessible to the pilot operator. |
| Minimum permission | **Site Owner (C)** — creating pages and managing page permissions requires Full Control or Site Owner. Adding a web part from the SCAC/App Catalog to a page also requires Site Owner or delegated permission. |
| Exact permission to request | Site Owner on `https://geekaygames.sharepoint.com/sites/C3`, OR delegate page creation to you if a Site Owner will prepare the page. |
| Fallback | IT creates the page shell; you configure the web part property pane. |

---

### S16-T6 — Prepare Power Automate write paths

| Question | Answer |
|---|---|
| Can I do this myself? | Yes — if you have a **Power Automate maker license (E)** |
| License check | Go to `https://make.powerautomate.com`. If you can log in and create flows, you have maker access. The SharePoint connector (used for list read/write) is standard and does not require a premium license. |
| What this will cover | Flows for: `initiateJourney` (POST to C3Journeys), `completeJourney` / `suspendJourney` / `cancelJourney` (PATCH to C3Journeys). C3 will call these via `fetch` to the flow's HTTP trigger URL. |
| SharePoint Admin needed? | No — flow runs under the maker's credentials or a shared connection. For pilot, running under your personal credentials is acceptable. For production, a service account is preferred. |
| Service account (production path) | Creating a shared service account (e.g., `c3-automation@geekaygames.com`) requires **Entra ID / M365 Admin (F)** and a license assignment. This is a post-pilot concern. |
| Fallback | Flows are not needed for Sprint 16 read integration. Write operations remain stubs. This item is future-planning only. |

---

## Permission Summary — What You Need Right Now

To unblock Sprint 15 completely without waiting for more access than the minimum:

| Access | Status | How to get it |
|---|---|---|
| **Edit (B)** on C3 site | Needed for list/column creation | Request from IT: "Edit permission level on `https://geekaygames.sharepoint.com/sites/C3`" |
| **SCAC enabled + Site Owner (C)** on C3 site | Needed for SPFx deployment | Request from IT: "Enable Site Collection App Catalog on `https://geekaygames.sharepoint.com/sites/C3` and grant me Site Owner access" |
| Read access to C3Credentials list | Needed for live fetch validation | Automatically granted if you have any site access level |
| Power Automate maker license | Needed for write path prep (Sprint 16 planning only) | Check `https://make.powerautomate.com` — you likely already have this with M365 Business Standard/Premium |

**You do not need SharePoint Admin (D) or Entra ID Admin (F) for any Sprint 15 or Sprint 16 task**, provided SCAC is enabled on the C3 site once by IT.

---

## Recommended IT Access Request

The following is ready to send. Adjust the contact name and site URL as needed.

---

**Subject:** C3 Platform — SharePoint Access Request (Sprint 15 + 16)

Hi [IT contact],

I'm in the process of deploying the C3 Contract Control Center platform to our SharePoint site at `https://geekaygames.sharepoint.com/sites/C3`. I need your help with the following, in priority order:

**1. Edit-level access to the C3 site (immediate)**
I need permission to create SharePoint lists and columns directly. The built-in "Edit" permission level (which includes Manage Lists) would cover this. Please add my account to the Site Members group with Edit access, or grant the Edit permission level directly to my account on this site.

**2. Site Collection App Catalog (immediate — one-time setup)**
I need to deploy a SharePoint Framework (SPFx) solution to this site only. Please enable a Site Collection App Catalog on `https://geekaygames.sharepoint.com/sites/C3`. This is a one-time step from the SharePoint Admin Center:
- Admin Center → Active sites → select the site → Settings → Enable Site Collection App Catalog
Once enabled, I can manage solution deployment myself as Site Owner without further IT involvement for each update.

**3. Site Owner access on the C3 site (after SCAC is enabled)**
To add the C3 web part to pages and manage the site, I need Site Owner access on the C3 site specifically. This does not require SharePoint Admin access — it's scoped to this one site.

**What I do NOT need:**
- Global Admin or Entra ID Admin
- SharePoint Admin access to other sites
- Tenant App Catalog access

**Why this is needed:**
The C3 platform reads live operational data (credentials, people records, journey workflows) from SharePoint lists. The SharePoint Framework web part hosts the application. The Site Collection App Catalog allows us to deploy and update the web part independently of IT for future sprints.

Happy to walk through this on a call if useful.

Thanks,
[Your name]

---

*This request covers access requirements for Sprint 15 (live credential validation) and Sprint 16 (People and Journey SP integration).*

---

## Risk Log — Access Blockers

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| IT delays SCAC setup | Medium | Blocks SPFx deployment; S15 real fetch test must use `gulp serve` local workbench instead | Use local workbench (no App Catalog needed) for S15 real validation. Unblocks the credential fetch test. SPFx page deployment deferred. |
| IT grants Contribute but not Edit | Medium | Cannot create lists — IT must provision C3Credentials, C3People, C3Journeys | Provide exact schema docs to IT for each list. Request review via screen share to catch column name errors early. |
| Stress record 10 (invalid date) cannot be entered via UI | High | UI date picker rejects non-date strings | Use REST API POST from browser DevTools (`fetch()` with request digest header) or from a PowerShell / PnP CLI script. Alternatively, accept blank ExpiryDate as a substitute and document the gap. |
| SCAC feature not available in tenant plan | Low | Some Microsoft 365 plans restrict Site Collection App Catalogs | Fall back to Tenant App Catalog via IT. Provide `.sppkg` file to IT contact. Not a blocker for functionality — only for deployment self-sufficiency. |
| Power Automate license not included in current M365 plan | Low | Cannot create flows for Journey write path prep | Power Automate is included in M365 Business Standard and above. Check `https://make.powerautomate.com`. If not available, this is a budget/license question and affects Sprint 16 write implementation only, not read-only SP integration. |
