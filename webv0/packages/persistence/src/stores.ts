/**
 * stores.ts — concrete ReadStore / WriteStore over a pg Pool (as the c3_app
 * role). Implements the @c3web/application Persistence port.
 */
import { Pool } from 'pg';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Actor, Agreement, AgreementTerm, Apparel, Approval, ApprovalEvent, ApprovalStatus, AuditEvent, Credential, Entity, FxRate, Invoice, Journey, Team, TeamMembership, Distribution, DistributionShare, Claim, C3Notification, Delegation, Beneficiary, Kit, Member, Mission, C3Document, MissionBudget, MissionLine, MissionParticipant, Person } from '@c3web/domain';
import type { Persistence, PersonMissionMembership, ReadStore, WriteStore, WriteTx } from '@c3web/application';
import * as schema from './schema';
import { withTenantTx } from './tenantContext';
import { makeWriteTx } from './writeTx';
import { mapAgreement, mapAgreementTerm, mapApparel, mapApproval, mapApprovalEvent, mapAuditEvent, mapCredential, mapDocument, mapEntity, mapFxRate, mapInvoice, mapTeam, mapTeamMembership, mapDistribution, mapDistributionShare, mapClaim,
  mapDelegation, mapBeneficiary, mapJourney, mapKit, mapMission, mapMissionBudget, mapMissionLine, mapMissionParticipant, mapPerson } from './mappers';

export interface PersistenceConfig {
  /** Connection string for the least-privileged application role (c3_app). */
  readonly appConnectionString: string;
  /** Optional pool tuning. */
  readonly max?: number;
}

export interface PersistenceHandle extends Persistence {
  readonly pool: Pool;
  close(): Promise<void>;
}

export function createPersistence(config: PersistenceConfig): PersistenceHandle {
  // Force UTF-8 at connection startup (avoids a racing per-connection SET, and
  // guards against a client locale defaulting to WIN1252 on Windows).
  const pool = new Pool({
    connectionString: config.appConnectionString,
    max: config.max ?? 10,
    options: '-c client_encoding=UTF8',
  });

  const reads = {
    forActor(actor: Actor): ReadStore {
      return {
        listPeople: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Person[]> => {
            const rows = await db.select().from(schema.person).orderBy(asc(schema.person.personId));
            return rows.map(mapPerson);
          }),

        getPersonById: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Person | null> => {
            const rows = await db.select().from(schema.person).where(eq(schema.person.personId, personId)).limit(1);
            return rows[0] ? mapPerson(rows[0]) : null;
          }),

        listApprovals: (filter?: { statuses?: ApprovalStatus[] }) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Approval[]> => {
            const base = db.select().from(schema.approval);
            const rows = filter?.statuses?.length
              ? await base.where(inArray(schema.approval.status, filter.statuses)).orderBy(desc(schema.approval.approvalId))
              : await base.orderBy(desc(schema.approval.approvalId));
            return rows.map(mapApproval);
          }),

        getApprovalById: (approvalId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Approval | null> => {
            const rows = await db
              .select()
              .from(schema.approval)
              .where(eq(schema.approval.approvalId, approvalId))
              .limit(1);
            return rows[0] ? mapApproval(rows[0]) : null;
          }),

        listApprovalEvents: (approvalId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<ApprovalEvent[]> => {
            const rows = await db
              .select()
              .from(schema.approvalEvent)
              .where(eq(schema.approvalEvent.approvalId, approvalId))
              .orderBy(asc(schema.approvalEvent.at));
            return rows.map(mapApprovalEvent);
          }),

        // S5: the whole tenant audit stream (the audit-trail export), oldest first.
        listAllAuditEvents: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<AuditEvent[]> => {
            const rows = await db.select().from(schema.auditEvent).orderBy(asc(schema.auditEvent.at));
            return rows.map(mapAuditEvent);
          }),

        listAuditEventsForEntity: (entityType: string, entityId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<AuditEvent[]> => {
            const rows = await db
              .select()
              .from(schema.auditEvent)
              .where(and(eq(schema.auditEvent.entityType, entityType), eq(schema.auditEvent.entityId, entityId)))
              .orderBy(asc(schema.auditEvent.at));
            return rows.map(mapAuditEvent);
          }),

        // Sprint 36: credentials — drizzle-only reads (mode:'string' dates).
        listCredentials: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Credential[]> => {
            const rows = await db.select().from(schema.credential).orderBy(asc(schema.credential.credentialId));
            return rows.map(mapCredential);
          }),

        listCredentialsForPerson: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Credential[]> => {
            const rows = await db
              .select()
              .from(schema.credential)
              .where(eq(schema.credential.personId, personId))
              .orderBy(asc(schema.credential.credentialId));
            return rows.map(mapCredential);
          }),

        getCredentialById: (credentialId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Credential | null> => {
            const rows = await db
              .select()
              .from(schema.credential)
              .where(eq(schema.credential.credentialId, credentialId))
              .limit(1);
            return rows[0] ? mapCredential(rows[0]) : null;
          }),

        // Sprint 37: journeys — drizzle-only reads (mode:'string' dates).
        listJourneys: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Journey[]> => {
            const rows = await db.select().from(schema.journey).orderBy(asc(schema.journey.journeyId));
            return rows.map(mapJourney);
          }),

        listJourneysForPerson: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Journey[]> => {
            const rows = await db
              .select()
              .from(schema.journey)
              .where(eq(schema.journey.personId, personId))
              .orderBy(asc(schema.journey.journeyId));
            return rows.map(mapJourney);
          }),

        getJourneyById: (journeyId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Journey | null> => {
            const rows = await db.select().from(schema.journey).where(eq(schema.journey.journeyId, journeyId)).limit(1);
            return rows[0] ? mapJourney(rows[0]) : null;
          }),

        // Sprint 38: equipment reads (drizzle-only).
        listKit: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Kit[]> => {
            const rows = await db.select().from(schema.kit).orderBy(asc(schema.kit.kitId));
            return rows.map(mapKit);
          }),

        getKitById: (kitId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Kit | null> => {
            const rows = await db.select().from(schema.kit).where(eq(schema.kit.kitId, kitId)).limit(1);
            return rows[0] ? mapKit(rows[0]) : null;
          }),

        listApparel: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Apparel[]> => {
            const rows = await db.select().from(schema.apparel).orderBy(asc(schema.apparel.apparelId));
            return rows.map(mapApparel);
          }),

        getApparelById: (apparelId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Apparel | null> => {
            const rows = await db.select().from(schema.apparel).where(eq(schema.apparel.apparelId, apparelId)).limit(1);
            return rows[0] ? mapApparel(rows[0]) : null;
          }),

        // Sprint 39: missions (shell drizzle-only; participants joined with
        // the person's display name for the register).
        listMissions: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Mission[]> => {
            const rows = await db.select().from(schema.mission).orderBy(asc(schema.mission.missionId));
            return rows.map(mapMission);
          }),

        getMissionById: (missionId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Mission | null> => {
            const rows = await db.select().from(schema.mission).where(eq(schema.mission.missionId, missionId)).limit(1);
            return rows[0] ? mapMission(rows[0]) : null;
          }),

        listMissionParticipants: (missionId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<MissionParticipant[]> => {
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
          withTenantTx(pool, actor, 'read', async (db): Promise<MissionParticipant | null> => {
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
          withTenantTx(pool, actor, 'read', async (db): Promise<MissionLine[]> => {
            const rows = await db
              .select()
              .from(schema.missionLine)
              .where(and(eq(schema.missionLine.missionId, missionId), eq(schema.missionLine.isActive, true)))
              .orderBy(asc(schema.missionLine.createdAt), asc(schema.missionLine.lineId));
            return rows.map(mapMissionLine);
          }),

        // S2: the mission's budgets; org-wide bulk reads for the finance dashboard.
        listMissionBudgets: (missionId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<MissionBudget[]> => {
            const rows = await db
              .select()
              .from(schema.missionBudget)
              .where(eq(schema.missionBudget.missionId, missionId))
              .orderBy(asc(schema.missionBudget.direction), asc(schema.missionBudget.category), asc(schema.missionBudget.currency));
            return rows.map(mapMissionBudget);
          }),

        listAllMissionLines: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<MissionLine[]> => {
            const rows = await db
              .select()
              .from(schema.missionLine)
              .where(eq(schema.missionLine.isActive, true))
              .orderBy(asc(schema.missionLine.missionId), asc(schema.missionLine.lineId));
            return rows.map(mapMissionLine);
          }),

        listAllMissionBudgets: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<MissionBudget[]> => {
            const rows = await db.select().from(schema.missionBudget).orderBy(asc(schema.missionBudget.missionId));
            return rows.map(mapMissionBudget);
          }),

        // Sprint 41: agreements (drizzle-only; financial omission is the
        // application query layer's job, per-actor).
        listAgreements: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Agreement[]> => {
            const rows = await db.select().from(schema.agreement).orderBy(asc(schema.agreement.agreementId));
            return rows.map(mapAgreement);
          }),

        listAgreementsForPerson: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Agreement[]> => {
            const rows = await db
              .select()
              .from(schema.agreement)
              .where(eq(schema.agreement.personId, personId))
              .orderBy(asc(schema.agreement.agreementId));
            return rows.map(mapAgreement);
          }),

        getAgreementById: (agreementId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Agreement | null> => {
            const rows = await db.select().from(schema.agreement).where(eq(schema.agreement.agreementId, agreementId)).limit(1);
            return rows[0] ? mapAgreement(rows[0]) : null;
          }),

        // Finance S3: the ACTIVE financial terms of an agreement, oldest first.
        listAgreementTerms: (agreementId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<AgreementTerm[]> => {
            const rows = await db
              .select()
              .from(schema.agreementTerm)
              .where(and(eq(schema.agreementTerm.agreementId, agreementId), eq(schema.agreementTerm.isActive, true)))
              .orderBy(asc(schema.agreementTerm.createdAt), asc(schema.agreementTerm.termId));
            return rows.map(mapAgreementTerm);
          }),

        // S48: entities (the tenant's legal operating entities).
        listEntities: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Entity[]> => {
            const rows = await db.select().from(schema.entity).orderBy(asc(schema.entity.entityId));
            return rows.map(mapEntity);
          }),

        getEntityById: (entityId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Entity | null> => {
            const rows = await db.select().from(schema.entity).where(eq(schema.entity.entityId, entityId)).limit(1);
            return rows[0] ? mapEntity(rows[0]) : null;
          }),

        // S4: documents attached to an owning record (ACTIVE rows, newest first).
        listDocuments: (ownerType: string, ownerId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<C3Document[]> => {
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
          withTenantTx(pool, actor, 'read', async (db): Promise<FxRate[]> => {
            const rows = await db.select().from(schema.fxRate).orderBy(asc(schema.fxRate.currency));
            return rows.map(mapFxRate);
          }),

        // S6: invoices — the register (newest first; voided rows ride along, honestly labeled).
        listInvoices: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Invoice[]> => {
            const rows = await db.select().from(schema.invoice).orderBy(desc(schema.invoice.createdAt), desc(schema.invoice.invoiceId));
            return rows.map(mapInvoice);
          }),

        getInvoiceById: (invoiceId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Invoice | null> => {
            const rows = await db.select().from(schema.invoice).where(eq(schema.invoice.invoiceId, invoiceId)).limit(1);
            return rows[0] ? mapInvoice(rows[0]) : null;
          }),

        // S7: teams + memberships (memberships join the person's display name).
        listTeams: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Team[]> => {
            const rows = await db.select().from(schema.team).orderBy(asc(schema.team.teamId));
            return rows.map(mapTeam);
          }),

        getTeamById: (teamId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Team | null> => {
            const rows = await db.select().from(schema.team).where(eq(schema.team.teamId, teamId)).limit(1);
            return rows[0] ? mapTeam(rows[0]) : null;
          }),

        listTeamMembers: (teamId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<TeamMembership[]> => {
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
          withTenantTx(pool, actor, 'read', async (db): Promise<TeamMembership[]> => {
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
          withTenantTx(pool, actor, 'read', async (db) => {
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
          withTenantTx(pool, actor, 'read', async (db): Promise<Distribution[]> => {
            const rows = await db
              .select()
              .from(schema.distribution)
              .where(eq(schema.distribution.missionId, missionId))
              .orderBy(desc(schema.distribution.createdAt), desc(schema.distribution.distributionId));
            return rows.map(mapDistribution);
          }),

        getDistributionById: (distributionId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Distribution | null> => {
            const rows = await db.select().from(schema.distribution).where(eq(schema.distribution.distributionId, distributionId)).limit(1);
            return rows[0] ? mapDistribution(rows[0]) : null;
          }),

        listDistributionShares: (distributionId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<DistributionShare[]> => {
            const res = await db.execute(sql`
              SELECT ds.*, p.full_name AS person_name
                FROM distribution_share ds
                JOIN person p ON p.tenant_id = ds.tenant_id AND p.person_id = ds.person_id
               WHERE ds.distribution_id = ${distributionId}
               ORDER BY ds.amount_minor DESC, ds.person_id ASC
            `);
            return res.rows.map(mapDistributionShare);
          }),

        // S10: the actor's own inbox (newest first, capped).
        listNotifications: (identity: string, limit: number) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<C3Notification[]> => {
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
          withTenantTx(pool, actor, 'read', async (db): Promise<Delegation[]> => {
            const rows = await db.select().from(schema.delegation).orderBy(desc(schema.delegation.createdAt));
            return rows.map(mapDelegation);
          }),

        findUnrevokedDelegationId: (granteeIdentity: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<string | null> => {
            const res = await db.execute(sql`
              SELECT delegation_id FROM delegation
               WHERE grantee_identity = ${granteeIdentity} AND revoked_at IS NULL
               LIMIT 1
            `);
            return res.rows[0] ? String((res.rows[0] as { delegation_id: string }).delegation_id) : null;
          }),

        hasActiveDelegation: (identity: string, onDate: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<boolean> => {
            const res = await db.execute(sql`
              SELECT 1 FROM delegation
               WHERE grantee_identity = ${identity} AND revoked_at IS NULL
                 AND starts_on <= ${onDate} AND ends_on >= ${onDate}
               LIMIT 1
            `);
            return res.rows.length > 0;
          }),

        // S12: the beneficiary registry (finance-gated at the usecase).
        listBeneficiaries: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Beneficiary[]> => {
            const rows = await db.select().from(schema.beneficiary).orderBy(asc(schema.beneficiary.beneficiaryId));
            return rows.map(mapBeneficiary);
          }),

        listBeneficiariesForPerson: (personId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Beneficiary[]> => {
            const rows = await db
              .select()
              .from(schema.beneficiary)
              .where(eq(schema.beneficiary.personId, personId))
              .orderBy(asc(schema.beneficiary.beneficiaryId));
            return rows.map(mapBeneficiary);
          }),

        getBeneficiaryById: (beneficiaryId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Beneficiary | null> => {
            const rows = await db.select().from(schema.beneficiary).where(eq(schema.beneficiary.beneficiaryId, beneficiaryId)).limit(1);
            return rows[0] ? mapBeneficiary(rows[0]) : null;
          }),

        // S9: claims (per-actor scoping is the use-case's job).
        listClaims: () =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Claim[]> => {
            const rows = await db.select().from(schema.claim).orderBy(desc(schema.claim.createdAt), desc(schema.claim.claimId));
            return rows.map(mapClaim);
          }),

        listClaimsForSubmitter: (identity: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Claim[]> => {
            const rows = await db
              .select()
              .from(schema.claim)
              .where(eq(schema.claim.submittedBy, identity))
              .orderBy(desc(schema.claim.createdAt), desc(schema.claim.claimId));
            return rows.map(mapClaim);
          }),

        getClaimById: (claimId: string) =>
          withTenantTx(pool, actor, 'read', async (db): Promise<Claim | null> => {
            const rows = await db.select().from(schema.claim).where(eq(schema.claim.claimId, claimId)).limit(1);
            return rows[0] ? mapClaim(rows[0]) : null;
          }),

        listDistributionsWithPending: () =>
          withTenantTx(pool, actor, 'read', async (db) => {
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
          withTenantTx(pool, actor, 'read', async (db): Promise<PersonMissionMembership[]> => {
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
          withTenantTx(pool, actor, 'read', async (db): Promise<Approval[]> => {
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
          withTenantTx(pool, actor, 'read', async (db) => {
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
          withTenantTx(pool, actor, 'read', async (db): Promise<Member[]> => {
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
      };
    },
  };

  const writes: WriteStore = {
    transaction<T>(actor: Actor, fn: (tx: WriteTx) => Promise<T>): Promise<T> {
      return withTenantTx(pool, actor, 'write', async (db) => {
        const tx = makeWriteTx(db, actor);
        return fn(tx);
      });
    },
  };

  return {
    reads,
    writes,
    pool,
    close: () => pool.end(),
  };
}
