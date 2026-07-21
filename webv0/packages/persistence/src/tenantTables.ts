/**
 * tenantTables.ts — HARDEN-0 (audit H-03): the ONE authoritative registry of
 * tenant-keyed tables, consumed by BOTH ceremonies:
 *
 *   - exportTenant: every registered table exports (in registry order,
 *     parents before children, with date columns cast ::text so the bundle
 *     carries ISO strings, never driver-parsed Dates);
 *   - exitTenant: every registered table is erased (in exitRank order,
 *     children before parents), so the final `DELETE FROM tenant` cannot
 *     hit a surviving FK and roll the ceremony back.
 *
 * THE LAW: db.test.ts compares this registry against pg_catalog — every
 * table in the live schema carrying a tenant_id column MUST be registered
 * (and nothing extra may be). Adding a domain table without registering it
 * here fails the gate; forgetting is unrepresentable.
 *
 * Directory tables (app_user, external_identity, tenant itself) are NOT
 * tenant-keyed and keep their bespoke handling in the ceremonies.
 */

export interface TenantTableSpec {
  /** Table name in the public schema. */
  readonly name: string;
  /** Export SELECT with $1 = tenant id. Dates cast ::text. */
  readonly exportSql: string;
  /** Exit deletion order: LOWER deletes first (children before parents). */
  readonly exitRank: number;
}

export const TENANT_TABLES: readonly TenantTableSpec[] = [
  // ── governance + directory-adjacent ─────────────────────────────────────
  { name: 'tenant_membership', exportSql: `SELECT * FROM tenant_membership WHERE tenant_id = $1 ORDER BY user_id`, exitRank: 90 },
  { name: 'role_assignment', exportSql: `SELECT * FROM role_assignment WHERE tenant_id = $1 ORDER BY user_id, role`, exitRank: 89 },
  { name: 'business_id_counter', exportSql: `SELECT * FROM business_id_counter WHERE tenant_id = $1 ORDER BY kind`, exitRank: 80 },
  { name: 'approval', exportSql: `SELECT * FROM approval WHERE tenant_id = $1 ORDER BY approval_id`, exitRank: 70 },
  // M-06: the revise-intent outbox. Holds validated submit payloads (PII) — registered
  // here so the exit ceremony erases it + asserts it zero (nothing FKs to it, so it can
  // delete early). Only tenant(id) is referenced; timestamptz columns need no ::text cast.
  { name: 'approval_revision', exportSql: `SELECT * FROM approval_revision WHERE tenant_id = $1 ORDER BY id`, exitRank: 3 },
  { name: 'approval_event', exportSql: `SELECT * FROM approval_event WHERE tenant_id = $1 ORDER BY at, id`, exitRank: 5 },
  { name: 'audit_event', exportSql: `SELECT * FROM audit_event WHERE tenant_id = $1 ORDER BY at, id`, exitRank: 4 },
  // Comms P2 (0088): the reusable per-tenant module entitlement kernel. Tenant-scoped
  // (erased on exit); only tenant(id) is referenced. The event log is append-only and its
  // trigger is registered in exitTenant's APPEND_ONLY_TRIGGERS so the ceremony can erase it.
  // All timestamptz — no ::text cast needed. No FK between the two, so relative rank is free.
  { name: 'tenant_module_entitlement', exportSql: `SELECT * FROM tenant_module_entitlement WHERE tenant_id = $1 ORDER BY module_key`, exitRank: 7 },
  { name: 'tenant_module_entitlement_event', exportSql: `SELECT * FROM tenant_module_entitlement_event WHERE tenant_id = $1 ORDER BY at, id`, exitRank: 6 },
  // ── people + person-adjacent ─────────────────────────────────────────────
  {
    // M-16: date_of_birth / date_of_joining cast ::text (the date-as-text law) —
    // SELECT * would export raw DATE, which node-pg parses at LOCAL midnight and
    // can shift a day across timezones on round-trip.
    name: 'person',
    exportSql: `SELECT id, tenant_id, person_id, full_name, ign, nationality, primary_role, personnel_code,
                       current_team, current_game_title, primary_department, entity_id, notes, first_name, last_name,
                       date_of_birth::text AS date_of_birth, address_line1, address_line2, address_city, address_country,
                       phone, email, date_of_joining::text AS date_of_joining, position, other_nationalities,
                       photo_storage_key, photo_content_type, photo_sha256, photo_updated_at,
                       is_active, created_by_approval_id, version, created_at, updated_at
                  FROM person WHERE tenant_id = $1 ORDER BY person_id`,
    exitRank: 60,
  },
  {
    name: 'credential',
    exportSql: `SELECT id, tenant_id, credential_id, person_id, credential_type, kind, issuer,
                       document_number, issuing_country,
                       issued_on::text AS issued_on, expires_on::text AS expires_on,
                       notes, is_active, created_by_approval_id, version, created_at, updated_at
                  FROM credential WHERE tenant_id = $1 ORDER BY credential_id`,
    exitRank: 20,
  },
  {
    name: 'journey',
    exportSql: `SELECT id, tenant_id, journey_id, person_id, journey_type, title,
                       started_on::text AS started_on, ended_on::text AS ended_on,
                       status, notes, created_by_approval_id, version, created_at, updated_at
                  FROM journey WHERE tenant_id = $1 ORDER BY journey_id`,
    exitRank: 21,
  },
  { name: 'kit', exportSql: `SELECT * FROM kit WHERE tenant_id = $1 ORDER BY kit_id`, exitRank: 22 },
  { name: 'apparel', exportSql: `SELECT * FROM apparel WHERE tenant_id = $1 ORDER BY apparel_id`, exitRank: 23 },

  // ── org structure + finance reference ────────────────────────────────────
  { name: 'entity', exportSql: `SELECT * FROM entity WHERE tenant_id = $1 ORDER BY entity_id`, exitRank: 65 },
  { name: 'fx_rate', exportSql: `SELECT * FROM fx_rate WHERE tenant_id = $1 ORDER BY currency`, exitRank: 10 },
  { name: 'team', exportSql: `SELECT * FROM team WHERE tenant_id = $1 ORDER BY team_id`, exitRank: 45 },
  { name: 'team_membership', exportSql: `SELECT * FROM team_membership WHERE tenant_id = $1 ORDER BY team_id, person_id`, exitRank: 15 },

  // ── missions + finance ───────────────────────────────────────────────────
  {
    // H-03 repair: the projection was five columns behind the live schema —
    // code, organizer, city, finance_stage, team_id now export.
    name: 'mission',
    exportSql: `SELECT id, tenant_id, mission_id, name, code, organizer, city, game_title, team_id,
                       starts_on::text AS starts_on, ends_on::text AS ends_on,
                       finance_stage, notes, is_active, version, created_at, updated_at
                  FROM mission WHERE tenant_id = $1 ORDER BY mission_id`,
    exitRank: 40,
  },
  {
    name: 'agreement',
    exportSql: `SELECT id, tenant_id, agreement_id, person_id, entity_id, agreement_code, agreement_type,
                       linked_agreement_id, starts_on::text AS starts_on, ends_on::text AS ends_on,
                       value_usd_cents, notes, status, created_by_approval_id, version, created_at, updated_at
                  FROM agreement WHERE tenant_id = $1 ORDER BY agreement_id`,
    exitRank: 30,
  },
  { name: 'agreement_term', exportSql: `SELECT * FROM agreement_term WHERE tenant_id = $1 ORDER BY term_id`, exitRank: 25 },
  { name: 'mission_line', exportSql: `SELECT * FROM mission_line WHERE tenant_id = $1 ORDER BY line_id`, exitRank: 35 },
  { name: 'mission_budget', exportSql: `SELECT * FROM mission_budget WHERE tenant_id = $1 ORDER BY mission_id, direction, category, currency`, exitRank: 34 },
  { name: 'mission_participant', exportSql: `SELECT * FROM mission_participant WHERE tenant_id = $1 ORDER BY mission_id, person_id`, exitRank: 33 },
  {
    name: 'invoice',
    exportSql: `SELECT id, tenant_id, invoice_id, invoice_number, mission_id, entity_id, line_id,
                       billed_to_name, billed_to_details, income_category, description, currency,
                       subtotal_minor, vat_rate_bps, vat_minor, total_minor, status,
                       issued_on::text AS issued_on, issued_by, voided_reason, document_id,
                       version, created_at, updated_at
                  FROM invoice WHERE tenant_id = $1 ORDER BY invoice_id`,
    exitRank: 32,
  },
  { name: 'distribution', exportSql: `SELECT * FROM distribution WHERE tenant_id = $1 ORDER BY distribution_id`, exitRank: 31 },
  {
    // M-16: paid_on cast ::text (date-as-text law).
    name: 'distribution_share',
    exportSql: `SELECT id, tenant_id, distribution_id, person_id, share_bps, amount_minor, payout_status,
                       paid_on::text AS paid_on, payment_source_label, ref_no, version, created_at, updated_at
                  FROM distribution_share WHERE tenant_id = $1 ORDER BY distribution_id, person_id`,
    exitRank: 14,
  },
  {
    name: 'claim',
    exportSql: `SELECT id, tenant_id, claim_id, submitted_by, person_id, mission_id, category, description,
                       amount_minor, currency, expense_on::text AS expense_on, status, reviewed_by,
                       rejection_reason, paid_on::text AS paid_on, payment_source_label, ref_no,
                       version, created_at, updated_at
                  FROM claim WHERE tenant_id = $1 ORDER BY claim_id`,
    exitRank: 24,
  },

  // ── documents + delivery + delegation ────────────────────────────────────
  {
    // Rows only: the object BYTES live in storage. The export manifest lists
    // every storage_key so the blob bundle is enumerable; streamed object
    // export + exit-time object deletion are the HARDEN-1 follow-up.
    // H-10: `invoice.document_id → document` makes document a PARENT of invoice
    // (rank 32), so document must delete AFTER it — rank 50 (was 12, which
    // deleted document first and rolled the exit back for any tenant with an
    // invoice PDF). The FK-order catalog test guards this.
    name: 'document',
    exportSql: `SELECT * FROM document WHERE tenant_id = $1 ORDER BY document_id`,
    exitRank: 50,
  },
  {
    // S12: payment-ROUTING names only — no account numbers exist to export.
    name: 'beneficiary',
    exportSql: `SELECT id, tenant_id, beneficiary_id, person_id, freelancer_id, vendor_id, label, bank_name, bank_country,
                       currency, payment_type, registered_with_entity_id, status,
                       status_date::text AS status_date, notes, created_by_approval_id,
                       version, created_at, updated_at
                  FROM beneficiary WHERE tenant_id = $1 ORDER BY beneficiary_id`,
    exitRank: 26,
  },
  { name: 'notification', exportSql: `SELECT * FROM notification WHERE tenant_id = $1 ORDER BY emitted_at, id`, exitRank: 11 },
  // HARDEN-2 (0037): the settings kernel — per-diem presets et al.
  { name: 'tenant_setting', exportSql: `SELECT * FROM tenant_setting WHERE tenant_id = $1 ORDER BY key`, exitRank: 6 },
  // Track B4 (0039): contextual comments (append-only).
  { name: 'comment', exportSql: `SELECT * FROM comment WHERE tenant_id = $1 ORDER BY created_at, id`, exitRank: 7 },
  // Track B6 (0040): guest intake — the capability link (parent) then the
  // sandbox submission (child; exits first, before its link FK).
  { name: 'intake_link', exportSql: `SELECT * FROM intake_link WHERE tenant_id = $1 ORDER BY created_at, id`, exitRank: 9 },
  { name: 'intake_submission', exportSql: `SELECT * FROM intake_submission WHERE tenant_id = $1 ORDER BY submitted_at, id`, exitRank: 8 },
  // HARDEN-3.3 (0069, R4-N01): transient in-flight upload leases. The exit's drain waits for
  // LIVE leases to hit zero before the data phase; the erasure here only removes expired
  // stragglers (dead requests). No FK to intake_link (token_hash text), so rank is free.
  { name: 'intake_upload_lease', exportSql: `SELECT * FROM intake_upload_lease WHERE tenant_id = $1 ORDER BY acquired_at, id`, exitRank: 8 },
  // Track B (0041): recurring subscriptions — an independent leaf register.
  {
    name: 'subscription',
    exportSql: `SELECT id, tenant_id, subscription_id, name, vendor_name, amount_minor, currency, cadence, category, status,
                       started_on::text AS started_on, next_renewal_on::text AS next_renewal_on,
                       notes, version, created_at, updated_at
                  FROM subscription WHERE tenant_id = $1 ORDER BY subscription_id`,
    exitRank: 3,
  },
  // Track B (0042): departures — child of person (composite FK), exits first.
  {
    name: 'departure',
    exportSql: `SELECT id, tenant_id, departure_id, person_id, reason, status, initiated_by,
                       initiated_on::text AS initiated_on, completed_on::text AS completed_on,
                       notes, version, created_at, updated_at
                  FROM departure WHERE tenant_id = $1 ORDER BY departure_id`,
    exitRank: 2,
  },
  {
    name: 'delegation',
    exportSql: `SELECT id, tenant_id, delegation_id, grantee_identity, granted_by,
                       starts_on::text AS starts_on, ends_on::text AS ends_on,
                       reason, revoked_at, revoked_by, revoke_reason, version, created_at, updated_at
                  FROM delegation WHERE tenant_id = $1 ORDER BY delegation_id`,
    exitRank: 13,
  },
  // Track B (0044): saved views — an independent per-user leaf (state = jsonb).
  {
    name: 'saved_view',
    exportSql: `SELECT id, tenant_id, user_identity, register, name, state, is_active, version, created_at, updated_at
                  FROM saved_view WHERE tenant_id = $1 ORDER BY id`,
    exitRank: 1,
  },

  // ── Comms (0090–0093) ────────────────────────────────────────────────────
  // REGISTRY ORDER (export = parents before children): the whole Comms block
  // sits at the END so every FK parent — tenant, document (evidence/attachment),
  // and the in-block parents — exports first; within the block, parents precede
  // children. exitRank drives the OPPOSITE (deletion, children-first) order.
  // All timestamptz — no ::text cast. Append-only triggers are registered in
  // exitTenant's APPEND_ONLY_TRIGGERS.
  // 0090 — the thread layer: rooms + append-only history + membership.
  { name: 'comms_thread', exportSql: `SELECT * FROM comms_thread WHERE tenant_id = $1 ORDER BY thread_id`, exitRank: 30 },
  { name: 'comms_thread_event', exportSql: `SELECT * FROM comms_thread_event WHERE tenant_id = $1 ORDER BY at, id`, exitRank: 11 },
  { name: 'comms_thread_participant', exportSql: `SELECT * FROM comms_thread_participant WHERE tenant_id = $1 ORDER BY thread_id, user_id`, exitRank: 12 },
  // 0091 — the message family (event-sourced: revisions/tombstones/reactions).
  // retention_tombstone (14) deliberately has NO message FK (outlives the purged DM).
  { name: 'comms_message', exportSql: `SELECT * FROM comms_message WHERE tenant_id = $1 ORDER BY message_id`, exitRank: 20 },
  { name: 'comms_message_revision', exportSql: `SELECT * FROM comms_message_revision WHERE tenant_id = $1 ORDER BY message_id, revision_no`, exitRank: 15 },
  { name: 'comms_message_tombstone', exportSql: `SELECT * FROM comms_message_tombstone WHERE tenant_id = $1 ORDER BY message_id`, exitRank: 15 },
  { name: 'comms_reaction_event', exportSql: `SELECT * FROM comms_reaction_event WHERE tenant_id = $1 ORDER BY at, id`, exitRank: 15 },
  { name: 'comms_document_attachment', exportSql: `SELECT * FROM comms_document_attachment WHERE tenant_id = $1 ORDER BY document_id`, exitRank: 15 },
  { name: 'comms_retention_tombstone', exportSql: `SELECT * FROM comms_retention_tombstone WHERE tenant_id = $1 ORDER BY message_id`, exitRank: 14 },
  { name: 'comms_mention', exportSql: `SELECT * FROM comms_mention WHERE tenant_id = $1 ORDER BY revision_id, target_user_id`, exitRank: 13 },
  { name: 'comms_object_link', exportSql: `SELECT * FROM comms_object_link WHERE tenant_id = $1 ORDER BY revision_id, target_type, target_id`, exitRank: 13 },
  // 0092 — the obligation family. The obligation's source-message ref is a
  // BUSINESS ID (not an FK — survives DM expiry); evidence_delivery FKs document.
  { name: 'comms_obligation', exportSql: `SELECT * FROM comms_obligation WHERE tenant_id = $1 ORDER BY obligation_id`, exitRank: 18 },
  { name: 'comms_obligation_event', exportSql: `SELECT * FROM comms_obligation_event WHERE tenant_id = $1 ORDER BY at, id`, exitRank: 10 },
  { name: 'comms_obligation_link', exportSql: `SELECT * FROM comms_obligation_link WHERE tenant_id = $1 ORDER BY obligation_id, target_type, target_id`, exitRank: 10 },
  { name: 'comms_evidence_delivery', exportSql: `SELECT * FROM comms_evidence_delivery WHERE tenant_id = $1 ORDER BY obligation_id, document_id`, exitRank: 10 },
  // 0093 — the delivery substrate. nudge/outbox/attention reference their
  // sources by BUSINESS ID (no FK) — delivery mechanics never pin the records.
  { name: 'comms_nudge_policy', exportSql: `SELECT * FROM comms_nudge_policy WHERE tenant_id = $1 ORDER BY policy_key, version`, exitRank: 17 },
  { name: 'comms_nudge_policy_stage', exportSql: `SELECT * FROM comms_nudge_policy_stage WHERE tenant_id = $1 ORDER BY policy_id, stage_no`, exitRank: 16 },
  { name: 'comms_nudge', exportSql: `SELECT * FROM comms_nudge WHERE tenant_id = $1 ORDER BY nudge_id`, exitRank: 9 },
  { name: 'comms_delivery_outbox', exportSql: `SELECT * FROM comms_delivery_outbox WHERE tenant_id = $1 ORDER BY source_kind, source_id, recipient_user_id, channel`, exitRank: 9 },
  { name: 'comms_attention', exportSql: `SELECT * FROM comms_attention WHERE tenant_id = $1 ORDER BY recipient_user_id, source_kind, source_id`, exitRank: 9 },
  // 0094 — preferences + the private read cursor (receipts DERIVE from it; no
  // read_receipt table by design), dormant presence, and access requests.
  // inbox_cursor FKs comms_thread (12 < 30, the participant-sibling shape); the
  // other three are tenant-only.
  { name: 'comms_user_preference', exportSql: `SELECT * FROM comms_user_preference WHERE tenant_id = $1 ORDER BY user_id`, exitRank: 8 },
  { name: 'comms_inbox_cursor', exportSql: `SELECT * FROM comms_inbox_cursor WHERE tenant_id = $1 ORDER BY thread_id, user_id`, exitRank: 12 },
  { name: 'comms_presence', exportSql: `SELECT * FROM comms_presence WHERE tenant_id = $1 ORDER BY user_id`, exitRank: 8 },
  { name: 'comms_access_request', exportSql: `SELECT * FROM comms_access_request WHERE tenant_id = $1 ORDER BY created_at, id`, exitRank: 8 },
];

/** Exit deletion order: children before parents, deterministic. */
export function tenantTablesInExitOrder(): readonly string[] {
  return [...TENANT_TABLES].sort((a, b) => a.exitRank - b.exitRank).map((t) => t.name);
}
