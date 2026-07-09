# S48 — Entities: the tenant's legal operating entities

**Owner direction (2026-07-10):** add "entity options with clubs/orgs" — clarified
in intake to mean the TENANT COMPANY'S OWN legal operating entities per
jurisdiction (e.g. a UAE company with its own licence/bank, a KSA company). NOT
external clubs/sponsors. People are assigned to the one entity they signed with;
agreements sit under an entity. Owner confirmed **Model A** (one entity + optional
person). Direct-audited, owner/operations manage.

## What shipped (the entity anchor)

- **Entity domain** (`domain/entity.ts`) — `ENT-XXXX`, name, jurisdiction (free
  text), optional registration/licence id, isActive, version. Direct-audited
  create/update/deactivate (the mission-shell pattern): role-gated
  (`canManageEntities` = owner/operations), version-guarded, per-mutation audit
  (`EntityCreated`/`EntityUpdated`/`EntityDeactivated`), changed-fields-only
  update images. RLS ENABLE+FORCE, tenant-scoped, no app DELETE.
- **Migration 0016** — the `entity` table (+ its counter kind) and NULLABLE
  `entity_id` columns on `person` and `agreement` (composite FK, tenant-scoped).
  Existing rows pre-date entities and stay null until assigned.
- **Person** gains "signed with" `entityId` (one primary): the governed
  AddPerson flow threads it through submit → execute; a friendly submit-time
  existence check backs the FK.
- **Agreement** gains "under entity" `entityId`: threaded through the governed
  AddAgreement flow; the register shows an Entity column (name-resolved).
- **Full stack**: authz capability + assert, api-contracts (entity schemas,
  `entityId` on person/agreement DTOs, `canManageEntities` in the capability
  view), API routes (`/api/v1/entities` GET/POST + `/:id` update + `/:id/deactivate`),
  DTO mapper, web register (`EntitiesPage`, nav gated on `canManageEntities`,
  route, `useEntities`), and entity pickers on the Add Person + Add Agreement
  forms.
- **Export/exit ceremony (B-5)** kept whole: `entity` added to the export
  bundle (+ `entity_id` on the agreement export projection) and to the FK-safe
  exit deletion order (after person + agreement).

## Deliberately staged as a fast-follow

- **Person-less, entity-level agreements** (a pure company-level agreement with
  no individual). Model A includes "optional person," but making
  `agreement.personId` nullable flips the governed pipeline's required
  `targetPersonId` (woven through 43 files and every governed test). That is its
  own careful sprint, not a rider on this one. This sprint ships the anchor:
  agreements are *under* an entity, with a person.
- **Finance layer** (banking, per-diem, agreement money model) — reserved for
  the joint "make C3 whole" session. Account numbers / payment credentials are
  never stored (hard security line); banking is referenced by label only.
- **External counterparties** (sponsors/brands as their own records) — a later
  domain if the owner ever wants it.

## Evidence

Typecheck all projects; gate PASSED (395 tests incl. 6 new entity tests: CRUD +
audit images, owner/ops gate, RLS isolation, person + agreement threading,
friendly not-found); **E2E 10/10** (new `entities.spec` walks create → picker
appears on Add Person → edit → deactivate → visitor sees no nav). Screenshot
self-check in the Direction E dark theme.

## Deploy

Migration 0016 (owner paste) → API (owner paste) → web (me).
