# S47 — Direction E adoption, sprint 1: the material foundation

**Owner decision (2026-07-09): Direction E — "Liquid Glass × Revolut polish" — is
C3's FORWARD IDENTITY.** Packet: `C:\Projects\C3 Direction E - Liquid Glass
(standalone).html` (Design lane, S44-B engagement; intake clean, feasibility-read
accepted). This supersedes the black/paper/red identity in the product; the
marketing site (c3hq.org) keeps the current identity until the owner instructs
its migration as a separate move — the widest brand seam of any direction,
chosen deliberately.

## The law survives the material (non-negotiable, from the packet itself)

- **Glass = ambient. Matte = consequence.** Chrome, navigation, signals and
  ephemeral menus may float and refract. Dense data and EVERY governed surface
  is matte, opaque, grounded — no blur, no rim, no glow. The honesty pair is
  now carried by the material itself.
- **Indigo carries the brand; red means one thing.** Attention only. Red may
  glow softly on a floating signal that genuinely needs you; it never touches
  a governed action.
- Absence of data is never a gap; reduced-transparency/motion opt-outs are
  first-class (solid fallback tokens, same layout, same contrast).

## Phasing

- **S47 (this sprint):** token system v3 (dark-first + light), Fluent theme
  pair with the indigo ramp, mode toggle + persisted preference, glass material
  tiers, reduced-transparency fallbacks + reduce-effects toggle, and the full
  surface re-skin (shell, registers, drawers, dialogs, cockpit, status family).
- **S48:** photography surfaces — mission banners + Situation header with
  curated static imagery behind scrim+glass; monogram fallbacks everywhere.
- **Later, separate owner moves:** person-photo upload (real feature: storage,
  permissions), c3hq.org migration, governance foundation-doc amendment
  (COO lane records the identity change).

## Feasibility corrections vs the packet (recorded at intake)

- "Drop to matte automatically on low-end GPUs" → browsers cannot reliably
  detect GPU capability. Implemented mechanism: honor
  `prefers-reduced-transparency` + `prefers-reduced-motion`, plus a
  user-facing "Reduce effects" toggle. Same outcome, honest means.
- AA claims re-verified during build against real composites, both modes.

## Token architecture (E-1)

New semantic tokens (mode-switched via `data-c3-mode` on `<html>`; dark is the
default): `--c3-ground`, `--c3-surface-data`, `--c3-surface-raised`, `--c3-ink`,
`--c3-ink-mid`, `--c3-ink-muted`, `--c3-line`, `--c3-brand`, `--c3-brand-ink`,
`--c3-attention`, `--c3-status-steady/warn/danger/info`, glass tiers
(`--c3-glass-1/2` fills + `--c3-blur-1/2` + rim), radius scale
(`--c3-radius-data: 14px`, `--c3-radius-chrome: 18px`, `--c3-radius-float: 20px`)
replacing the 2px Command Desk edge. Legacy `--c3-*` names are remapped as
aliases onto the new semantics so every surface stays coherent during the
migration; aliases are removed when the last consumer migrates.

Palette (verbatim from the packet):

| role | dark (default) | light |
| --- | --- | --- |
| ground | `#0a0c14` | `#f3f4fa` |
| matte data / surface | `#13151e` | `#ffffff` |
| glass rim / hairline | `#2b2e3a` | `#e2e4ee` |
| ink | `#eef0f6` | `#12141d` |
| muted | `#868d9e` | `#656c7a` |
| brand (indigo) | `#5666f0` | `#4b57db` |
| brand ink | `#a6b0ff` | `#3a44c4` |
| attention | `#ff5d5a` | `#c5352f` |
| steady | `#3ac9ab` | `#12816f` |
| warn | `#f0b454` | `#8f5e14` |
| info | (packet family) | (packet family) |

Glass tiers: T1 chrome = white 6% + blur 28 + saturate 160 + rim light;
T2 float = white 9% + blur 34 + shadow. Never nested. Governed surfaces are
tier-locked to matte.

## Evidence bar (unchanged)

Typecheck, gate, 9/9 E2E on the final tree, AA spot-verification both modes,
screenshot self-check (dark + light + reduced-transparency), staging deploy,
owner visual gate.
