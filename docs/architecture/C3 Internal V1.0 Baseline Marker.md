# C3 Internal V1.0 Baseline Marker
**C3 Contract Control Center**
**Declared:** 2026-07-05
**Declaration commit:** `3241213` — `docs(s32): Close Sprint 32 — TD-34 recovered, Part 19 complete, Internal V1.0`
**Runtime asset at declaration:** SHA-256 `bb2ffba3ce04b57fc7aae30dfa74997ca978c7b8a349b1b5b436ea9a29b0492b`
**Deployed solution:** `1.0.0.2` (tenant-deployed, enabled, no per-site install) at
`https://geekaygames.sharepoint.com/sites/appcatalog` — ProductId
`45869e8b-fd26-40a3-b9f0-c07ce65c86de`, catalog item `c3de4e6d-fbd8-4a26-bc39-18adbc7b0402`.
**Live artifacts:** host bundle `8138ea6a…`, runtime chunk `dc718d6c…` — both match the
production package.
**Status:** ✅ **INTERNAL V1.0 — ACCEPTED**

---

## Statement

C3 Internal V1.0 is declared as of commit `3241213`. All Sprint 32 Hosted Part 19 checks are
green, the last V1 blockers (TD-33 cold-modal crash; TD-34 hosted blank render) are resolved,
and the genuine owner-authored contract GKE-PL-2026-001 is truthfully readable end-to-end.

This marker preserves the exact state at which Internal V1.0 was accepted so it can be
reproduced, referenced, or branched. No source, runtime, or SP schema was changed between the
Sprint 32 closeout commit and this marker.

## Accepted capabilities (hosted-verified, SP DSM)

1. **Governed C3Contracts read surface** — canonical schema (Phase 3C) + exact five-principal
   ACL (Phase 3D), both permanently closed; read-only, fail-closed contract service.
2. **Truthful Contracts + Renewals** — no fabricated rows/readiness/renewals/counts; zero/
   missing data never implies readiness; Renewals tracks active contracts with honest windows.
3. **Genuine-row Contract Profile** — GKE-PL-2026-001 opens from the Contracts register and the
   related People profile with canonical **plain-text** Contract ID (`ContractID := Title`);
   numeric SP Id never used as business identity; all displayed values match SharePoint.
4. **Canonical People derivations** — People register carries no stale `TotalContracts`; Person
   Profile derives contract count from canonical C3Contracts by exact plain-text `PersonID`.
5. **Cold-safe modal workspaces** — People, Add Person, PersonProfile, Contracts, Renewals,
   Missions render and open modals cold without the Fluent/Tabster crash (TD-33).
6. **Hardened SPFx host** — visible fail-closed error + bounded diagnostics instead of a silent
   blank; validated import/export/mount lifecycle (TD-34, defence-in-depth).
7. **Application read-only Contracts** — no New Contract / Save / Edit / Delete / Submit surface;
   all governance remains ADR-013 / SP-side.

## Accepted debt (non-blocking for Internal V1.0)

| Item | Notes |
|---|---|
| TD-29 | Residual two-session simultaneous-execution race — accepted (single-owner execution; freshness + ETag bounds) |
| TD-22 remnant | Legacy `C3_Contracts` → `C3Contracts` data-migration tool — post-V1 backlog (Track 16) |
| TD-23 | Intelligence SP DSM cold-load — contained (hidden in SP DSM) |
| TD-24 / TD-25(res) / TD-26 / TD-27(res) | Provisioning / write-path items — contained/deferred |
| TD-14/15/16/17/21, TD-05/10 | Standing quality gaps — no V1 runtime risk |

## Operational note — hosting

TD-34 established that **rapid successive tenant redeploys can degrade app-catalog
registration/propagation** and produce a blank render. The failure is a **first-mount
failure in view mode** (assets are intact — bundle hashes match — and diagnostics reach
`mount-complete`); it is transient and cleared by any **re-mount** of the web part.

Recovery, fastest first:

1. **Owner one-click workaround (no redeploy):** on the blank page, click **Edit** then
   **Cancel** — SharePoint re-instantiates the web part and returns to view mode
   re-mounted, and C3 renders. This is the owner's reliable fix and needs no deploy.
2. **Hard reload / fresh load** after catalog/CDN propagation also re-mounts and renders.
3. **Only if a fresh instance stays blank** with matching bundle hashes and `mount-complete`:
   a single clean **retract + redeploy** with propagation time — not repeated redeploys,
   and not removing/re-adding the page instance.

Guidance: deploy once and allow propagation before re-testing; avoid rapid successive
redeploys.

## Reference documents

- Sprint 32 closeout: `docs/architecture/Sprint 32 Closeout Report.md`
- Hosted verification: `docs/architecture/C3 Beta Checkpoint — Sprint 32.md`
- TD-34 evidence: `docs/architecture/S32 Part 19.6 — C3.aspx Preservation + Diagnostic Isolation.md`
- Tech debt register: `docs/architecture/C3 Tech Debt Register.md`
