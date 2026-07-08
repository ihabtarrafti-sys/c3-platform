# S46 — Command Desk v2: the approved Design packet, implemented

**Authority chain:** S44-B Claude Design packet (delivered 2026-07-08, intake-accepted;
`C:\Projects\c3-design\`) → owner arbitration **"all seven as recommended"** →
this sprint. Every relaxation implemented here was individually approved; the
relaxations ledger in the packet is the reference. Identity-horizons exploration
(beyond black/white/red) runs in the Design lane in parallel and does NOT gate this.

## The seven approved lines, as built

1. **Display scale** — PageHeader `kicker` prop (mono, 0.14em): its presence selects
   the command scale (52/56/−0.03em); default is 40/46/−0.02em. All 8 registers
   carry `kicker="Register"`; the cockpit carries `kicker="Situation"`; detail
   pages stay at 40.
2. **Instrument voice** — register `th` set in Plex Mono 500/0.14em caps; tables
   get `font-variant-numeric: tabular-nums`; a `mono` cell helper added. Cockpit
   eyebrows/chips/ledger states all mono.
3. **Command density** — `canvasWide` (1520px) applied by route: register list
   pages + `/situation`; detail/reading surfaces keep the 1200px calm measure.
4. **Signal Red breathing** — new `signal` StatusBadge variant (Signal Red);
   agreement renewal state **Expired** now renders in it (label unchanged).
   Plus ONE pulse dot (2.4s, infinite, 7px) on the single top live signal in the
   cockpit — nowhere else, never on governed flows.
5. **"Steady" accent** — HELD at compare-first, as agreed: the ledger's
   clear/holding dots use the frozen `--c3-status-ready` green. If the owner
   wants the brighter instrument teal after seeing it live, minting
   `--c3-accent-steady: #2f7d6b` is a one-line token + two class changes.
6. **Motion level 4, Situation Room only** — staggered card rise (480ms C3 ease,
   70ms stagger, fill backwards), once-on-load scan sweep across the stat ribbon
   (2600ms, pointer-events none), and the pulse dot. All collapse under the
   global reduced-motion rule.
7. **Motion v2 base timing (A.8 amendment)** — tokens now 130/200/280ms + rise
   480 / sweep 2600 / pulse 2400, one easing `cubic-bezier(0.22, 1, 0.36, 1)`
   ("C3 ease") in both the CSS tokens and the Fluent theme slots.

## Cockpit v2 (D-4b Tier 1)

- **Stat ribbon** (`situation-ribbon`): ACTIVE MISSIONS · ROSTERED PLAYERS ·
  CREDENTIALS TRACKED · LIVE AGREEMENTS · OPEN APPROVALS. Counts come from the
  SAME one-pass read as the signals (`SituationView.counts`; contract
  `situationCountsSchema`; additive API change, openapi regenerated).
- **Always-on check ledger** (`situation-checks`, both states): each of the 7
  engine checks reports firing / watching / in motion / clear, derived from the
  live signals via the new domain export `SITUATION_CHECK_KINDS` (index-aligned
  with `SITUATION_CHECKS`). One engine, no second source; the all-clear is now
  provably not blindness in EVERY state.
- Cards: mono eyebrow, 17px headline; actions unchanged (navigate-into-context
  only — cards never mutate).

## Deploy note

API + web ship together this sprint (no migration). ORDER MATTERS: the web
client's response schema requires `counts`, so the API deploys FIRST (owner
paste), then the web bundle. Old-web + new-API is compatible (additive field).

## Evidence

Typecheck all projects; gate PASSED (unit suite + NUL audit + entra bundle scan);
E2E 9/9 first run on the final tree; self-check screenshots — the engine derived
a REAL mission-readiness signal ("MSN-0001 starts in 66 days and is not ready")
for a mission created through the product during the check, with ledger `1 firing`,
ribbon counting, and every other check honestly clear.

## Tier 2 (North star) — roadmap extraction, NOT built

Readiness timeline (needs windowed projection), readiness trend (needs history
storage — a real persistence decision), org pulse (**derivable now** — first
candidate for the assess loop). Each enters the backlog as its own ticket.
