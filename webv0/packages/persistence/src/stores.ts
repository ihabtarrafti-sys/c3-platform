/**
 * stores.ts — concrete ReadStore / WriteStore over a pg Pool (as the c3_app
 * role). Implements the @c3web/application Persistence port.
 */
import { Pool } from 'pg';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Actor, Agreement, AgreementTerm, Apparel, Approval, ApprovalEvent, ApprovalRevision, ApprovalStatus, AuditEvent, Credential, Entity, FxRate, Invoice, Journey, RecycleItem, Comment, IntakeLink, IntakeSubmission, Subscription, SavedView, Departure, Team, TeamMembership, Distribution, DistributionShare, Claim, C3Notification, Delegation, Beneficiary, Kit, Member, Mission, C3Document, MissionBudget, MissionLine, MissionParticipant, Person, CommsMessageView, CommsLinkTargetType, CommsObligationView } from '@c3web/domain';
import { IntakeLinkUnavailableError } from '@c3web/domain';
import type { GuestIntakePort, GuestIntakePeek, NewGuestSubmission, PayableClaimRow, Persistence, PersonMissionMembership, ReadStore, TenantSearchRow, TenantSearchSpec, WriteStore, WriteTransactionOptions, WriteTx } from '@c3web/application';
import * as schema from './schema';
import { withTenantTx, type Db } from './tenantContext';
import { makeWriteTx } from './writeTx';
import { buildSearchQuery } from './searchSql';
import { buildRecycleQuery } from './recycleSql';
import { mapAgreement, mapAgreementTerm, mapApparel, mapApproval, mapApprovalEvent, mapAuditEvent, mapCredential, mapDocument, mapEntity, mapFxRate, mapInvoice, mapTeam, mapTeamMembership, mapDistribution, mapDistributionShare, mapClaim, mapComment, mapIntakeLink, mapIntakeSubmission, mapSubscription, mapDeparture,
  mapDelegation, mapBeneficiary, mapJourney, mapKit, mapMission, mapMissionBudget, mapMissionLine, mapMissionParticipant, mapPerson, mapSavedView, mapApprovalRevision, mapModuleEntitlement, mapCommsThread } from './mappers';

// ── Comms read helpers: the spine joined with its LATEST revision, then the
// page's links + attachments hydrated in two bounded child fetches. ──────────
interface CommsSpineRow {
  message_id: string;
  thread_id: string;
  seq: string | number;
  author_user_id: string;
  author_label: string | null;
  created_at: Date | string;
  revision_id: string;
  revision_no: number;
  body: string;
}

const commsMessageViewSql = (where: ReturnType<typeof sql>, limit: number) => sql`
  SELECT m.message_id, m.thread_id, m.seq, m.author_user_id, m.author_label, m.created_at,
         r.id AS revision_id, r.revision_no, r.body
    FROM comms_message m
    JOIN LATERAL (
      SELECT id, revision_no, body
        FROM comms_message_revision rr
       WHERE rr.tenant_id = m.tenant_id AND rr.message_id = m.message_id
       ORDER BY rr.revision_no DESC
       LIMIT 1
    ) r ON true
   WHERE ${where}
   ORDER BY m.seq DESC
   LIMIT ${limit}
`;

async function hydrateCommsMessageViews(db: Db, rows: CommsSpineRow[]): Promise<CommsMessageView[]> {
  if (rows.length === 0) return [];
  const revisionIds = rows.map((r) => r.revision_id);
  const messageIds = rows.map((r) => r.message_id);
  const linkRes = await db.execute(sql`
    SELECT revision_id, target_type, target_id FROM comms_object_link
     WHERE revision_id IN (${sql.join(revisionIds.map((id) => sql`${id}`), sql`, `)}) ORDER BY created_at, id
  `);
  const attRes = await db.execute(sql`
    SELECT a.message_id, a.document_id, d.file_name, d.content_type, d.size_bytes
      FROM comms_document_attachment a
      JOIN document d ON d.tenant_id = a.tenant_id AND d.document_id = a.document_id AND d.is_active = true
     WHERE a.message_id IN (${sql.join(messageIds.map((id) => sql`${id}`), sql`, `)}) ORDER BY a.created_at, a.id
  `);
  const linksByRevision = new Map<string, { targetType: CommsLinkTargetType; targetId: string }[]>();
  for (const l of linkRes.rows as Array<{ revision_id: string; target_type: CommsLinkTargetType; target_id: string }>) {
    const arr = linksByRevision.get(l.revision_id) ?? [];
    arr.push({ targetType: l.target_type, targetId: l.target_id });
    linksByRevision.set(l.revision_id, arr);
  }
  const attByMessage = new Map<string, { documentId: string; fileName: string; contentType: string; sizeBytes: number }[]>();
  for (const a of attRes.rows as Array<{ message_id: string; document_id: string; file_name: string; content_type: string; size_bytes: string | number }>) {
    const arr = attByMessage.get(a.message_id) ?? [];
    arr.push({ documentId: a.document_id, fileName: a.file_name, contentType: a.content_type, sizeBytes: Number(a.size_bytes) });
    attByMessage.set(a.message_id, arr);
  }
  return rows.map((r) => ({
    messageId: r.message_id,
    threadId: r.thread_id,
    seq: Number(r.seq),
    authorUserId: r.author_user_id,
    authorLabel: r.author_label,
    body: r.body,
    revisionNo: r.revision_no,
    links: linksByRevision.get(r.revision_id) ?? [],
    attachments: attByMessage.get(r.message_id) ?? [],
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
  }));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const isoStr = (v: any): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/** Row(s) → full obligation views (events + document-joined evidence hydrated).
 *  Dual-case tolerant: drizzle camelCase and raw snake_case rows both feed it. */
async function hydrateCommsObligationViews(db: Db, rows: any[]): Promise<CommsObligationView[]> {
  if (rows.length === 0) return [];
  const ids: string[] = rows.map((r) => r.obligationId ?? r.obligation_id);
  const inIds = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const evRes = await db.execute(sql`
    SELECT obligation_id, event_type, from_state, to_state, actor_user_id, actor_label, reason, attestation, at
      FROM comms_obligation_event WHERE obligation_id IN (${inIds}) ORDER BY at, id
  `);
  const evdRes = await db.execute(sql`
    SELECT e.obligation_id, e.document_id, e.delivered_by_user_id, e.deliverer_label, e.note, e.delivered_at,
           d.file_name, d.content_type, d.size_bytes
      FROM comms_evidence_delivery e
      JOIN document d ON d.tenant_id = e.tenant_id AND d.document_id = e.document_id AND d.is_active = true
     WHERE e.obligation_id IN (${inIds}) ORDER BY e.delivered_at, e.id
  `);
  const eventsBy = new Map<string, CommsObligationView['events']>();
  for (const e of evRes.rows as any[]) {
    const arr = eventsBy.get(e.obligation_id) ?? [];
    arr.push({
      eventType: e.event_type,
      fromState: e.from_state ?? null,
      toState: e.to_state,
      actorUserId: e.actor_user_id,
      actorLabel: e.actor_label ?? null,
      reason: e.reason ?? null,
      attestation: e.attestation ?? null,
      at: isoStr(e.at),
    });
    eventsBy.set(e.obligation_id, arr);
  }
  const evidenceBy = new Map<string, CommsObligationView['evidence']>();
  for (const v of evdRes.rows as any[]) {
    const arr = evidenceBy.get(v.obligation_id) ?? [];
    arr.push({
      documentId: v.document_id,
      fileName: v.file_name,
      contentType: v.content_type,
      sizeBytes: Number(v.size_bytes),
      deliveredByUserId: v.delivered_by_user_id,
      delivererLabel: v.deliverer_label ?? null,
      note: v.note ?? null,
      deliveredAt: isoStr(v.delivered_at),
    });
    evidenceBy.set(v.obligation_id, arr);
  }
  return rows.map((r) => {
    const obligationId: string = r.obligationId ?? r.obligation_id;
    return {
      obligationId,
      threadId: r.threadId ?? r.thread_id,
      state: r.state,
      description: r.description,
      accountableUserId: r.accountableUserId ?? r.accountable_user_id,
      requesterUserId: r.requesterUserId ?? r.requester_user_id,
      beneficiaryKind: r.beneficiaryKind ?? r.beneficiary_kind,
      beneficiaryUserId: r.beneficiaryUserId ?? r.beneficiary_user_id ?? null,
      beneficiaryLabel: r.beneficiaryLabel ?? r.beneficiary_label ?? null,
      acceptanceKind: r.acceptanceKind ?? r.acceptance_kind,
      acceptanceUserId: r.acceptanceUserId ?? r.acceptance_user_id,
      acceptanceLabel: r.acceptanceLabel ?? r.acceptance_label ?? null,
      dueAt: isoStr(r.dueAt ?? r.due_at),
      evidenceRequirement: r.evidenceRequirement ?? r.evidence_requirement,
      version: Number(r.version),
      createdAt: isoStr(r.createdAt ?? r.created_at),
      events: eventsBy.get(obligationId) ?? [],
      evidence: evidenceBy.get(obligationId) ?? [],
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface PersistenceConfig {
  /** Connection string for the least-privileged application role (c3_app). */
  readonly appConnectionString: string;
  /** Optional pool tuning. */
  readonly max?: number;
  /**
   * HARDEN-3.7 U4: maximum wait for a new connection or a saturated-pool checkout.
   * Production defaults to 10s, below the API's supported 30s minimum request deadline.
   */
  readonly poolCheckoutTimeoutMs?: number;
  /**
   * TEST-ONLY: force write transactions to a stricter isolation level. Production runs at
   * READ COMMITTED (the default). A test sets 'REPEATABLE READ' to reproduce the composed
   * revoke/pay serialization race (R5-N06) — under RR the head write-conflict surfaces as a
   * Drizzle-wrapped 40001 that the use case's own withSerializationRetry must converge.
   */
  readonly writeIsolation?: 'REPEATABLE READ';
}

export interface PersistenceHandle extends Persistence {
  readonly pool: Pool;
  close(): Promise<void>;
}

export function createPersistence(config: PersistenceConfig): PersistenceHandle {
  const poolCheckoutTimeoutMs = config.poolCheckoutTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(poolCheckoutTimeoutMs) || poolCheckoutTimeoutMs <= 0) {
    throw new Error('poolCheckoutTimeoutMs must be a positive safe integer.');
  }
  // Force UTF-8 at connection startup (avoids a racing per-connection SET, and
  // guards against a client locale defaulting to WIN1252 on Windows).
  const pool = new Pool({
    connectionString: config.appConnectionString,
    max: config.max ?? 10,
    connectionTimeoutMillis: poolCheckoutTimeoutMs,
    options: '-c client_encoding=UTF8',
  });

  const reads = {
    forActor(actor: Actor): ReadStore {
      // L-05b: every read is written against an executor. The per-call path
      // gives each read its own tenant tx (unchanged behavior); batch() serves
      // every read in the callback from ONE coherent REPEATABLE READ READ ONLY
      // tenant tx — identical queries, one snapshot, a fraction of the round
      // trips. The queries below exist exactly once, shared by both paths.
      type ReadExec = <T>(q: (db: Db) => Promise<T>) => Promise<T>;
      const build = (exec: ReadExec, batch: ReadStore['batch']): ReadStore => ({
        batch,
        listPeople: () =>
          exec(async (db): Promise<Person[]> => {
            const rows = await db.select().from(schema.person).orderBy(asc(schema.person.personId));
            return rows.map(mapPerson);
          }),

        getPersonById: (personId: string) =>
          exec(async (db): Promise<Person | null> => {
            const rows = await db.select().from(schema.person).where(eq(schema.person.personId, personId)).limit(1);
            return rows[0] ? mapPerson(rows[0]) : null;
          }),

        listApprovals: (filter?: { statuses?: ApprovalStatus[] }) =>
          exec(async (db): Promise<Approval[]> => {
            const base = db.select().from(schema.approval);
            const rows = filter?.statuses?.length
              ? await base.where(inArray(schema.approval.status, filter.statuses)).orderBy(desc(schema.approval.approvalId))
              : await base.orderBy(desc(schema.approval.approvalId));
            return rows.map(mapApproval);
          }),

        getApprovalById: (approvalId: string) =>
          exec(async (db): Promise<Approval | null> => {
            const rows = await db
              .select()
              .from(schema.approval)
              .where(eq(schema.approval.approvalId, approvalId))
              .limit(1);
            return rows[0] ? mapApproval(rows[0]) : null;
          }),

        listApprovalEvents: (approvalId: string) =>
          exec(async (db): Promise<ApprovalEvent[]> => {
            const rows = await db
              .select()
              .from(schema.approvalEvent)
              .where(eq(schema.approvalEvent.approvalId, approvalId))
              .orderBy(asc(schema.approvalEvent.at));
            return rows.map(mapApprovalEvent);
          }),

        // S5: the whole tenant audit stream (the audit-trail export), oldest first.
        listAllAuditEvents: () =>
          exec(async (db): Promise<AuditEvent[]> => {
            const rows = await db.select().from(schema.auditEvent).orderBy(asc(schema.auditEvent.at));
            return rows.map(mapAuditEvent);
          }),

        listAuditEventsForEntity: (entityType: string, entityId: string) =>
          exec(async (db): Promise<AuditEvent[]> => {
            const rows = await db
              .select()
              .from(schema.auditEvent)
              .where(and(eq(schema.auditEvent.entityType, entityType), eq(schema.auditEvent.entityId, entityId)))
              .orderBy(asc(schema.auditEvent.at));
            return rows.map(mapAuditEvent);
          }),

        // Sprint 36: credentials — drizzle-only reads (mode:'string' dates).
        listCredentials: () =>
          exec(async (db): Promise<Credential[]> => {
            const rows = await db.select().from(schema.credential).orderBy(asc(schema.credential.credentialId));
            return rows.map(mapCredential);
          }),

        listCredentialsForPerson: (personId: string) =>
          exec(async (db): Promise<Credential[]> => {
            const rows = await db
              .select()
              .from(schema.credential)
              .where(eq(schema.credential.personId, personId))
              .orderBy(asc(schema.credential.credentialId));
            return rows.map(mapCredential);
          }),

        getCredentialById: (credentialId: string) =>
          exec(async (db): Promise<Credential | null> => {
            const rows = await db
              .select()
              .from(schema.credential)
              .where(eq(schema.credential.credentialId, credentialId))
              .limit(1);
            return rows[0] ? mapCredential(rows[0]) : null;
          }),

        // Sprint 37: journeys — drizzle-only reads (mode:'string' dates).
        listJourneys: () =>
          exec(async (db): Promise<Journey[]> => {
            const rows = await db.select().from(schema.journey).orderBy(asc(schema.journey.journeyId));
            return rows.map(mapJourney);
          }),

        listJourneysForPerson: (personId: string) =>
          exec(async (db): Promise<Journey[]> => {
            const rows = await db
              .select()
              .from(schema.journey)
              .where(eq(schema.journey.personId, personId))
              .orderBy(asc(schema.journey.journeyId));
            return rows.map(mapJourney);
          }),

        getJourneyById: (journeyId: string) =>
          exec(async (db): Promise<Journey | null> => {
            const rows = await db.select().from(schema.journey).where(eq(schema.journey.journeyId, journeyId)).limit(1);
            return rows[0] ? mapJourney(rows[0]) : null;
          }),

        // Sprint 38: equipment reads (drizzle-only).
        listKit: () =>
          exec(async (db): Promise<Kit[]> => {
            const rows = await db.select().from(schema.kit).orderBy(asc(schema.kit.kitId));
            return rows.map(mapKit);
          }),

        getKitById: (kitId: string) =>
          exec(async (db): Promise<Kit | null> => {
            const rows = await db.select().from(schema.kit).where(eq(schema.kit.kitId, kitId)).limit(1);
            return rows[0] ? mapKit(rows[0]) : null;
          }),

        listApparel: () =>
          exec(async (db): Promise<Apparel[]> => {
            const rows = await db.select().from(schema.apparel).orderBy(asc(schema.apparel.apparelId));
            return rows.map(mapApparel);
          }),

        getApparelById: (apparelId: string) =>
          exec(async (db): Promise<Apparel | null> => {
            const rows = await db.select().from(schema.apparel).where(eq(schema.apparel.apparelId, apparelId)).limit(1);
            return rows[0] ? mapApparel(rows[0]) : null;
          }),

        // Sprint 39: missions (shell drizzle-only; participants joined with
        // the person's display name for the register).
        listMissions: () =>
          exec(async (db): Promise<Mission[]> => {
            const rows = await db.select().from(schema.mission).orderBy(asc(schema.mission.missionId));
            return rows.map(mapMission);
          }),

        getMissionById: (missionId: string) =>
          exec(async (db): Promise<Mission | null> => {
            const rows = await db.select().from(schema.mission).where(eq(schema.mission.missionId, missionId)).limit(1);
            return rows[0] ? mapMission(rows[0]) : null;
          }),

        listMissionParticipants: (missionId: string) =>
          exec(async (db): Promise<MissionParticipant[]> => {
            const res = await db.execute(sql`
              SELECT mp.*, p.full_name AS person_name
                FROM mission_participant mp
                JOIN person p ON p.tenant_id = mp.tenant_id AND p.person_id = mp.person_id
               WHERE mp.mission_id = ${missionId}
               ORDER BY mp.person_id
            `);
            return res.rows.map(mapMissionParticipant);
          }),

        getMissionParticipant: (missionId: string, personId: string) =>
          exec(async (db): Promise<MissionParticipant | null> => {
            const res = await db.execute(sql`
              SELECT mp.*, p.full_name AS person_name
                FROM mission_participant mp
                JOIN person p ON p.tenant_id = mp.tenant_id AND p.person_id = mp.person_id
               WHERE mp.mission_id = ${missionId} AND mp.person_id = ${personId}
            `);
            const row = res.rows[0];
            return row ? mapMissionParticipant(row) : null;
          }),

        // Finance S4: the mission's ACTIVE income/expense lines, oldest first.
        listMissionLines: (missionId: string) =>
          exec(async (db): Promise<MissionLine[]> => {
            const rows = await db
              .select()
              .from(schema.missionLine)
              .where(and(eq(schema.missionLine.missionId, missionId), eq(schema.missionLine.isActive, true)))
              .orderBy(asc(schema.missionLine.createdAt), asc(schema.missionLine.lineId));
            return rows.map(mapMissionLine);
          }),

        // S2: the mission's budgets; org-wide bulk reads for the finance dashboard.
        listMissionBudgets: (missionId: string) =>
          exec(async (db): Promise<MissionBudget[]> => {
            const rows = await db
              .select()
              .from(schema.missionBudget)
              .where(eq(schema.missionBudget.missionId, missionId))
              .orderBy(asc(schema.missionBudget.direction), asc(schema.missionBudget.category), asc(schema.missionBudget.currency));
            return rows.map(mapMissionBudget);
          }),

        listAllMissionLines: () =>
          exec(async (db): Promise<MissionLine[]> => {
            const rows = await db
              .select()
              .from(schema.missionLine)
              .where(eq(schema.missionLine.isActive, true))
              .orderBy(asc(schema.missionLine.missionId), asc(schema.missionLine.lineId));
            return rows.map(mapMissionLine);
          }),

        listAllMissionBudgets: () =>
          exec(async (db): Promise<MissionBudget[]> => {
            const rows = await db.select().from(schema.missionBudget).orderBy(asc(schema.missionBudget.missionId));
            return rows.map(mapMissionBudget);
          }),

        // Sprint 41: agreements (drizzle-only; financial omission is the
        // application query layer's job, per-actor).
        listAgreements: () =>
          exec(async (db): Promise<Agreement[]> => {
            const rows = await db.select().from(schema.agreement).orderBy(asc(schema.agreement.agreementId));
            return rows.map(mapAgreement);
          }),

        listAgreementsForPerson: (personId: string) =>
          exec(async (db): Promise<Agreement[]> => {
            const rows = await db
              .select()
              .from(schema.agreement)
              .where(eq(schema.agreement.personId, personId))
              .orderBy(asc(schema.agreement.agreementId));
            return rows.map(mapAgreement);
          }),

        getAgreementById: (agreementId: string) =>
          exec(async (db): Promise<Agreement | null> => {
            const rows = await db.select().from(schema.agreement).where(eq(schema.agreement.agreementId, agreementId)).limit(1);
            return rows[0] ? mapAgreement(rows[0]) : null;
          }),

        // Finance S3: the ACTIVE financial terms of an agreement, oldest first.
        listAgreementTerms: (agreementId: string) =>
          exec(async (db): Promise<AgreementTerm[]> => {
            const rows = await db
              .select()
              .from(schema.agreementTerm)
              .where(and(eq(schema.agreementTerm.agreementId, agreementId), eq(schema.agreementTerm.isActive, true)))
              .orderBy(asc(schema.agreementTerm.createdAt), asc(schema.agreementTerm.termId));
            return rows.map(mapAgreementTerm);
          }),

        // S48: entities (the tenant's legal operating entities).
        listEntities: () =>
          exec(async (db): Promise<Entity[]> => {
            const rows = await db.select().from(schema.entity).orderBy(asc(schema.entity.entityId));
            return rows.map(mapEntity);
          }),

        getEntityById: (entityId: string) =>
          exec(async (db): Promise<Entity | null> => {
            const rows = await db.select().from(schema.entity).where(eq(schema.entity.entityId, entityId)).limit(1);
            return rows[0] ? mapEntity(rows[0]) : null;
          }),

        // S4: documents attached to an owning record (ACTIVE rows, newest first).
        listDocuments: (ownerType: string, ownerId: string) =>
          exec(async (db): Promise<C3Document[]> => {
            const rows = await db
              .select()
              .from(schema.document)
              .where(
                and(
                  eq(schema.document.ownerType, ownerType),
                  eq(schema.document.ownerId, ownerId),
                  eq(schema.document.isActive, true),
                ),
              )
              .orderBy(desc(schema.document.createdAt), desc(schema.document.documentId));
            return rows.map(mapDocument);
          }),

        // Finance S1: the tenant's editable FX rates (value of 1 unit in USD).
        listFxRates: () =>
          exec(async (db): Promise<FxRate[]> => {
            const rows = await db.select().from(schema.fxRate).orderBy(asc(schema.fxRate.currency));
            return rows.map(mapFxRate);
          }),

        // S6: invoices — the register (newest first; voided rows ride along, honestly labeled).
        listInvoices: () =>
          exec(async (db): Promise<Invoice[]> => {
            const rows = await db.select().from(schema.invoice).orderBy(desc(schema.invoice.createdAt), desc(schema.invoice.invoiceId));
            return rows.map(mapInvoice);
          }),

        getInvoiceById: (invoiceId: string) =>
          exec(async (db): Promise<Invoice | null> => {
            const rows = await db.select().from(schema.invoice).where(eq(schema.invoice.invoiceId, invoiceId)).limit(1);
            return rows[0] ? mapInvoice(rows[0]) : null;
          }),

        // S7: teams + memberships (memberships join the person's display name).
        listTeams: () =>
          exec(async (db): Promise<Team[]> => {
            const rows = await db.select().from(schema.team).orderBy(asc(schema.team.teamId));
            return rows.map(mapTeam);
          }),

        getTeamById: (teamId: string) =>
          exec(async (db): Promise<Team | null> => {
            const rows = await db.select().from(schema.team).where(eq(schema.team.teamId, teamId)).limit(1);
            return rows[0] ? mapTeam(rows[0]) : null;
          }),

        listTeamMembers: (teamId: string) =>
          exec(async (db): Promise<TeamMembership[]> => {
            const res = await db.execute(sql`
              SELECT tm.*, p.full_name AS person_name
                FROM team_membership tm
                JOIN person p ON p.tenant_id = tm.tenant_id AND p.person_id = tm.person_id
               WHERE tm.team_id = ${teamId}
               ORDER BY tm.is_active DESC, p.full_name ASC
            `);
            return res.rows.map(mapTeamMembership);
          }),

        listTeamMembershipsForPerson: (personId: string) =>
          exec(async (db): Promise<TeamMembership[]> => {
            const res = await db.execute(sql`
              SELECT tm.*, p.full_name AS person_name
                FROM team_membership tm
                JOIN person p ON p.tenant_id = tm.tenant_id AND p.person_id = tm.person_id
               WHERE tm.person_id = ${personId}
               ORDER BY tm.team_id ASC
            `);
            return res.rows.map(mapTeamMembership);
          }),

        listAllTeamMemberships: () =>
          exec(async (db) => {
            const rows = await db
              .select({
                teamId: schema.teamMembership.teamId,
                personId: schema.teamMembership.personId,
                isActive: schema.teamMembership.isActive,
              })
              .from(schema.teamMembership);
            return rows;
          }),

        // S8: distributions (shares join the person's display name).
        listDistributionsForMission: (missionId: string) =>
          exec(async (db): Promise<Distribution[]> => {
            const rows = await db
              .select()
              .from(schema.distribution)
              .where(eq(schema.distribution.missionId, missionId))
              .orderBy(desc(schema.distribution.createdAt), desc(schema.distribution.distributionId));
            return rows.map(mapDistribution);
          }),

        getDistributionById: (distributionId: string) =>
          exec(async (db): Promise<Distribution | null> => {
            const rows = await db.select().from(schema.distribution).where(eq(schema.distribution.distributionId, distributionId)).limit(1);
            return rows[0] ? mapDistribution(rows[0]) : null;
          }),

        listDistributionShares: (distributionId: string) =>
          exec(async (db): Promise<DistributionShare[]> => {
            const res = await db.execute(sql`
              SELECT ds.*, p.full_name AS person_name
                FROM distribution_share ds
                JOIN person p ON p.tenant_id = ds.tenant_id AND p.person_id = ds.person_id
               WHERE ds.distribution_id = ${distributionId}
               ORDER BY ds.amount_minor DESC, ds.person_id ASC
            `);
            return res.rows.map(mapDistributionShare);
          }),

        // M-04: one query for every share on the mission (grouped by the caller).
        listDistributionSharesForMission: (missionId: string) =>
          exec(async (db): Promise<DistributionShare[]> => {
            const res = await db.execute(sql`
              SELECT ds.*, p.full_name AS person_name
                FROM distribution_share ds
                JOIN distribution d ON d.tenant_id = ds.tenant_id AND d.distribution_id = ds.distribution_id
                JOIN person p ON p.tenant_id = ds.tenant_id AND p.person_id = ds.person_id
               WHERE d.mission_id = ${missionId}
               ORDER BY ds.distribution_id ASC, ds.amount_minor DESC, ds.person_id ASC
            `);
            return res.rows.map(mapDistributionShare);
          }),

        // M-04: the roster's PrizeSharePersonal candidates in one query.
        listPrizeShareTermsForPeople: (personIds: readonly string[]) =>
          exec(async (db): Promise<Array<{ personId: string; agreementId: string; termId: string; percentBps: number }>> => {
            if (personIds.length === 0) return [];
            const res = await db.execute(sql`
              SELECT a.person_id, t.agreement_id, t.term_id, t.percent_bps
                FROM agreement_term t
                JOIN agreement a ON a.tenant_id = t.tenant_id AND a.agreement_id = t.agreement_id
               WHERE a.person_id IN (${sql.join(personIds.map((id) => sql`${id}`), sql`, `)})
                 AND a.status = 'Active'
                 AND t.is_active
                 AND t.kind = 'PrizeSharePersonal'
                 AND t.percent_bps IS NOT NULL
               ORDER BY a.person_id ASC, t.agreement_id ASC, t.term_id ASC
            `);
            return res.rows.map((r) => {
              const row = r as Record<string, unknown>;
              return {
                personId: String(row.person_id),
                agreementId: String(row.agreement_id),
                termId: String(row.term_id),
                percentBps: Number(row.percent_bps),
              };
            });
          }),

        // S10: the actor's own inbox (newest first, capped).
        listNotifications: (identity: string, limit: number) =>
          exec(async (db): Promise<C3Notification[]> => {
            const rows = await db
              .select()
              .from(schema.notification)
              .where(eq(schema.notification.userIdentity, identity))
              .orderBy(desc(schema.notification.emittedAt))
              .limit(limit);
            return rows.map((r0) => ({
              tenantId: r0.tenantId,
              userIdentity: r0.userIdentity,
              signalKey: r0.signalKey,
              kind: r0.kind,
              title: r0.title,
              link: r0.link,
              emittedAt: r0.emittedAt.toISOString(),
              readAt: r0.readAt ? r0.readAt.toISOString() : null,
            }));
          }),

        // Tier 0.5: delegations (owner reads all; the active-check serves gates).
        listDelegations: () =>
          exec(async (db): Promise<Delegation[]> => {
            const rows = await db.select().from(schema.delegation).orderBy(desc(schema.delegation.createdAt));
            return rows.map(mapDelegation);
          }),

        findUnrevokedDelegationId: (granteeIdentity: string) =>
          exec(async (db): Promise<string | null> => {
            const res = await db.execute(sql`
              SELECT delegation_id FROM delegation
               WHERE grantee_identity = ${granteeIdentity} AND revoked_at IS NULL
               LIMIT 1
            `);
            return res.rows[0] ? String((res.rows[0] as { delegation_id: string }).delegation_id) : null;
          }),

        hasActiveDelegation: (identity: string, onDate: string) =>
          exec(async (db): Promise<boolean> => {
            const res = await db.execute(sql`
              SELECT 1 FROM delegation
               WHERE grantee_identity = ${identity} AND revoked_at IS NULL
                 AND starts_on <= ${onDate} AND ends_on >= ${onDate}
               LIMIT 1
            `);
            return res.rows.length > 0;
          }),

        // ── Comms (the Mission Comms slice) ───────────────────────────────────
        getModuleEntitlement: (moduleKey: string) =>
          exec(async (db) => {
            const rows = await db
              .select()
              .from(schema.tenantModuleEntitlement)
              .where(eq(schema.tenantModuleEntitlement.moduleKey, moduleKey))
              .limit(1);
            return rows[0] ? mapModuleEntitlement(rows[0]) : null;
          }),

        getCommsThreadByThreadId: (threadId: string) =>
          exec(async (db) => {
            const rows = await db.select().from(schema.commsThread).where(eq(schema.commsThread.threadId, threadId)).limit(1);
            return rows[0] ? mapCommsThread(rows[0]) : null;
          }),

        getCommsThreadByAnchor: (anchorType: string, anchorId: string) =>
          exec(async (db) => {
            const rows = await db
              .select()
              .from(schema.commsThread)
              .where(and(eq(schema.commsThread.kind, 'anchored'), eq(schema.commsThread.anchorType, anchorType), eq(schema.commsThread.anchorId, anchorId)))
              .limit(1);
            return rows[0] ? mapCommsThread(rows[0]) : null;
          }),

        getCommsMessageByMessageId: (messageId: string) =>
          exec(async (db) => {
            const rows = await db.select().from(schema.commsMessage).where(eq(schema.commsMessage.messageId, messageId)).limit(1);
            return rows[0] ? { messageId: rows[0].messageId, threadId: rows[0].threadId } : null;
          }),

        getCommsObligationByObligationId: (obligationId: string) =>
          exec(async (db) => {
            const rows = await db
              .select({ obligationId: schema.commsObligation.obligationId, threadId: schema.commsObligation.threadId })
              .from(schema.commsObligation)
              .where(eq(schema.commsObligation.obligationId, obligationId))
              .limit(1);
            return rows[0] ?? null;
          }),

        getCommsObligationView: (obligationId: string) =>
          exec(async (db) => {
            const rows = await db.select().from(schema.commsObligation).where(eq(schema.commsObligation.obligationId, obligationId)).limit(1);
            if (!rows[0]) return null;
            const views = await hydrateCommsObligationViews(db, rows);
            return views[0] ?? null;
          }),

        listCommsObligationsByThread: (threadId: string) =>
          exec(async (db) => {
            const rows = await db
              .select()
              .from(schema.commsObligation)
              .where(eq(schema.commsObligation.threadId, threadId))
              .orderBy(asc(schema.commsObligation.dueAt), asc(schema.commsObligation.obligationId));
            return hydrateCommsObligationViews(db, rows);
          }),

        getCommsInboxCursor: (threadId: string, userId: string) =>
          exec(async (db) => {
            const rows = await db
              .select()
              .from(schema.commsInboxCursor)
              .where(and(eq(schema.commsInboxCursor.threadId, threadId), eq(schema.commsInboxCursor.userId, userId)))
              .limit(1);
            const r = rows[0];
            return r ? { lastReadSeq: Number(r.lastReadSeq), readAt: r.readAt.toISOString() } : null;
          }),

        listDisclosedCommsReceipts: (threadId: string) =>
          exec(async (db) => {
            // THE PRIVACY CONTRACT, in one predicate (Battle #1): a member's read
            // position is disclosed IFF their receipts are enabled AND the cursor
            // moved at/after their receipts_enabled_since watermark. A missing
            // pref row = enabled since forever. Re-enabling therefore never
            // retroactively discloses reading done while receipts were off.
            const res = await db.execute(sql`
              SELECT c.user_id, c.last_read_seq, c.read_at
                FROM comms_inbox_cursor c
                LEFT JOIN comms_user_preference p
                  ON p.tenant_id = c.tenant_id AND p.user_id = c.user_id
               WHERE c.thread_id = ${threadId}
                 AND COALESCE(p.receipts_enabled, true)
                 AND (p.receipts_enabled_since IS NULL OR c.read_at >= p.receipts_enabled_since)
               ORDER BY c.last_read_seq DESC, c.user_id
            `);
            return (res.rows as Array<{ user_id: string; last_read_seq: string | number; read_at: Date | string }>).map((r) => ({
              userId: r.user_id,
              lastReadSeq: Number(r.last_read_seq),
              readAt: r.read_at instanceof Date ? r.read_at.toISOString() : new Date(r.read_at).toISOString(),
            }));
          }),

        getCommsUserPreference: (userId: string) =>
          exec(async (db) => {
            const rows = await db.select().from(schema.commsUserPreference).where(eq(schema.commsUserPreference.userId, userId)).limit(1);
            const r = rows[0];
            return r ? { receiptsEnabled: r.receiptsEnabled, presenceEnabled: r.presenceEnabled, version: r.version } : null;
          }),

        getCommsObligationByMutation: (createdByUserId: string, clientMutationId: string) =>
          exec(async (db) => {
            // Mint idempotency lives on the Created EVENT (unique per actor+mutation).
            const res = await db.execute(sql`
              SELECT o.* FROM comms_obligation o
                JOIN comms_obligation_event e
                  ON e.tenant_id = o.tenant_id AND e.obligation_id = o.obligation_id
               WHERE e.event_type = 'Created' AND e.actor_user_id = ${createdByUserId}
                 AND e.client_mutation_id = ${clientMutationId}
               LIMIT 1
            `);
            if (res.rows.length === 0) return null;
            const views = await hydrateCommsObligationViews(db, res.rows as unknown[]);
            return views[0] ?? null;
          }),

        getCommsMessageByMutation: (authorUserId: string, clientMutationId: string) =>
          exec(async (db) => {
            const res = await db.execute(commsMessageViewSql(sql`m.author_user_id = ${authorUserId} AND m.client_mutation_id = ${clientMutationId}`, 1));
            const views = await hydrateCommsMessageViews(db, res.rows as unknown as CommsSpineRow[]);
            return views[0] ?? null;
          }),

        listCommsMessages: (threadId: string, limit: number, beforeSeq: number | null) =>
          exec(async (db) => {
            const where =
              beforeSeq === null
                ? sql`m.thread_id = ${threadId}`
                : sql`m.thread_id = ${threadId} AND m.seq < ${beforeSeq}`;
            const res = await db.execute(commsMessageViewSql(where, limit));
            return hydrateCommsMessageViews(db, res.rows as unknown as CommsSpineRow[]);
          }),

        // Track B4: the comment thread on a record (oldest first).
        listCommentsForSubject: (subjectType: string, subjectId: string) =>
          exec(async (db): Promise<Comment[]> => {
            const rows = await db
              .select()
              .from(schema.comment)
              .where(and(eq(schema.comment.subjectType, subjectType), eq(schema.comment.subjectId, subjectId)))
              .orderBy(asc(schema.comment.createdAt));
            return rows.map(mapComment);
          }),

        // Track B6: the tenant's guest-intake links (newest first).
        listIntakeLinks: () =>
          exec(async (db): Promise<IntakeLink[]> => {
            const rows = await db.select().from(schema.intakeLink).orderBy(desc(schema.intakeLink.createdAt));
            return rows.map(mapIntakeLink);
          }),

        // Track B6: the sandbox — every submission, newest first (all statuses).
        listIntakeSubmissions: () =>
          exec(async (db): Promise<IntakeSubmission[]> => {
            const rows = await db.select().from(schema.intakeSubmission).orderBy(desc(schema.intakeSubmission.submittedAt));
            return rows.map(mapIntakeSubmission);
          }),

        getIntakeSubmissionById: (id: string) =>
          exec(async (db): Promise<IntakeSubmission | null> => {
            const rows = await db.select().from(schema.intakeSubmission).where(eq(schema.intakeSubmission.id, id)).limit(1);
            return rows[0] ? mapIntakeSubmission(rows[0]) : null;
          }),

        // M-02 → HARDEN-3.5 B: outstanding blob wipes for this tenant (RLS-scoped). The drain
        // consumes ONLY `armed` rows — a `prepared` intent belongs to a request that may still
        // act (R6-N01: the drain used to consume a pending intent BEFORE its PUT, then either
        // orphan the late byte or delete a byte that gained an owner). prepared rows become
        // armed only via the owner's failure path or the TTL sweep (provably-dead requests).
        listPendingIntakeRejectTombstones: () =>
          exec(async (db): Promise<Array<{ id: string; storageKey: string }>> => {
            const res = await db.execute(sql`
              SELECT id, storage_key FROM blob_tombstone
               WHERE reason IN ('intake_reject', 'intake_refused', 'compensation', 'quarantine_cleanup') AND state = 'armed'
               ORDER BY created_at
            `);
            return res.rows.map((r) => ({ id: String(r.id), storageKey: String(r.storage_key) }));
          }),

        // Track B: recurring subscriptions (newest first).
        listSubscriptions: () =>
          exec(async (db): Promise<Subscription[]> => {
            const rows = await db.select().from(schema.subscription).orderBy(desc(schema.subscription.createdAt));
            return rows.map(mapSubscription);
          }),

        // Track B: this user's ACTIVE saved views for a register (newest first).
        listSavedViews: (userIdentity: string, register: string) =>
          exec(async (db): Promise<SavedView[]> => {
            const rows = await db
              .select()
              .from(schema.savedView)
              .where(and(eq(schema.savedView.userIdentity, userIdentity), eq(schema.savedView.register, register), eq(schema.savedView.isActive, true)))
              .orderBy(desc(schema.savedView.createdAt));
            return rows.map(mapSavedView);
          }),

        // Track B: departures (all statuses, newest first).
        listDepartures: () =>
          exec(async (db): Promise<Departure[]> => {
            const rows = await db.select().from(schema.departure).orderBy(desc(schema.departure.initiatedOn), desc(schema.departure.createdAt));
            return rows.map(mapDeparture);
          }),

        // M-03: the outbox — Completed departures whose deactivation hand-off is
        // still outstanding (requested, not yet linked to an approval).
        listDeparturesAwaitingDeactivation: () =>
          exec(async (db): Promise<Departure[]> => {
            const rows = await db
              .select()
              .from(schema.departure)
              .where(and(eq(schema.departure.deactivationRequested, true), isNull(schema.departure.deactivationApprovalId)));
            return rows.map(mapDeparture);
          }),

        // M-06: the revise-intent outbox — Pending intents whose submit/link is still
        // outstanding (a crash after tx-1). The drain finishes them idempotently.
        listPendingRevisionIntents: () =>
          exec(async (db): Promise<ApprovalRevision[]> => {
            const rows = await db
              .select()
              .from(schema.approvalRevision)
              .where(eq(schema.approvalRevision.status, 'Pending'))
              .orderBy(asc(schema.approvalRevision.createdAt));
            return rows.map(mapApprovalRevision);
          }),

        // M-06: the drain's per-step idempotency probe — has tx-2 already created a
        // successor for this source? (revisionOf stamped at submit; a Withdrawn row is
        // an abandoned attempt, not the live successor.)
        findSuccessorApproval: (sourceApprovalId: string) =>
          exec(async (db): Promise<Approval | null> => {
            const rows = await db
              .select()
              .from(schema.approval)
              .where(and(eq(schema.approval.revisionOf, sourceApprovalId), ne(schema.approval.status, 'Withdrawn')))
              .limit(1);
            return rows[0] ? mapApproval(rows[0]) : null;
          }),

        // Track B3: the activity feed — a keyset page of the audit stream.
        listActivityFeed: (limit: number, before: { at: string; id: string } | null) =>
          exec(async (db): Promise<Array<{ id: string; at: string; actor: string; action: string; entityType: string; entityId: string }>> => {
            const res = await db.execute(sql`
              SELECT id, at, actor, action, entity_type, entity_id
                FROM audit_event
               ${before ? sql`WHERE (at, id) < (${before.at}::timestamptz, ${before.id}::uuid)` : sql``}
               ORDER BY at DESC, id DESC
               LIMIT ${limit}
            `);
            return res.rows.map((r) => {
              const row = r as Record<string, unknown>;
              return {
                id: String(row.id),
                at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
                actor: String(row.actor),
                action: String(row.action),
                entityType: String(row.entity_type),
                entityId: String(row.entity_id),
              };
            });
          }),

        // Track B2: the recycle bin — one UNION over the soft-delete domains.
        listRecycleBin: () =>
          exec(async (db): Promise<RecycleItem[]> => {
            const res = await db.execute(buildRecycleQuery());
            return res.rows.map((r) => {
              const row = r as Record<string, unknown>;
              return {
                kind: String(row.kind) as RecycleItem['kind'],
                id: String(row.id),
                label: String(row.label ?? row.id),
                sublabel: row.sublabel == null ? null : String(row.sublabel),
                parentId: row.parent_id == null ? null : String(row.parent_id),
                removedAt: row.removed_at instanceof Date ? row.removed_at.toISOString() : String(row.removed_at),
                removedBy: row.removed_by == null ? null : String(row.removed_by),
                version: Number(row.version ?? 0),
                restoreClass: String(row.restore_class) as RecycleItem['restoreClass'],
              };
            });
          }),

        // HARDEN-2 (0037): one settings row (null = the code-side defaults).
        getTenantSetting: (key: string) =>
          exec(async (db): Promise<{ value: unknown; version: number } | null> => {
            const rows = await db.select().from(schema.tenantSetting).where(eq(schema.tenantSetting.key, key)).limit(1);
            return rows[0] ? { value: rows[0].value, version: rows[0].version } : null;
          }),

        // S3.1 + M-04: global search — ONE ranked, per-domain-limited statement.
        searchTenant: (spec: TenantSearchSpec) =>
          exec(async (db): Promise<TenantSearchRow[]> => {
            if (spec.domains.length === 0) return [];
            const res = await db.execute(buildSearchQuery(spec));
            return res.rows.map((r) => {
              const row = r as Record<string, unknown>;
              return {
                kind: String(row.kind) as TenantSearchRow['kind'],
                id: String(row.id),
                title: String(row.title ?? row.id),
                subtitle: row.subtitle == null ? null : String(row.subtitle),
                parent_id: row.parent_id == null ? null : String(row.parent_id),
              };
            });
          }),

        // S12: the beneficiary registry (finance-gated at the usecase).
        listBeneficiaries: () =>
          exec(async (db): Promise<Beneficiary[]> => {
            const rows = await db.select().from(schema.beneficiary).orderBy(asc(schema.beneficiary.beneficiaryId));
            return rows.map(mapBeneficiary);
          }),

        listBeneficiariesForPerson: (personId: string) =>
          exec(async (db): Promise<Beneficiary[]> => {
            const rows = await db
              .select()
              .from(schema.beneficiary)
              .where(eq(schema.beneficiary.personId, personId))
              .orderBy(asc(schema.beneficiary.beneficiaryId));
            return rows.map(mapBeneficiary);
          }),

        getBeneficiaryById: (beneficiaryId: string) =>
          exec(async (db): Promise<Beneficiary | null> => {
            const rows = await db.select().from(schema.beneficiary).where(eq(schema.beneficiary.beneficiaryId, beneficiaryId)).limit(1);
            return rows[0] ? mapBeneficiary(rows[0]) : null;
          }),

        // S9: claims (per-actor scoping is the use-case's job).
        listClaims: () =>
          exec(async (db): Promise<Claim[]> => {
            const rows = await db.select().from(schema.claim).orderBy(desc(schema.claim.createdAt), desc(schema.claim.claimId));
            return rows.map(mapClaim);
          }),

        // L-05: payroll's scoped read — payable claims + payee name via LEFT JOIN,
        // keyset-paginated by (created_at desc, claim_id desc) to match listClaims order.
        // created_at is carried as ::text (full precision) so the cursor round-trips
        // exactly. RLS (withTenantTx) tenant-isolates both claim and the joined person.
        listPayableClaimsWithPayee: (after: { createdAt: string; claimId: string } | null, limit: number) =>
          exec(async (db): Promise<PayableClaimRow[]> => {
            const res = await db.execute(sql`
              SELECT c.claim_id, c.submitted_by, c.person_id, c.category, c.description,
                     c.amount_minor, c.currency, c.expense_on::text AS expense_on, c.status,
                     c.payment_source_label, c.ref_no, c.reviewed_by,
                     c.created_at::text AS created_at, p.full_name AS payee_name
                FROM claim c
                LEFT JOIN person p ON p.tenant_id = c.tenant_id AND p.person_id = c.person_id
               WHERE c.status IN ('Approved', 'Paid')
                 ${after ? sql`AND (c.created_at, c.claim_id) < (${after.createdAt}::timestamptz, ${after.claimId})` : sql``}
               ORDER BY c.created_at DESC, c.claim_id DESC
               LIMIT ${limit}
            `);
            return (res.rows as Array<Record<string, unknown>>).map((r) => ({
              claimId: String(r.claim_id),
              submittedBy: String(r.submitted_by),
              personId: (r.person_id as string | null) ?? null,
              payeeName: (r.payee_name as string | null) ?? null,
              category: String(r.category),
              description: String(r.description),
              amountMinor: Number(r.amount_minor),
              currency: String(r.currency),
              expenseOn: String(r.expense_on),
              status: String(r.status),
              paymentSourceLabel: (r.payment_source_label as string | null) ?? null,
              refNo: (r.ref_no as string | null) ?? null,
              reviewedBy: (r.reviewed_by as string | null) ?? null,
              createdAt: String(r.created_at),
            }));
          }),

        listClaimsForSubmitter: (identity: string) =>
          exec(async (db): Promise<Claim[]> => {
            const rows = await db
              .select()
              .from(schema.claim)
              .where(eq(schema.claim.submittedBy, identity))
              .orderBy(desc(schema.claim.createdAt), desc(schema.claim.claimId));
            return rows.map(mapClaim);
          }),

        getClaimById: (claimId: string) =>
          exec(async (db): Promise<Claim | null> => {
            const rows = await db.select().from(schema.claim).where(eq(schema.claim.claimId, claimId)).limit(1);
            return rows[0] ? mapClaim(rows[0]) : null;
          }),

        listDistributionsWithPending: () =>
          exec(async (db) => {
            const res = await db.execute(sql`
              SELECT d.distribution_id, d.mission_id, d.status, d.created_at, d.currency,
                     COUNT(ds.id) FILTER (WHERE ds.payout_status = 'Pending')::int AS pending_count,
                     COALESCE(SUM(ds.amount_minor) FILTER (WHERE ds.payout_status = 'Pending'), 0)::bigint AS pending_amount
                FROM distribution d
                LEFT JOIN distribution_share ds
                  ON ds.tenant_id = d.tenant_id AND ds.distribution_id = d.distribution_id
               GROUP BY d.distribution_id, d.mission_id, d.status, d.created_at, d.currency
            `);
            return res.rows.map((r0) => {
              const row = r0 as Record<string, unknown>;
              return {
                distributionId: String(row.distribution_id),
                missionId: String(row.mission_id),
                status: String(row.status),
                createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(String(row.created_at)).toISOString(),
                pendingCount: Number(row.pending_count),
                pendingAmountMinor: Number(row.pending_amount),
                currency: String(row.currency),
              };
            });
          }),

        // Sprint 42: the person hub — memberships joined with the mission's
        // identity; approvals scoped by the target person column.
        listMissionMembershipsForPerson: (personId: string) =>
          exec(async (db): Promise<PersonMissionMembership[]> => {
            const res = await db.execute(sql`
              SELECT mp.mission_id, m.name AS mission_name, m.is_active AS mission_is_active,
                     mp.role, mp.is_active
                FROM mission_participant mp
                JOIN mission m ON m.tenant_id = mp.tenant_id AND m.mission_id = mp.mission_id
               WHERE mp.person_id = ${personId}
               ORDER BY mp.mission_id
            `);
            return (res.rows as Array<{ mission_id: string; mission_name: string; mission_is_active: boolean; role: string; is_active: boolean }>).map((r) => ({
              missionId: r.mission_id,
              missionName: r.mission_name,
              missionIsActive: r.mission_is_active,
              role: r.role,
              isActive: r.is_active,
            }));
          }),

        listApprovalsForPerson: (personId: string) =>
          exec(async (db): Promise<Approval[]> => {
            const rows = await db
              .select()
              .from(schema.approval)
              .where(eq(schema.approval.targetPersonId, personId))
              .orderBy(desc(schema.approval.approvalId));
            return rows.map(mapApproval);
          }),

        // HARDEN-1 H-06: the bulk read carries per-diem + the joined person
        // name so org/team P&L can roll REAL per-diem expense in — the slim
        // Sprint-43 projection was why summaries silently understated expense.
        listAllMissionParticipants: () =>
          exec(async (db) => {
            const res = await db.execute(sql`
              SELECT mp.mission_id, mp.person_id, p.full_name AS person_name, mp.role, mp.is_active,
                     mp.per_diem_amount_minor, mp.per_diem_currency
                FROM mission_participant mp
                JOIN person p ON p.tenant_id = mp.tenant_id AND p.person_id = mp.person_id
            `);
            return (res.rows as Array<Record<string, unknown>>).map((r) => ({
              missionId: String(r.mission_id),
              personId: String(r.person_id),
              personName: String(r.person_name),
              role: String(r.role),
              isActive: Boolean(r.is_active),
              perDiemAmountMinor: r.per_diem_amount_minor === null ? null : Number(r.per_diem_amount_minor),
              perDiemCurrency: (r.per_diem_currency as string | null) ?? null,
            }));
          }),

        // Sprint 35: the member directory is read through the tenant-scoped
        // member_list() SECURITY DEFINER gateway — c3_app has no table access.
        listMembers: () =>
          exec(async (db): Promise<Member[]> => {
            const res = await db.execute(sql`SELECT * FROM member_list()`);
            return (res.rows as Array<{ user_id: string; email: string; display_name: string; role: string; is_active: boolean; created_at: Date | string }>).map((r) => ({
              userId: r.user_id,
              tenantId: actor.tenantId,
              email: r.email,
              displayName: r.display_name,
              role: r.role as Member['role'],
              isActive: r.is_active,
              createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
            }));
          }),
      });

      // Reads bound to an OPEN transaction: batch() inside them is reentrant
      // (same snapshot), never a nested BEGIN.
      const txReads = (db: Db): ReadStore => {
        const r: ReadStore = build(
          (q) => q(db),
          (fn) => fn(r),
        );
        return r;
      };

      return build(
        (q) => withTenantTx(pool, actor, 'read', (db) => q(db)),
        (fn) => withTenantTx(pool, actor, 'read', (db) => fn(txReads(db)), 'REPEATABLE READ'),
      );
    },
  };

  const writes: WriteStore = {
    transaction<T>(actor: Actor, fn: (tx: WriteTx) => Promise<T>, options?: WriteTransactionOptions): Promise<T> {
      return withTenantTx(
        pool,
        actor,
        'write',
        async (db) => {
          const tx = makeWriteTx(db, actor);
          return fn(tx);
        },
        config.writeIsolation,
        options?.signal,
      );
    },
  };

  // Track B6: the guest port — the ONLY tenant-unbound surface. The tenant is
  // resolved server-side from the unguessable token (never the client) via the
  // SECURITY DEFINER gateways; the sandbox insert then runs as c3_app under RLS
  // bound to the CLAIMED tenant.
  const guest: GuestIntakePort = {
    async peek(tokenHash: string): Promise<GuestIntakePeek | null> {
      const res = await pool.query(
        'SELECT link_id, tenant_id, kind, effective_status, expires_at, uses_left FROM intake_peek($1)',
        [tokenHash],
      );
      const r = res.rows[0];
      if (!r) return null;
      return {
        linkId: String(r.link_id),
        tenantId: String(r.tenant_id),
        kind: String(r.kind),
        effectiveStatus: String(r.effective_status),
        expiresAt: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
        usesLeft: Number(r.uses_left),
      };
    },
    async tombstoneRefusedUploads(tokenHash: string, storageKeys: readonly string[]): Promise<number> {
      if (storageKeys.length === 0) return 0;
      // R3-N02: token-keyed definer insert — durable record of a refused claim's bytes,
      // written even while the tenant is Exiting (blob_tombstone is not quiesced).
      const res = await pool.query('SELECT intake_tombstone_refused($1, $2) AS n', [tokenHash, storageKeys as string[]]);
      return Number(res.rows[0]?.n ?? 0);
    },
    async prepareCompensation(tokenHash: string, storageKey: string, preparedTtlMs: number): Promise<void> {
      // HARDEN-3.5 B (site 5): the prepared intent EXISTS before the byte does. The definer
      // validates the key inside the token tenant's intake namespace (B-1, 0067 discipline).
      await pool.query('SELECT intake_prepare_compensation($1, $2, $3)', [tokenHash, storageKey, preparedTtlMs]);
    },
    async armCompensation(tokenHash: string, storageKeys: readonly string[]): Promise<number> {
      if (storageKeys.length === 0) return 0;
      const res = await pool.query('SELECT intake_arm_compensation($1, $2) AS n', [tokenHash, storageKeys as string[]]);
      return Number(res.rows[0]?.n ?? 0);
    },
    async acquireUploadLease(tokenHash: string, ttlMs: number): Promise<string | null> {
      // R4-N01/R5-N01: token-keyed definer (tenant-first lock order); NULL = refused (dead
      // link or Exiting tenant). The API owns the TTL so it can enforce requestTimeout×2 ≤ TTL.
      const res = await pool.query('SELECT intake_lease_acquire($1, $2) AS id', [tokenHash, ttlMs]);
      const id = res.rows[0]?.id;
      return id ? String(id) : null;
    },
    async releaseUploadLease(leaseId: string): Promise<void> {
      await pool.query('SELECT intake_lease_release($1)', [leaseId]);
    },
    async claimAndInsert(tokenHash: string, submission: NewGuestSubmission, opts?: { signal?: AbortSignal }) {
      opts?.signal?.throwIfAborted();
      const client = await pool.connect();
      try {
        opts?.signal?.throwIfAborted();
        await client.query('BEGIN');
        opts?.signal?.throwIfAborted();
        // Atomic validate + consume (row-locked) via the definer gateway.
        const claimed = await client.query('SELECT link_id, tenant_id, kind FROM intake_claim($1)', [tokenHash]);
        const c = claimed.rows[0];
        if (!c) {
          await client.query('ROLLBACK');
          throw new IntakeLinkUnavailableError();
        }
        const tenantId = String(c.tenant_id);
        const linkId = String(c.link_id);
        const kind = String(c.kind);
        // Bind the insert to the claimed tenant; RLS WITH CHECK enforces it.
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const ins = await client.query(
          `INSERT INTO intake_submission (id, tenant_id, link_id, kind, payload, uploads, submitter_fingerprint)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7) RETURNING *`,
          [submission.submissionId, tenantId, linkId, kind, JSON.stringify(submission.payload), JSON.stringify(submission.uploads), submission.submitterFingerprint],
        );
        // HARDEN-3.5 B (B-3): resolve EXACTLY the keys this claim is committing — every stored
        // file has a prepared intent (prepared before its PUT), so the count must equal. Fewer
        // rows means the drain TTL-armed (maybe swept) one mid-flight: the request outlived its
        // deadline, and the WHOLE claim aborts — never committed metadata over swept bytes.
        // (A mid-submission file failure never reaches the claim: the route fails the whole
        // submission and ARMS the stored keys instead.)
        const claimKeys = (submission.uploads as ReadonlyArray<{ storageKey: string }>).map((u) => u.storageKey);
        if (claimKeys.length > 0) {
          const resolved = await client.query(
            `UPDATE blob_tombstone SET state = 'resolved', deleted_at = now()
              WHERE tenant_ref = $1 AND storage_key = ANY($2) AND reason = 'compensation' AND state = 'prepared'
              RETURNING id`,
            [tenantId, claimKeys],
          );
          if (resolved.rowCount !== claimKeys.length) {
            await client.query('ROLLBACK');
            throw new Error(
              `Intake claim aborted: ${resolved.rowCount}/${claimKeys.length} prepared compensation intents could be resolved — ` +
                'the request outlived its deadline (an intent was armed/swept) or an intent was never prepared.',
            );
          }
        }
        await client.query('COMMIT');
        return { tenantId, linkId, kind, submission: mapIntakeSubmission(ins.rows[0]) };
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore rollback failure */
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };

  return {
    reads,
    writes,
    guest,
    pool,
    close: () => pool.end(),
  };
}
