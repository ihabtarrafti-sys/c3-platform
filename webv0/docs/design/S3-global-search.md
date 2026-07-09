# S3 — Global search (one box, only your world)

Track A S3 per `C:\Projects\C3-CONSOLIDATED-PLAN.md`: any id or name, across
every register — **within the actor's role boundary**.

## Design

- **The role boundary IS the feature.** The server fans out only to domains
  the actor may read: agreements need `canReadAgreements`; the approvals queue
  needs submit/review standing; members are deliberately OUT of V1 (directory
  data). A denied domain is simply **absent** from results — the registers'
  truthful-absence rule applied to search. A visitor searching an agreement
  code gets *"No matches you can see."*
- **Identity fields only.** Ids, names, codes, types, titles. Financial values
  are never matched and never returned — search must not out-leak
  `canViewFinancials` (asserted in the API test: the agreement's value never
  appears in any result payload).
- **Matching**: case-insensitive substring over — person (id, name, IGN,
  personnel code), mission (id, name, tournament code, organizer, city),
  agreement (id, code, type, anchor ids), entity (id, name, code,
  jurisdiction), credential (id, type, person, issuer), journey (id, title,
  type, person), kit/apparel (id, name, category, assignee), approval (id,
  operation, targets). Min 2 chars (no full-table dumps), 5 hits per domain.
- **Mechanics**: in-memory filter over the existing RLS'd list reads — no new
  persistence, **no migration**. Honest at Geekay scale; the scale-up path is
  a pg_trgm index + SQL ILIKE pushdown behind the same wire contract.
- **Web**: `GlobalSearch` in the IdentityBar — **Ctrl/Cmd+K** focuses from
  anywhere; grouped results with id + context line; Enter opens the top hit;
  Escape/click-away dismisses; hits deep-link (kinds without a detail page
  land on their register).

## Evidence

Typecheck 9/9. Gate PASSED (api search suite: by-name/IGN/code/id hits, the
role matrix — visitor sees no agreements/approvals for the same query legal
DOES see agreements, tenant isolation returns nothing cross-org, sub-minimum
queries return empty, and the no-value-leak assertion). E2E: new
`search.spec.ts` — Ctrl+K focus, person by name → click-through, mission by id
→ Enter, owner finds the agreement code, the visitor gets the truthful
absence.

## Deploy

**No migration.** One owner paste (API up) → web (me).
Pastes: `C:\Projects\C3-S3-DEPLOY-PASTES.md`.
