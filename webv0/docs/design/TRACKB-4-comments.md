# Track B4 — Contextual comments + @mentions

**Status: BUILT. Migration 0039.** Fourth Track B item; pairs with B5.

Discussion kept ON the record, IN C3 — the connective-tissue upgrade over
plain notes: clarification threads (and their governance reasoning) stay on
the person/mission/agreement/approval instead of scattering to WhatsApp.

## Model

- A `comment` is `{ subjectType, subjectId, author, body, mentions[], createdAt }`
  attached to one of four subject types (Person/Mission/Agreement/Approval).
- **Append-only** — same law as the event streams (no UPDATE/DELETE grant). A
  comment is part of the record's history the moment it lands. (Edit/soft-delete
  is a deliberate v2 with its own audit, never a quiet rewrite.)
- **@mentions are explicit** — the composer picks members (no fragile @-text
  parsing). Each mentioned member (self dropped, deduped) gets one S10
  notification row (`kind: 'Mention'`, unique signalKey → the existing dedupe
  handles re-posts) that links back to the record.

## Access — you comment where you can read

The per-subject gate mirrors that record's own read gate and checks existence
in-tenant: Person/Mission → `assertReadPeople`; Agreement → `assertReadAgreements`;
Approval → submit/review standing. So read-only reviewers (legal on an
agreement) can ask questions, but a role that can't see a record can't comment
on it, and cross-tenant is RLS-invisible (404).

## Signals law

Comments create discussion, not obligations — **no new cockpit signal** (the
@mention already reaches the bell, which is the right surface). Recorded as
deliberate.

## Mechanics

- 0039 `comment` table (RLS FORCE, append-only grants) + tenantTables registry
  (export/exit).
- `commentOps.postComment` (subject gate → insert → mention fan-out) +
  `listComments`.
- API `GET /api/v1/comments?subjectType&subjectId`, `POST /api/v1/comments`.
- Web `<CommentThread subjectType subjectId />` embedded on the four detail
  pages; a Fluent TagPicker mention picker shown only when the viewer can read
  members (owner/ops) — other roles comment without it.
