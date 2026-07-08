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
  createdByApprovalId: text('created_by_approval_id').notNull(),
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
  createdByApprovalId: text('created_by_approval_id').notNull(),
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
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mission = pgTable('mission', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  missionId: text('mission_id').notNull(),
  name: text('name').notNull(),
  gameTitle: text('game_title'),
  // mode 'string' — the Credentials date discipline (never driver-parsed).
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  endsOn: date('ends_on', { mode: 'string' }),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
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
