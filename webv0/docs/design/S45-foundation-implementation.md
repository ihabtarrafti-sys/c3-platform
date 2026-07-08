# S45 — Implementing the accepted design foundation (type · motion · drawer)

**Trigger (owner, 2026-07-08):** the S44 visual gate did not clear — "feels like
a very basic ai-website UI/UX… animation-wise not very appealing." While
preparing the Claude Design brief (S44-B), the Architect lane discovered that
three owner-accepted pieces of the canonical design foundation
(`c3-governance/product/design/`) had never been implemented in webv0. S45
closes that debt. No new design authority was invented: everything here
implements what A-PRODUCT-FOUNDATION.md and B-COMPONENT-SPECIFICATIONS.md
already specify.

## 1. A.4 Typography — IBM Plex, actually loaded

The token file declared `"IBM Plex Sans"` since Part A, but the woff2 files
were never self-hosted — the entire app rendered in the Segoe fallback.

- Vendored from the official IBM npm packages (`@ibm/plex-sans` 1.1.0,
  `@ibm/plex-mono` 2.5.0, transient install, `--ignore-scripts`):
  Sans 400/500/600 + Mono 400, ~246 KB total, OFL-1.1 license file alongside
  (`src/theme/fonts/OFL-LICENSE.txt`). No CDN — bundled by Vite, self-contained.
- `src/theme/fonts.css`: four `@font-face` rules, `font-display: swap`.
- `body` now carries the A.4 Body base (14/22). PageHeader was already at
  Display 28/34/600; register `th` eyebrows, mono `idLink`s, and the identity
  bar were already spec-shaped — they simply render in Plex now.
- Fluent components pick Plex up through the theme's existing
  `fontFamilyBase`/`fontFamilyMonospace` (set in c3Theme since Part A but
  previously falling back).

Hosted proof: `document.fonts.check()` true for Sans 400/600 and Mono 400.

## 2. A.8 Motion — the foundation's clock, exactly the allowed list

- Tokens in c3-tokens.css: `--c3-dur-state: 120ms`, `--c3-dur-enter: 180ms`,
  `--c3-dur-drawer: 240ms`, `--c3-ease: cubic-bezier(0.2, 0, 0, 1)`.
- **Theme-level mapping**: Fluent's `durationFast/Normal/Gentle` and
  `curveEasyEase/curveDecelerateMid/curveAccelerateMid` slots are set to the
  A.8 values in c3Theme.ts, so Drawer slide, Dialog fade, and control
  transitions all move on the foundation's clock without per-component hacks.
- Implemented choreography (A.8's allowed list, nothing more):
  drawer slide-in (240ms), notification fade-in (`c3-enter` keyframes, 180ms,
  fade + 4px settle), register row hover (120ms), nav item hover (120ms).
  Focus rings remain Fluent's.
- **Reduced motion is a contract**: a global
  `@media (prefers-reduced-motion: reduce)` rule collapses every transition
  and animation to ≤0.01ms. States change instantly; nothing loses meaning.
- Deliberately NOT added (A.8 prohibitions stand): shimmer, staggered
  theatre, celebratory motion on governed actions. Proposals to go beyond
  this restraint belong to the Claude Design lane (S44-B) with owner
  arbitration.

## 3. B.13 Drawer — governed entry slides in from the right

`components/FormDrawer.tsx` replaces the S44 inline `FormPanel` (deleted).
All seven create forms now open as a right-side `OverlayDrawer` (480px;
full-screen sheet under 640px):

People · Credentials · Journeys · Agreements · Members (governed — black
front rail + "Governed request" chip) and Kit/Apparel · Missions (direct —
ink rail + "Immediate · recorded" chip).

- Anatomy: hairline header (eyebrow at the A.4 Eyebrow spec 11/16/500/0.14em ·
  mode chip · close), scrollable body (intro + field stack), paper-white
  hairline-top commit footer holding the GovernedAction trigger.
- We render our own header/body/footer frame inside `OverlayDrawer` — the
  stock `DrawerHeader`/`DrawerBody` wrappers impose a grid that fights the
  Command Desk anatomy (found via screenshot self-check, fixed before deploy).
- Modality per B.13: focus trap while open, background inert, Esc/backdrop
  close, focus returns to the invoking control (Fluent modal behavior),
  `role="dialog"` + label from the eyebrow.
- **Dirty-guard reading**: B.13 says "never silently discard entered data."
  Field state lives in the calling page, so closing the drawer hides it but
  reopening restores exactly what was typed; state clears only on successful
  submit. No blocking "discard?" dialog was added — nothing is discarded.
- Toggle buttons became pure openers (static label; the old flip-to-Cancel
  is meaningless behind a modal backdrop). All `data-testid`s unchanged,
  including `${trigger}-confirm`; new `form-drawer-close` on the ✕.
- The GovernedAction confirmation Dialog stacks correctly above the open
  drawer (screenshot-verified; exercised by all governed-create E2E paths).

## Known simplifications (recorded, not hidden)

- B.13 mentions an in-panel NotificationRegion; submit feedback continues to
  use the global notification region (B.16) that every E2E asserts against.
  Revisit with the Design lane if in-panel validation display is specced.
- B.3 Breadcrumbs / B.5 ActionBar / B.17 AuditTimeline conformance was not
  re-audited in this sprint; S45 scope was the three felt gaps (type, motion,
  drawer).

## Evidence

- Typecheck all projects; gate PASSED (entra bundle scan: 10 emitted files,
  no dev-auth material — fonts included).
- E2E 9/9 on the final tree; the drawer conversion changed no testid and no
  workflow.
- Screenshot self-check against the local stack: governed drawer, direct
  drawer, dialog-over-drawer, register at rest; `document.fonts.check()`
  proof that Plex 400/600/Mono are live.

## Gate

The owner's eyes on staging — same as S44. S45 is the foundation actually
implemented; the beyond-foundation signature work is with Claude Design
(S44-B brief at `C:\Projects\c3-design-brief\`).
