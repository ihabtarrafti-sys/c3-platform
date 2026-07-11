# Track B3 — Activity Feed (org journal over the audit stream)

**Status: BUILDING.** Third Track B item; deploys as a pair with B2.

The org journal: a **read-only, chronological projection of the append-only
audit stream** — the same events every record page already keeps, gathered
into one "what happened" view. Near-free by construction (the data exists; no
new writes, no new table).

## What it shows, and what it doesn't

Each item is `{ at, actor, action, entityType, entityId, headline }`. The
headline is derived from the AuditAction verb (`humanizeActivityAction`:
`PersonDeactivated` → "Person deactivated"), so the feed stays correct as new
actions ship — no per-action table to maintain. It shows the ACTION and the
record; it never renders raw `before`/`after` values (those stay on the
record's own gated timeline). So the feed discloses nothing a role couldn't
already see on the record pages.

## Gate + pagination

- **Owner/operations** (`canManageEntities`) — the oversight audience. (A
  per-role personal feed is a possible v2; v1 is the management journal.)
- **Keyset pagination**, newest first: `ORDER BY at DESC, id DESC`, cursor
  `"<at>|<id>"`, fetch `limit+1` to know if an older page remains. Stable
  under inserts (no OFFSET drift); RLS applies to `audit_event`.

## Signals law

A passive journal, no obligations → **no new cockpit check** (satisfied
vacuously, recorded deliberately).

## Mechanics

- Persistence `listActivityFeed(limit, before)` — one keyset SELECT over
  `audit_event`.
- `activityOps.listActivityFeed` — gated, projects headlines, returns
  `{ items, nextCursor }`.
- API `GET /api/v1/activity?limit&cursor`.
- Web `ActivityPage` — timeline list with clickable targets for routable
  entity types, "Load more" (react-query `useInfiniteQuery`), nav entry.
