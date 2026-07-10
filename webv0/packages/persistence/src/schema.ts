/**
 * schema.ts — Drizzle ORM table definitions mirroring migrations/0001_schema.sql.
 *
 * The SQL migrations are the source of truth for DDL (RLS, triggers, grants,
 * roles — things Drizzle-kit cannot express). This Drizzle schema is the typed
 * query surface used by the repositories.
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  timestamp,
  date,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const appUser = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantMembership = pgTable(
  'tenant_membership',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.userId] }) }),
);

export const roleAssignment = pgTable(
  'role_assignment',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.userId, t.role] }) }),
);

export const businessIdCounter = pgTable(
  'business_id_counter',
  {
    tenantId: uuid('tenant_id').notNull(),
    kind: text('kind').notNull(),
    lastValue: bigint('last_value', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.kind] }) }),
);

export const approval = pgTable('approval', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  approvalId: text('approval_id').notNull(),
  operationType: text('operation_type').notNull(),
  targetPersonId: text('target_person_id').notNull(),
  targetId: text('target_id'),
  reason: text('reason'),
  status: text('status').notNull(),
  payload: jsonb('payload').notNull(),
  submittedBy: text('submitted_by').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  executionError: text('execution_error'),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const person = pgTable('person', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  personId: text('person_id').notNull(),
  fullName: text('full_name').notNull(),
  ign: text('ign'),
  nationality: text('nationality'),
  primaryRole: text('primary_role'),
  personnelCode: text('personnel_code'),
  currentTeam: text('current_team'),
  currentGameTitle: text('current_game_title'),
  primaryDepartment: text('primary_department'),
  entityId: text('entity_id'),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdByApprovalId: text('created_by_approval_id'),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const credential = pgTable('credential', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  credentialId: text('credential_id').notNull(),
  personId: text('person_id').notNull(),
  credentialType: text('credential_type').notNull(),
  issuer: text('issuer'),
  // mode 'string': plain ISO YYYY-MM-DD in and out — node-pg's default DATE →
  // JS Date parsing (local-midnight, timezone-shiftable) never runs. This is
  // the persistence half of the CP date-swap guarantee; ALL credential CRUD
  // must go through drizzle with this schema, never raw SELECT *.
  issuedOn: date('issued_on', { mode: 'string' }).notNull(),
  expiresOn: date('expires_on', { mode: 'string' }),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdByApprovalId: text('created_by_approval_id'),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const journey = pgTable('journey', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  journeyId: text('journey_id').notNull(),
  personId: text('person_id').notNull(),
  journeyType: text('journey_type').notNull(),
  title: text('title'),
  // mode 'string' — same date discipline as credential (never driver-parsed).
  startedOn: date('started_on', { mode: 'string' }).notNull(),
  endedOn: date('ended_on', { mode: 'string' }),
  status: text('status').notNull().default('Active'),
  notes: text('notes'),
  createdByApprovalId: text('created_by_approval_id'),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const kit = pgTable('kit', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  kitId: text('kit_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  size: text('size'),
  assignedPersonId: text('assigned_person_id'),
  notes: text('notes'),
  status: text('status').notNull().default('Received'),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apparel = pgTable('apparel', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  apparelId: text('apparel_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  size: text('size'),
  assignedPersonId: text('assigned_person_id'),
  notes: text('notes'),
  status: text('status').notNull().default('Received'),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agreement = pgTable('agreement', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  agreementId: text('agreement_id').notNull(),
  // Nullable since 0022: entity-level agreements have no person (anchor CHECK).
  personId: text('person_id'),
  entityId: text('entity_id'),
  agreementCode: text('agreement_code'),
  agreementType: text('agreement_type').notNull(),
  linkedAgreementId: text('linked_agreement_id'),
  // mode 'string' — the Credentials date discipline (never driver-parsed).
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  endsOn: date('ends_on', { mode: 'string' }).notNull(),
  // Integer US cents; mode number is safe (values ≪ 2^53).
  valueUsdCents: bigint('value_usd_cents', { mode: 'number' }),
  notes: text('notes'),
  status: text('status').notNull().default('Active'),
  createdByApprovalId: text('created_by_approval_id'),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agreementTerm = pgTable('agreement_term', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  termId: text('term_id').notNull(),
  agreementId: text('agreement_id').notNull(),
  kind: text('kind').notNull(),
  // Monetary kinds only; integers ≪ 2^53 so mode number is safe.
  amountMinor: bigint('amount_minor', { mode: 'number' }),
  currency: text('currency'),
  // Percent kinds only; basis points (1..10000).
  percentBps: integer('percent_bps'),
  label: text('label'),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const document = pgTable('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: text('document_id').notNull(),
  ownerType: text('owner_type').notNull(),
  ownerId: text('owner_id').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  label: text('label'),
  storageKey: text('storage_key').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const entity = pgTable('entity', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  entityId: text('entity_id').notNull(),
  name: text('name').notNull(),
  // S2 rider: short code (GKA, GKEC) — unique per tenant, feeds invoice series.
  code: text('code'),
  jurisdiction: text('jurisdiction').notNull(),
  registrationId: text('registration_id'),
  localCurrency: text('local_currency').notNull().default('USD'),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fxRate = pgTable('fx_rate', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  currency: text('currency').notNull(),
  // numeric → string in Drizzle, to preserve exactness; parsed to number at the edge.
  usdPerUnit: numeric('usd_per_unit', { precision: 18, scale: 8 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mission = pgTable('mission', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  missionId: text('mission_id').notNull(),
  name: text('name').notNull(),
  // S2: tournament code (the org's join key), organizer, city.
  code: text('code'),
  organizer: text('organizer'),
  city: text('city'),
  // S7: the game division that fielded the event (nullable; per-team P&L key).
  teamId: text('team_id'),
  gameTitle: text('game_title'),
  // mode 'string' — the Credentials date discipline (never driver-parsed).
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  endsOn: date('ends_on', { mode: 'string' }),
  notes: text('notes'),
  // S2: the financial lifecycle (legacy rows backfilled 'Active'; born 'Planning').
  financeStage: text('finance_stage').notNull().default('Planning'),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const missionLine = pgTable('mission_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  lineId: text('line_id').notNull(),
  missionId: text('mission_id').notNull(),
  direction: text('direction').notNull(),
  // S2: category from the merged taxonomy (existing rows backfilled 'Other').
  category: text('category').notNull().default('Other'),
  label: text('label').notNull(),
  // Integer minor units ≪ 2^53, so mode number is safe.
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  // S2: income payment tracking (null on expense lines — DB CHECK enforced).
  paymentStatus: text('payment_status'),
  receivedAmountMinor: bigint('received_amount_minor', { mode: 'number' }),
  // numeric → string in Drizzle (exactness); parsed to number at the mapper.
  receivedUsdPerUnit: numeric('received_usd_per_unit', { precision: 18, scale: 8 }),
  paymentSourceLabel: text('payment_source_label'),
  refNo: text('ref_no'),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const missionBudget = pgTable('mission_budget', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  missionId: text('mission_id').notNull(),
  direction: text('direction').notNull(),
  category: text('category').notNull(),
  currency: text('currency').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// S7: teams — game divisions + departments; the per-team reporting spine.
export const team = pgTable('team', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  teamId: text('team_id').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  kind: text('kind').notNull(),
  gameTitle: text('game_title'),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembership = pgTable('team_membership', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  teamId: text('team_id').notNull(),
  personId: text('person_id').notNull(),
  role: text('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// S6: invoices — the outward claim for a mission income line. Numbers are a
// per-entity, per-year series and are never reused (voids leave gaps).
export const invoice = pgTable('invoice', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  invoiceId: text('invoice_id').notNull(),
  invoiceNumber: text('invoice_number').notNull(),
  entityId: text('entity_id').notNull(),
  missionId: text('mission_id').notNull(),
  lineId: text('line_id').notNull(),
  billedToName: text('billed_to_name').notNull(),
  billedToDetails: text('billed_to_details'),
  incomeCategory: text('income_category').notNull(),
  description: text('description'),
  currency: text('currency').notNull(),
  subtotalMinor: bigint('subtotal_minor', { mode: 'number' }).notNull(),
  vatRateBps: integer('vat_rate_bps').notNull(),
  vatMinor: bigint('vat_minor', { mode: 'number' }).notNull(),
  totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
  status: text('status').notNull(),
  issuedOn: date('issued_on', { mode: 'string' }).notNull(),
  issuedBy: text('issued_by').notNull(),
  voidedReason: text('voided_reason'),
  documentId: text('document_id'),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const missionParticipant = pgTable('mission_participant', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  missionId: text('mission_id').notNull(),
  personId: text('person_id').notNull(),
  role: text('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  perDiemAmountMinor: bigint('per_diem_amount_minor', { mode: 'number' }),
  perDiemCurrency: text('per_diem_currency'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const approvalEvent = pgTable('approval_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  approvalId: text('approval_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actor: text('actor').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  note: text('note'),
});

export const auditEvent = pgTable('audit_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  before: jsonb('before'),
  after: jsonb('after'),
});
