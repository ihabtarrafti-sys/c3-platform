# B-4 — Data Residency & Provider Facts (Architect-verified)

**Gate item:** B-4 (+ B-3 technical axis), Stage-4 admission gate. **Status: Factually verified** — the facts below are confirmed by direct runtime inspection, 2026-07-07 (repo tip `fa243ef`). Interpretation/legal role classification remains counsel's (path 2); this record supplies the technical truth.

## Where C3 staging data actually lives

| Component | Provider | Region (verified how) |
|-----------|----------|----------------------|
| **API runtime** (`c3-api`) | Railway | **`sfo` — San Francisco, USA** (`RAILWAY_REPLICA_REGION` read in-container, 2026-07-07) |
| **PostgreSQL** (operational data) | Railway | **`sfo` — San Francisco, USA** (same method) |
| **Backup cron** | Railway | same project/environment |
| **Encrypted backups** | Cloudflare R2 | **WEUR — Western Europe** (verified Phase 2D; age-encrypted, private bucket) |
| **SPA delivery** | Cloudflare Pages/CDN | global edge (static assets only — no operational data at rest) |
| **Identity** | Microsoft Entra ID | Microsoft global service, tenant `295213e5-…` (c3hq.org tenant) |

No explicit region override is configured on any Railway service (`multiRegionConfig.region: null` → platform default, currently sfo). **Transfer behavior note:** with no pinned region, a redeploy could in principle land elsewhere if Railway's default changes — pinning the region in service settings is a cheap hardening (owner/one-click) if residency is stated publicly or contractually.

## The truthful residency statement (for the legal pack to adopt)

> Operational data is processed and stored in the **United States** (Railway, US-West/San Francisco). Encrypted backups are stored in the **European Union** (Cloudflare R2, Western Europe). Identity sign-in is provided by Microsoft Entra ID. Static web assets are delivered via Cloudflare's global CDN and contain no customer data.

## Consequences

- Unblocks the legal/privacy pack's residency answer (was "Railway region requires investigation").
- Sub-processor register technical axis: Railway (US-West) / Cloudflare R2 (EU-West) / Cloudflare CDN (global) / Microsoft Entra — all Active on staging, now with regions.
- **Commercial consideration for the owner (not a defect):** EU-first prospects may prefer EU primary hosting; Railway offers an EU region — moving PG+API is possible but is a deliberate migration, not a toggle. Decide only if/when a real partner requires it.
- Handoff: relay to the governance/website lane via Cross-Lane Status Packet (this lane does not write `c3-governance`).
