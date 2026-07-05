# C3 Brand Identity v1.0 + Public Website v1.1.0 — Completed Workstream Record

**Recorded:** 2026-07-05 · **Status: BOTH WORKSTREAMS CLOSED.**
Canonical detail (do not duplicate here):
`C:\Projects\c3-website\docs\C3-WEBSITE-IDENTITY-CLOSEOUT-v1.1.0.md`.
No website screenshots, assets, ZIPs, or baselines are copied into this
product repository.

## Brand Identity v1.0 (frozen)

- C3 public identity — brand **C3**, tagline **Control. Command.
  Coordinate.**, expanded meaning Control Command Center, domain c3hq.org.
- Official mark **A2.2 Reduced Cut** with the **10.5° terminal cut**.
- Wordmark typography IBM Plex Sans SemiBold — production lockups are
  **pre-outlined vector paths**; no font files ship anywhere.
- Approved colors: Command Black `#0D0D0D`, Paper White `#F5F4F1`,
  Identity White `#FFFFFF`, Signal Red `#C22A22`.
- Production package `C3-Identity-v1.0.zip`, SHA-256
  `0792c873cea1f16f1d18d18a94d883100b69c6a9e4a957c1b9e5e4da23762532`.
- **The identity is frozen.** No geometry/color edits, no alternate marks,
  no further design exploration planned.

## Website Identity v1.1.0 (live)

| Item | Value |
| --- | --- |
| Repository | `C:\Projects\c3-website` (isolated; no remote; never mix with product code) |
| Deployed source commit | `2c33e5b09aad5822fba186123c6f3939244952a3` |
| Documentation commit | `1c544d3` |
| Release tag | `website-v1.1.0` (annotated, local) |
| Live Worker version | `c06e6b94-b54d-4c27-8636-f2cbb719b282` (Worker `c3-website`) |
| Rollback version | `cfd5f429-638f-4929-81be-ca00a3bf5321` (website v1.0.0) |
| Hosted validation | **129/129** Playwright tests green against live c3hq.org |

- Cloudflare **Web Analytics is disabled** (its zone-level beacon
  auto-injection was found, CSP-blocked throughout, and removed by the
  owner; it must stay off unless the Privacy Notice and tracking posture
  are intentionally reopened).
- **No analytics, tracking, cookies, or mailing-list behavior** exists on
  the public site.
- The **early-access form remains disabled** (no backend, Turnstile, or
  Resend).
- Privacy Notice live at /privacy (effective 5 July 2026; operator
  "Ihab Tarrafti, operating C3").
- **The website workstream is closed.** No website feature work is
  authorized; the product boundary and Sprint 33 are unaffected.

## Decision-ledger entries (locked)

1. **D-BRAND-1 (2026-07-05):** C3 brand identity v1.0 (A2.2 Reduced Cut,
   approved colors above) is the sole public identity and is frozen.
2. **D-BRAND-2 (2026-07-05):** the public website runs from the isolated
   `c3-website` repository; product and website code/tokens/assets are
   never mixed.
3. **D-BRAND-3 (2026-07-05):** public-site analytics/tracking are
   prohibited; Cloudflare Web Analytics stays disabled; any change requires
   the Privacy Notice review chain first.
