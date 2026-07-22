/**
 * writeTx.ts — WriteTx implementation bound to a single tenant transaction.
 * All statements run under the transaction's `app.tenant_id` (RLS enforced).
 */
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  type Agreement,
  type AgreementTerm,
  type C3Document,
  ConflictError,
  IdentityAlreadyBoundError,
  LastOwnerProtectionError,
  NotFoundError,
  SelfAdministrationError,
  TenantContextMissingError,
  type Actor,
  type Apparel,
  type Approval,
  type ApprovalRevision,
  type C3Role,
  type Credential,
  type Entity,
  type FxRate,
  type Invoice,
  type Journey,
  type Team,
  type TeamMembership,
  type Distribution,
  type DistributionShare,
  type Claim,
  type Comment,
  type IntakeLink,
  type IntakeSubmission,
  type Subscription,
  type SavedView,
  type Departure,
  type Delegation,
  type Beneficiary,
  type JourneyStatus,
  type Kit,
  type Member,
  type Mission,
  type MissionBudget,
  type MissionLine,
  type MissionParticipant,
  type Person,
} from '@c3web/domain';
import type { AgreementPatch, AgreementTermPatch, NewDocumentRow, NewInvoiceRow, NewTeamRow, TeamPatch, NewDistributionRow, NewDistributionShareRow, NewClaimRow, EntityPatch, EquipmentPatch, MissionLinePatch, MissionLinePaymentPatch, MissionPatch, NewAgreementRow, NewAgreementTermRow, NewApprovalRow, NewCredentialRow, NewEntityRow, NewEquipmentRow, NewJourneyRow, NewMissionLineRow, NewMissionRow, NewPersonRow, PersonFieldsPatch, CredentialFieldsPatch, NewBeneficiaryRow, BeneficiaryFieldsPatch, NewSubscriptionRow, SubscriptionPatch, NewSavedViewRow, SavedViewPatch, NewRevisionIntent, WriteTx } from '@c3web/application';
import type { Db } from './tenantContext';
import * as schema from './schema';
import { mapAgreement, mapAgreementTerm, mapDocument, mapInvoice, mapTeam, mapTeamMembership, mapDistribution, mapDistributionShare, mapClaim, mapComment, mapIntakeLink, mapIntakeSubmission, mapSubscription, mapSavedView, mapDeparture, mapDelegation, mapBeneficiary, mapApparel, mapApproval, mapApprovalRevision, mapCredential, mapEntity, mapFxRate, mapJourney, mapKit, mapMission, mapMissionBudget, mapMissionLine, mapMissionParticipant, mapPerson, mapModuleEntitlement, mapCommsThread } from './mappers';

/**
 * Map a member-gateway failure (SECURITY DEFINER function, message prefixed
 * 'C3E:<CODE>:') to the domain error taxonomy. Non-gateway errors re-throw.
 * The driver/ORM may WRAP the pg error (drizzle puts it in `cause`), so the
 * prefix is searched across the whole cause chain.
 */
function gatewayMessage(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(' | ');
}

function mapMemberGatewayError(err: unknown, action: string): never {
  const msg = gatewayMessage(err);
  const m = /C3E:([A-Z_]+):/.exec(msg);
  if (m) {
    switch (m[1]) {
      case 'TENANT_CONTEXT_MISSING':
        throw new TenantContextMissingError();
      case 'IDENTITY_ALREADY_BOUND':
        throw new IdentityAlreadyBoundError();
      case 'SELF_ADMINISTRATION_BLOCKED':
        throw new SelfAdministrationError(action);
      case 'LAST_OWNER_PROTECTED':
        throw new LastOwnerProtectionError(action);
      case 'NOT_FOUND':
        throw new NotFoundError('Member', action);
      case 'CONFLICT': {
        const detail = /C3E:CONFLICT:\s*([^|]*)/.exec(msg)?.[1]?.trim();
        throw new ConflictError(detail || 'Member operation conflict.');
      }
    }
  }
  throw err;
}

interface MemberRow {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: Date | string;
}

function mapMember(r: MemberRow, tenantId: string): Member {
  return {
    userId: r.user_id,
    tenantId,
    email: r.email,
    displayName: r.display_name,
    role: r.role as Member['role'],
    isActive: r.is_active,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export function makeWriteTx(db: Db, actor: Actor): WriteTx {
  const tenantId = actor.tenantId;

  /** Participant domain view: the pair row joined with the person's name. */
  const readParticipantView = async (missionId: string, personId: string, lock = false): Promise<MissionParticipant | null> => {
    const res = await db.execute(sql`
      SELECT mp.*, p.full_name AS person_name
        FROM mission_participant mp
        JOIN person p ON p.tenant_id = mp.tenant_id AND p.person_id = mp.person_id
       WHERE mp.mission_id = ${missionId} AND mp.person_id = ${personId}
       ${lock ? sql`FOR UPDATE OF mp` : sql``}
    `);
    const row = res.rows[0];
    return row ? mapMissionParticipant(row) : null;
  };

  return {
    // ── HARDEN-2 (0037): tenant settings (version-guarded from birth) ────────
    async getTenantSetting(key: string): Promise<{ value: unknown; version: number } | null> {
      const rows = await db.select().from(schema.tenantSetting).where(eq(schema.tenantSetting.key, key)).limit(1);
      return rows[0] ? { value: rows[0].value, version: rows[0].version } : null;
    },

    async insertTenantSetting(key: string, value: unknown): Promise<{ value: unknown; version: number } | null> {
      try {
        const [r] = await db.insert(schema.tenantSetting).values({ tenantId, key, value }).returning();
        return r ? { value: r.value, version: r.version } : null;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return null;
        throw e;
      }
    },

    async updateTenantSetting(key: string, expectedVersion: number, value: unknown): Promise<{ value: unknown; version: number } | null> {
      const rows = await db
        .update(schema.tenantSetting)
        .set({ value, version: sql`${schema.tenantSetting.version} + 1` })
        .where(and(eq(schema.tenantSetting.key, key), eq(schema.tenantSetting.version, expectedVersion)))
        .returning();
      return rows[0] ? { value: rows[0].value, version: rows[0].version } : null;
    },

    async allocateSequence(kind) {
      // Atomic, server-controlled. ON CONFLICT DO UPDATE row-locks the counter
      // so concurrent allocations serialise. Never MAX+1.
      const res = await db.execute(sql`
        INSERT INTO business_id_counter (tenant_id, kind, last_value)
        VALUES (${tenantId}, ${kind}, 1)
        ON CONFLICT (tenant_id, kind)
        DO UPDATE SET last_value = business_id_counter.last_value + 1
        RETURNING last_value
      `);
      const row = res.rows[0] as { last_value: string | number } | undefined;
      if (!row) throw new Error('business-ID allocation returned no row');
      return Number(row.last_value);
    },

    async insertApproval(row: NewApprovalRow): Promise<Approval> {
      const [r] = await db
        .insert(schema.approval)
        .values({
          tenantId,
          approvalId: row.approvalId,
          operationType: row.operationType,
          targetPersonId: row.targetPersonId,
          targetId: row.targetId,
          reason: row.reason,
          status: 'Submitted',
          payload: row.payload,
          submittedBy: row.submittedBy,
          // M-06: stamp the revision link at submit so a resumed drain can find
          // this successor by its source and never submit twice.
          revisionOf: row.revisionOf ?? null,
        })
        .returning();
      return mapApproval(r);
    },

    // Track B1: edit-before-review — version-guarded AND Submitted-guarded at
    // the predicate (the 0038 trigger backstops the same law); every hit bumps
    // the edit badge.
    async updateApprovalPayload(approvalId: string, expectedVersion: number, payload: Approval['payload']): Promise<Approval | null> {
      const rows = await db
        .update(schema.approval)
        .set({
          payload,
          editCount: sql`${schema.approval.editCount} + 1`,
          version: sql`${schema.approval.version} + 1`,
        })
        .where(
          and(
            eq(schema.approval.approvalId, approvalId),
            eq(schema.approval.version, expectedVersion),
            eq(schema.approval.status, 'Submitted'),
          ),
        )
        .returning();
      return rows[0] ? mapApproval(rows[0]) : null;
    },

    // Track B1: link a superseded request to its revision — write-once
    // (WHERE superseded_by IS NULL; the trigger refuses rewrites), legal on
    // terminal rows (linking a Rejected request does not reopen it).
    async setSupersededBy(approvalId: string, supersededBy: string): Promise<boolean> {
      const rows = await db
        .update(schema.approval)
        .set({ supersededBy })
        .where(and(eq(schema.approval.approvalId, approvalId), isNull(schema.approval.supersededBy)))
        .returning();
      return rows.length > 0;
    },

    // Track B1: the reverse link on the fresh request — same write-once law.
    async setRevisionOf(approvalId: string, revisionOf: string): Promise<boolean> {
      const rows = await db
        .update(schema.approval)
        .set({ revisionOf })
        .where(and(eq(schema.approval.approvalId, approvalId), isNull(schema.approval.revisionOf)))
        .returning();
      return rows.length > 0;
    },

    async lockApproval(approvalId: string): Promise<Approval | null> {
      const res = await db.execute(
        sql`SELECT * FROM approval WHERE approval_id = ${approvalId} FOR UPDATE`,
      );
      const row = res.rows[0];
      return row ? mapApproval(row) : null;
    },

    async updateApprovalStatus(approvalId, expectedVersion, patch): Promise<Approval | null> {
      const sets = [sql`status = ${patch.status}`, sql`version = version + 1`];
      if ('reviewedBy' in patch) sets.push(sql`reviewed_by = ${patch.reviewedBy ?? null}`);
      if ('reviewedAt' in patch) sets.push(sql`reviewed_at = ${patch.reviewedAt ?? null}`);
      if ('rejectionReason' in patch) sets.push(sql`rejection_reason = ${patch.rejectionReason ?? null}`);
      if ('executedAt' in patch) sets.push(sql`executed_at = ${patch.executedAt ?? null}`);
      if ('executionError' in patch) sets.push(sql`execution_error = ${patch.executionError ?? null}`);
      if ('targetPersonId' in patch && patch.targetPersonId !== undefined) {
        sets.push(sql`target_person_id = ${patch.targetPersonId}`);
      }
      const res = await db.execute(sql`
        UPDATE approval SET ${sql.join(sets, sql`, `)}
        WHERE approval_id = ${approvalId} AND version = ${expectedVersion}
        RETURNING *
      `);
      const row = res.rows[0];
      return row ? mapApproval(row) : null;
    },

    async insertPerson(row: NewPersonRow): Promise<Person> {
      const [r] = await db
        .insert(schema.person)
        .values({
          tenantId,
          personId: row.personId,
          fullName: row.fullName,
          ign: row.ign,
          nationality: row.nationality,
          primaryRole: row.primaryRole,
          personnelCode: row.personnelCode,
          currentTeam: row.currentTeam,
          currentGameTitle: row.currentGameTitle,
          primaryDepartment: row.primaryDepartment,
          entityId: row.entityId,
          notes: row.notes,
          // H-02: PII tier (guest-intake promote); null on direct/import paths.
          dateOfBirth: row.dateOfBirth ?? null,
          email: row.email ?? null,
          phone: row.phone ?? null,
          addressLine1: row.addressLine1 ?? null,
          addressLine2: row.addressLine2 ?? null,
          addressCity: row.addressCity ?? null,
          addressCountry: row.addressCountry ?? null,
          createdByApprovalId: row.createdByApprovalId,
          ...(row.isActive !== undefined ? { isActive: row.isActive } : {}),
        })
        .returning();
      return mapPerson(r);
    },

    async getPersonByCreatingApproval(approvalId: string): Promise<Person | null> {
      const res = await db.execute(
        sql`SELECT * FROM person WHERE created_by_approval_id = ${approvalId}`,
      );
      const row = res.rows[0];
      return row ? mapPerson(row) : null;
    },

    // ── S11 People v2: governed identity / direct operational mutations ──────
    async lockPerson(personId: string): Promise<Person | null> {
      const res = await db.execute(sql`SELECT * FROM person WHERE person_id = ${personId} FOR UPDATE`);
      return res.rows[0] ? mapPerson(res.rows[0]) : null;
    },

    async updatePersonFields(personId: string, expectedVersion: number, patch: PersonFieldsPatch): Promise<Person | null> {
      const rows = await db
        .update(schema.person)
        .set({
          ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
          ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
          ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
          ...(patch.dateOfBirth !== undefined ? { dateOfBirth: patch.dateOfBirth } : {}),
          ...(patch.nationality !== undefined ? { nationality: patch.nationality } : {}),
          ...(patch.otherNationalities !== undefined ? { otherNationalities: [...patch.otherNationalities] } : {}),
          ...(patch.ign !== undefined ? { ign: patch.ign } : {}),
          ...(patch.primaryRole !== undefined ? { primaryRole: patch.primaryRole } : {}),
          ...(patch.personnelCode !== undefined ? { personnelCode: patch.personnelCode } : {}),
          ...(patch.currentTeam !== undefined ? { currentTeam: patch.currentTeam } : {}),
          ...(patch.currentGameTitle !== undefined ? { currentGameTitle: patch.currentGameTitle } : {}),
          ...(patch.primaryDepartment !== undefined ? { primaryDepartment: patch.primaryDepartment } : {}),
          ...(patch.entityId !== undefined ? { entityId: patch.entityId } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.position !== undefined ? { position: patch.position } : {}),
          ...(patch.dateOfJoining !== undefined ? { dateOfJoining: patch.dateOfJoining } : {}),
          ...(patch.addressLine1 !== undefined ? { addressLine1: patch.addressLine1 } : {}),
          ...(patch.addressLine2 !== undefined ? { addressLine2: patch.addressLine2 } : {}),
          ...(patch.addressCity !== undefined ? { addressCity: patch.addressCity } : {}),
          ...(patch.addressCountry !== undefined ? { addressCountry: patch.addressCountry } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.email !== undefined ? { email: patch.email } : {}),
          version: expectedVersion + 1,
        })
        .where(and(eq(schema.person.personId, personId), eq(schema.person.version, expectedVersion)))
        .returning();
      return rows[0] ? mapPerson(rows[0]) : null;
    },

    async setPersonActive(personId: string, expectedVersion: number, isActive: boolean): Promise<Person | null> {
      const rows = await db
        .update(schema.person)
        .set({ isActive, version: expectedVersion + 1 })
        .where(and(eq(schema.person.personId, personId), eq(schema.person.version, expectedVersion)))
        .returning();
      return rows[0] ? mapPerson(rows[0]) : null;
    },

    async setPersonPhoto(personId: string, patch: { storageKey: string; contentType: string; sha256: string } | null): Promise<Person | null> {
      // No version guard: a photo swap must not touch the identity concurrency
      // token (nor collide with a governed edit). Last-write-wins.
      const rows = await db
        .update(schema.person)
        .set({
          photoStorageKey: patch ? patch.storageKey : null,
          photoContentType: patch ? patch.contentType : null,
          photoSha256: patch ? patch.sha256 : null,
          photoUpdatedAt: patch ? new Date() : null,
        })
        .where(eq(schema.person.personId, personId))
        .returning();
      return rows[0] ? mapPerson(rows[0]) : null;
    },

    // ── S12: credential v2 facts/details + the beneficiary registry ──────────
    async lockCredential(credentialId: string): Promise<Credential | null> {
      const res = await db.execute(sql`SELECT * FROM credential WHERE credential_id = ${credentialId} FOR UPDATE`);
      return res.rows[0] ? mapCredential(res.rows[0]) : null;
    },

    async updateCredentialFields(credentialId: string, expectedVersion: number, patch: CredentialFieldsPatch): Promise<Credential | null> {
      const rows = await db
        .update(schema.credential)
        .set({
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.documentNumber !== undefined ? { documentNumber: patch.documentNumber } : {}),
          ...(patch.issuingCountry !== undefined ? { issuingCountry: patch.issuingCountry } : {}),
          ...(patch.issuedOn !== undefined ? { issuedOn: patch.issuedOn } : {}),
          ...(patch.expiresOn !== undefined ? { expiresOn: patch.expiresOn } : {}),
          ...(patch.credentialType !== undefined ? { credentialType: patch.credentialType } : {}),
          ...(patch.issuer !== undefined ? { issuer: patch.issuer } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          version: expectedVersion + 1,
        })
        // M-07: the facts of a RETIRED credential never change — active state is in
        // the predicate so a concurrent deactivation cannot be overwritten.
        .where(and(eq(schema.credential.credentialId, credentialId), eq(schema.credential.version, expectedVersion), eq(schema.credential.isActive, true)))
        .returning();
      return rows[0] ? mapCredential(rows[0]) : null;
    },

    // ── HARDEN-1 H-05: in-tx locked reads for the finance lock-order ──────────
    async listMissionLinesTxLocked(missionId: string): Promise<MissionLine[]> {
      const res = await db.execute(sql`SELECT * FROM mission_line WHERE mission_id = ${missionId} FOR UPDATE`);
      return (res.rows as Array<Record<string, unknown>>).map(mapMissionLine);
    },

    async lockDistribution(distributionId: string): Promise<Distribution | null> {
      const res = await db.execute(sql`SELECT * FROM distribution WHERE distribution_id = ${distributionId} FOR UPDATE`);
      return res.rows[0] ? mapDistribution(res.rows[0]) : null;
    },

    async insertBeneficiary(row: NewBeneficiaryRow): Promise<Beneficiary> {
      const [r] = await db
        .insert(schema.beneficiary)
        .values({ tenantId, status: 'Draft', ...row })
        .returning();
      return mapBeneficiary(r);
    },

    async lockBeneficiary(beneficiaryId: string): Promise<Beneficiary | null> {
      const res = await db.execute(sql`SELECT * FROM beneficiary WHERE beneficiary_id = ${beneficiaryId} FOR UPDATE`);
      return res.rows[0] ? mapBeneficiary(res.rows[0]) : null;
    },

    async updateBeneficiaryFields(beneficiaryId: string, expectedVersion: number, patch: BeneficiaryFieldsPatch): Promise<Beneficiary | null> {
      const rows = await db
        .update(schema.beneficiary)
        .set({
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.bankName !== undefined ? { bankName: patch.bankName } : {}),
          ...(patch.bankCountry !== undefined ? { bankCountry: patch.bankCountry } : {}),
          ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
          ...(patch.paymentType !== undefined ? { paymentType: patch.paymentType } : {}),
          ...(patch.registeredWithEntityId !== undefined ? { registeredWithEntityId: patch.registeredWithEntityId } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.statusDate !== undefined ? { statusDate: patch.statusDate } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          version: expectedVersion + 1,
        })
        .where(and(eq(schema.beneficiary.beneficiaryId, beneficiaryId), eq(schema.beneficiary.version, expectedVersion)))
        .returning();
      return rows[0] ? mapBeneficiary(rows[0]) : null;
    },

    async appendApprovalEvent(evt): Promise<void> {
      await db.insert(schema.approvalEvent).values({
        tenantId,
        approvalId: evt.approvalId,
        fromStatus: evt.fromStatus,
        toStatus: evt.toStatus,
        actor: evt.actor,
        note: evt.note ?? null,
      });

      // S10: pipeline notifications fan out IN THIS TRANSACTION — atomic with
      // the event itself. New submissions notify every ACTIVE owner (except
      // the actor); every later transition notifies the submitter (except
      // when they caused it). ON CONFLICT DO NOTHING = dedupe on retries.
      const link = `/approvals/${evt.approvalId}`;
      const key = `${evt.approvalId}:${evt.toStatus}`;
      const notify = async (identity: string, title: string) => {
        await db.execute(sql`
          INSERT INTO notification (tenant_id, user_identity, signal_key, kind, title, link)
          VALUES (${tenantId}, ${identity}, ${key}, 'pipeline', ${title}, ${link})
          ON CONFLICT (tenant_id, user_identity, signal_key) DO NOTHING
        `);
      };
      if (evt.toStatus === 'Submitted') {
        const owners = await db.execute(sql`SELECT email FROM member_list() WHERE role = 'owner' AND is_active = true`);
        for (const row of owners.rows as Array<{ email: string }>) {
          if (row.email.toLowerCase() === evt.actor.toLowerCase()) continue;
          await notify(row.email, `${evt.approvalId} awaits review`);
        }
      } else {
        const res = await db.execute(sql`SELECT submitted_by FROM approval WHERE approval_id = ${evt.approvalId} LIMIT 1`);
        const submitter = (res.rows[0] as { submitted_by?: string } | undefined)?.submitted_by;
        if (submitter && submitter.toLowerCase() !== evt.actor.toLowerCase()) {
          await notify(submitter, `${evt.approvalId} is now ${evt.toStatus}`);
        }
      }
    },

    async appendAuditEvent(evt): Promise<void> {
      await db.insert(schema.auditEvent).values({
        tenantId,
        entityType: evt.entityType,
        entityId: evt.entityId,
        action: evt.action,
        actor: evt.actor,
        before: (evt.before ?? null) as unknown as Record<string, unknown>,
        after: (evt.after ?? null) as unknown as Record<string, unknown>,
      });
    },

    async memberProvision(input): Promise<string> {
      try {
        const res = await db.execute(sql`
          SELECT member_provision(${input.email}, ${input.displayName}, ${input.role},
                                  ${input.provider}, ${input.issuerTenantId}, ${input.subject}) AS user_id
        `);
        return (res.rows[0] as { user_id: string }).user_id;
      } catch (err) {
        mapMemberGatewayError(err, 'ProvisionMember');
      }
    },

    async memberSetRole(userId: string, toRole: C3Role, actorEmail: string): Promise<string> {
      try {
        const res = await db.execute(sql`SELECT member_set_role(${userId}::uuid, ${toRole}, ${actorEmail}) AS prev`);
        return (res.rows[0] as { prev: string }).prev;
      } catch (err) {
        mapMemberGatewayError(err, 'ChangeRole');
      }
    },

    async memberSetActive(userId: string, active: boolean, actorEmail: string): Promise<string> {
      try {
        const res = await db.execute(sql`SELECT member_set_active(${userId}::uuid, ${active}, ${actorEmail}) AS mode`);
        return (res.rows[0] as { mode: string }).mode;
      } catch (err) {
        mapMemberGatewayError(err, active ? 'ReactivateMember' : 'DeactivateMember');
      }
    },

    async getMember(userId: string): Promise<Member | null> {
      const res = await db.execute(sql`SELECT * FROM member_get(${userId}::uuid)`);
      const row = res.rows[0] as MemberRow | undefined;
      return row ? mapMember(row, tenantId) : null;
    },

    // ── Sprint 36 credentials — drizzle-only CRUD (mode:'string' dates; the
    //    node-pg DATE→Date parser must never touch these values).
    async insertCredential(row: NewCredentialRow): Promise<Credential> {
      const [r] = await db
        .insert(schema.credential)
        .values({
          tenantId,
          credentialId: row.credentialId,
          personId: row.personId,
          credentialType: row.credentialType,
          ...(row.kind !== undefined ? { kind: row.kind } : {}),
          ...(row.documentNumber !== undefined ? { documentNumber: row.documentNumber } : {}),
          ...(row.issuingCountry !== undefined ? { issuingCountry: row.issuingCountry } : {}),
          issuer: row.issuer,
          issuedOn: row.issuedOn,
          expiresOn: row.expiresOn,
          notes: row.notes,
          createdByApprovalId: row.createdByApprovalId,
          ...(row.isActive !== undefined ? { isActive: row.isActive } : {}),
        })
        .returning();
      return mapCredential(r);
    },

    async getCredentialByCreatingApproval(approvalId: string): Promise<Credential | null> {
      const rows = await db
        .select()
        .from(schema.credential)
        .where(eq(schema.credential.createdByApprovalId, approvalId))
        .limit(1);
      return rows[0] ? mapCredential(rows[0]) : null;
    },

    async deactivateCredential(credentialId: string): Promise<Credential | null> {
      const rows = await db
        .update(schema.credential)
        .set({ isActive: false, version: sql`${schema.credential.version} + 1` })
        .where(and(eq(schema.credential.credentialId, credentialId), eq(schema.credential.isActive, true)))
        .returning();
      return rows[0] ? mapCredential(rows[0]) : null;
    },

    async reactivateCredential(credentialId: string): Promise<Credential | null> {
      const rows = await db
        .update(schema.credential)
        .set({ isActive: true, version: sql`${schema.credential.version} + 1` })
        .where(and(eq(schema.credential.credentialId, credentialId), eq(schema.credential.isActive, false)))
        .returning();
      return rows[0] ? mapCredential(rows[0]) : null;
    },

    // ── Sprint 37 journeys — drizzle-only (mode:'string' dates). ──────────────
    async insertJourney(row: NewJourneyRow): Promise<Journey> {
      const [r] = await db
        .insert(schema.journey)
        .values({
          tenantId,
          journeyId: row.journeyId,
          personId: row.personId,
          journeyType: row.journeyType,
          title: row.title,
          startedOn: row.startedOn,
          notes: row.notes,
          createdByApprovalId: row.createdByApprovalId,
        })
        .returning();
      return mapJourney(r);
    },

    async getJourneyByCreatingApproval(approvalId: string): Promise<Journey | null> {
      const rows = await db
        .select()
        .from(schema.journey)
        .where(eq(schema.journey.createdByApprovalId, approvalId))
        .limit(1);
      return rows[0] ? mapJourney(rows[0]) : null;
    },

    async getJourney(journeyId: string): Promise<Journey | null> {
      const rows = await db.select().from(schema.journey).where(eq(schema.journey.journeyId, journeyId)).limit(1);
      return rows[0] ? mapJourney(rows[0]) : null;
    },

    async transitionJourney(
      journeyId: string,
      expectedVersion: number,
      allowedFrom: readonly JourneyStatus[],
      patch: { status: JourneyStatus; endedOn: string | null },
    ): Promise<Journey | null> {
      const rows = await db
        .update(schema.journey)
        .set({ status: patch.status, endedOn: patch.endedOn, version: sql`${schema.journey.version} + 1` })
        .where(
          and(
            eq(schema.journey.journeyId, journeyId),
            eq(schema.journey.version, expectedVersion),
            inArray(schema.journey.status, [...allowedFrom]),
          ),
        )
        .returning();
      return rows[0] ? mapJourney(rows[0]) : null;
    },

    // ── Sprint 38 equipment (direct CRUD; drizzle-only) ────────────────────────
    async insertKit(kitId: string, row: NewEquipmentRow): Promise<Kit> {
      const [r] = await db.insert(schema.kit).values({ tenantId, kitId, ...row }).returning();
      return mapKit(r);
    },

    async getKit(kitId: string): Promise<Kit | null> {
      const rows = await db.select().from(schema.kit).where(eq(schema.kit.kitId, kitId)).limit(1);
      return rows[0] ? mapKit(rows[0]) : null;
    },

    async updateKit(kitId: string, expectedVersion: number, patch: EquipmentPatch): Promise<Kit | null> {
      const rows = await db
        .update(schema.kit)
        .set({ ...patch, version: sql`${schema.kit.version} + 1` })
        .where(and(eq(schema.kit.kitId, kitId), eq(schema.kit.version, expectedVersion)))
        .returning();
      return rows[0] ? mapKit(rows[0]) : null;
    },

    async deactivateKit(kitId: string, expectedVersion: number): Promise<Kit | null> {
      const rows = await db
        .update(schema.kit)
        .set({ isActive: false, version: sql`${schema.kit.version} + 1` })
        .where(and(eq(schema.kit.kitId, kitId), eq(schema.kit.version, expectedVersion), eq(schema.kit.isActive, true)))
        .returning();
      return rows[0] ? mapKit(rows[0]) : null;
    },

    async reactivateKit(kitId: string, expectedVersion: number): Promise<Kit | null> {
      const rows = await db
        .update(schema.kit)
        .set({ isActive: true, version: sql`${schema.kit.version} + 1` })
        .where(and(eq(schema.kit.kitId, kitId), eq(schema.kit.version, expectedVersion), eq(schema.kit.isActive, false)))
        .returning();
      return rows[0] ? mapKit(rows[0]) : null;
    },

    async setKitStatus(kitId: string, expectedVersion: number, status: string): Promise<Kit | null> {
      const rows = await db
        .update(schema.kit)
        .set({ status, version: sql`${schema.kit.version} + 1` })
        .where(and(eq(schema.kit.kitId, kitId), eq(schema.kit.version, expectedVersion)))
        .returning();
      return rows[0] ? mapKit(rows[0]) : null;
    },

    async insertApparel(apparelId: string, row: NewEquipmentRow): Promise<Apparel> {
      const [r] = await db.insert(schema.apparel).values({ tenantId, apparelId, ...row }).returning();
      return mapApparel(r);
    },

    async getApparel(apparelId: string): Promise<Apparel | null> {
      const rows = await db.select().from(schema.apparel).where(eq(schema.apparel.apparelId, apparelId)).limit(1);
      return rows[0] ? mapApparel(rows[0]) : null;
    },

    async updateApparel(apparelId: string, expectedVersion: number, patch: EquipmentPatch): Promise<Apparel | null> {
      const rows = await db
        .update(schema.apparel)
        .set({ ...patch, version: sql`${schema.apparel.version} + 1` })
        .where(and(eq(schema.apparel.apparelId, apparelId), eq(schema.apparel.version, expectedVersion)))
        .returning();
      return rows[0] ? mapApparel(rows[0]) : null;
    },

    async deactivateApparel(apparelId: string, expectedVersion: number): Promise<Apparel | null> {
      const rows = await db
        .update(schema.apparel)
        .set({ isActive: false, version: sql`${schema.apparel.version} + 1` })
        .where(and(eq(schema.apparel.apparelId, apparelId), eq(schema.apparel.version, expectedVersion), eq(schema.apparel.isActive, true)))
        .returning();
      return rows[0] ? mapApparel(rows[0]) : null;
    },

    async reactivateApparel(apparelId: string, expectedVersion: number): Promise<Apparel | null> {
      const rows = await db
        .update(schema.apparel)
        .set({ isActive: true, version: sql`${schema.apparel.version} + 1` })
        .where(and(eq(schema.apparel.apparelId, apparelId), eq(schema.apparel.version, expectedVersion), eq(schema.apparel.isActive, false)))
        .returning();
      return rows[0] ? mapApparel(rows[0]) : null;
    },

    async setApparelStatus(apparelId: string, expectedVersion: number, status: string): Promise<Apparel | null> {
      const rows = await db
        .update(schema.apparel)
        .set({ status, version: sql`${schema.apparel.version} + 1` })
        .where(and(eq(schema.apparel.apparelId, apparelId), eq(schema.apparel.version, expectedVersion)))
        .returning();
      return rows[0] ? mapApparel(rows[0]) : null;
    },

    // ── S48 entities (direct-audited; the tenant's legal operating entities) ──
    async insertEntity(entityId: string, row: NewEntityRow): Promise<Entity> {
      const [r] = await db.insert(schema.entity).values({ tenantId, entityId, ...row }).returning();
      return mapEntity(r);
    },

    async getEntity(entityId: string): Promise<Entity | null> {
      const rows = await db.select().from(schema.entity).where(eq(schema.entity.entityId, entityId)).limit(1);
      return rows[0] ? mapEntity(rows[0]) : null;
    },

    async updateEntity(entityId: string, expectedVersion: number, patch: EntityPatch): Promise<Entity | null> {
      const rows = await db
        .update(schema.entity)
        .set({ ...patch, version: sql`${schema.entity.version} + 1` })
        .where(and(eq(schema.entity.entityId, entityId), eq(schema.entity.version, expectedVersion)))
        .returning();
      return rows[0] ? mapEntity(rows[0]) : null;
    },

    async deactivateEntity(entityId: string, expectedVersion: number): Promise<Entity | null> {
      const rows = await db
        .update(schema.entity)
        .set({ isActive: false, version: sql`${schema.entity.version} + 1` })
        .where(and(eq(schema.entity.entityId, entityId), eq(schema.entity.version, expectedVersion), eq(schema.entity.isActive, true)))
        .returning();
      return rows[0] ? mapEntity(rows[0]) : null;
    },

    async reactivateEntity(entityId: string, expectedVersion: number): Promise<Entity | null> {
      const rows = await db
        .update(schema.entity)
        .set({ isActive: true, version: sql`${schema.entity.version} + 1` })
        .where(and(eq(schema.entity.entityId, entityId), eq(schema.entity.version, expectedVersion), eq(schema.entity.isActive, false)))
        .returning();
      return rows[0] ? mapEntity(rows[0]) : null;
    },

    async upsertFxRate(currency: string, usdPerUnit: number): Promise<FxRate> {
      const [r] = await db
        .insert(schema.fxRate)
        .values({ tenantId, currency, usdPerUnit: String(usdPerUnit) })
        .onConflictDoUpdate({
          target: [schema.fxRate.tenantId, schema.fxRate.currency],
          set: { usdPerUnit: String(usdPerUnit), updatedAt: sql`now()` },
        })
        .returning();
      return mapFxRate(r);
    },

    // ── Sprint 39 missions (shell = drizzle-only; participants joined with the
    //    person's display name for the domain view) ────────────────────────────
    async insertMission(missionId: string, row: NewMissionRow): Promise<Mission> {
      const [r] = await db.insert(schema.mission).values({ tenantId, missionId, ...row }).returning();
      return mapMission(r);
    },

    async getMission(missionId: string): Promise<Mission | null> {
      const rows = await db.select().from(schema.mission).where(eq(schema.mission.missionId, missionId)).limit(1);
      return rows[0] ? mapMission(rows[0]) : null;
    },
    // H-04: lock the mission HEAD. Settlement and every finance-child mutation
    // resolve the mission through here, so they share ONE lock order (mission
    // row first) — a concurrent income-line insert can no longer race a
    // settlement (row locks can't lock a future insert; the head lock can).
    async getMissionForUpdate(missionId: string): Promise<Mission | null> {
      const rows = await db.select().from(schema.mission).where(eq(schema.mission.missionId, missionId)).limit(1).for('update');
      return rows[0] ? mapMission(rows[0]) : null;
    },

    async updateMission(missionId: string, expectedVersion: number, patch: MissionPatch): Promise<Mission | null> {
      const rows = await db
        .update(schema.mission)
        .set({ ...patch, version: sql`${schema.mission.version} + 1` })
        .where(and(eq(schema.mission.missionId, missionId), eq(schema.mission.version, expectedVersion)))
        .returning();
      return rows[0] ? mapMission(rows[0]) : null;
    },

    async deactivateMission(missionId: string, expectedVersion: number): Promise<Mission | null> {
      const rows = await db
        .update(schema.mission)
        .set({ isActive: false, version: sql`${schema.mission.version} + 1` })
        .where(and(eq(schema.mission.missionId, missionId), eq(schema.mission.version, expectedVersion), eq(schema.mission.isActive, true)))
        .returning();
      return rows[0] ? mapMission(rows[0]) : null;
    },

    // Lock ONLY the participant row (FOR UPDATE OF mp): the person join is a
    // display read and must not serialise unrelated person writes.
    getParticipantForUpdate: (missionId, personId) => readParticipantView(missionId, personId, true),

    getParticipant: (missionId, personId) => readParticipantView(missionId, personId),

    async insertParticipant(missionId: string, personId: string, role: string): Promise<MissionParticipant> {
      // The composite FKs authoritatively require the mission and the person;
      // the UNIQUE pair constraint turns a concurrent duplicate into 23505.
      await db.insert(schema.missionParticipant).values({ tenantId, missionId, personId, role });
      const created = await readParticipantView(missionId, personId);
      if (!created) throw new Error('participant insert did not persist');
      return created;
    },

    async reactivateParticipant(missionId: string, personId: string, role: string): Promise<MissionParticipant | null> {
      const rows = await db
        .update(schema.missionParticipant)
        .set({ role, isActive: true, version: sql`${schema.missionParticipant.version} + 1` })
        .where(
          and(
            eq(schema.missionParticipant.missionId, missionId),
            eq(schema.missionParticipant.personId, personId),
            eq(schema.missionParticipant.isActive, false),
          ),
        )
        .returning();
      return rows[0] ? readParticipantView(missionId, personId) : null;
    },

    async deactivateParticipant(missionId: string, personId: string): Promise<MissionParticipant | null> {
      const rows = await db
        .update(schema.missionParticipant)
        .set({ isActive: false, version: sql`${schema.missionParticipant.version} + 1` })
        .where(
          and(
            eq(schema.missionParticipant.missionId, missionId),
            eq(schema.missionParticipant.personId, personId),
            eq(schema.missionParticipant.isActive, true),
          ),
        )
        .returning();
      return rows[0] ? readParticipantView(missionId, personId) : null;
    },

    async setParticipantPerDiem(
      missionId: string,
      personId: string,
      amountMinor: number | null,
      currency: string | null,
      expectedVersion: number,
    ): Promise<MissionParticipant | null> {
      // HARDEN-2 M-03: version-guarded AND active-guarded — a per-diem write
      // can no longer race a roster removal or clobber a concurrent edit.
      const rows = await db
        .update(schema.missionParticipant)
        .set({ perDiemAmountMinor: amountMinor, perDiemCurrency: currency, version: sql`${schema.missionParticipant.version} + 1` })
        .where(
          and(
            eq(schema.missionParticipant.missionId, missionId),
            eq(schema.missionParticipant.personId, personId),
            eq(schema.missionParticipant.version, expectedVersion),
            eq(schema.missionParticipant.isActive, true),
          ),
        )
        .returning();
      return rows[0] ? readParticipantView(missionId, personId) : null;
    },
    // ── Finance S4 mission lines (direct-audited; soft removal) ──────────────
    async insertMissionLine(row: NewMissionLineRow): Promise<MissionLine> {
      const [r] = await db.insert(schema.missionLine).values({ tenantId, ...row }).returning();
      return mapMissionLine(r);
    },

    async getMissionLine(lineId: string): Promise<MissionLine | null> {
      const rows = await db
        .select()
        .from(schema.missionLine)
        .where(and(eq(schema.missionLine.lineId, lineId), eq(schema.missionLine.isActive, true)))
        .limit(1);
      return rows[0] ? mapMissionLine(rows[0]) : null;
    },

    async updateMissionLine(lineId: string, expectedVersion: number, patch: MissionLinePatch): Promise<MissionLine | null> {
      const rows = await db
        .update(schema.missionLine)
        .set({ ...patch, version: sql`${schema.missionLine.version} + 1` })
        .where(
          and(
            eq(schema.missionLine.lineId, lineId),
            eq(schema.missionLine.version, expectedVersion),
            eq(schema.missionLine.isActive, true),
          ),
        )
        .returning();
      return rows[0] ? mapMissionLine(rows[0]) : null;
    },

    async deactivateMissionLine(lineId: string, expectedVersion: number): Promise<MissionLine | null> {
      const rows = await db
        .update(schema.missionLine)
        .set({ isActive: false, version: sql`${schema.missionLine.version} + 1` })
        .where(
          and(
            eq(schema.missionLine.lineId, lineId),
            eq(schema.missionLine.version, expectedVersion),
            eq(schema.missionLine.isActive, true),
          ),
        )
        .returning();
      return rows[0] ? mapMissionLine(rows[0]) : null;
    },

    // ── S2 mission finance: payment, budgets, lifecycle ───────────────────────
    async setMissionLinePayment(lineId: string, expectedVersion: number, patch: MissionLinePaymentPatch): Promise<MissionLine | null> {
      const rows = await db
        .update(schema.missionLine)
        .set({
          paymentStatus: patch.paymentStatus,
          receivedAmountMinor: patch.receivedAmountMinor,
          receivedUsdPerUnit: patch.receivedUsdPerUnit === null ? null : String(patch.receivedUsdPerUnit),
          paymentSourceLabel: patch.paymentSourceLabel,
          refNo: patch.refNo,
          version: sql`${schema.missionLine.version} + 1`,
        })
        .where(
          and(
            eq(schema.missionLine.lineId, lineId),
            eq(schema.missionLine.version, expectedVersion),
            eq(schema.missionLine.isActive, true),
          ),
        )
        .returning();
      return rows[0] ? mapMissionLine(rows[0]) : null;
    },

    // HARDEN-2 M-03: budgets are no longer last-write-wins. The use case reads
    // the cell inside this tx, then inserts (empty cell) or updates/deletes
    // under a version predicate — a stale caller gets a concurrency refusal.
    async getMissionBudget(missionId: string, direction: string, category: string, currency: string): Promise<MissionBudget | null> {
      const rows = await db
        .select()
        .from(schema.missionBudget)
        .where(
          and(
            eq(schema.missionBudget.missionId, missionId),
            eq(schema.missionBudget.direction, direction),
            eq(schema.missionBudget.category, category),
            eq(schema.missionBudget.currency, currency),
          ),
        )
        .limit(1);
      return rows[0] ? mapMissionBudget(rows[0]) : null;
    },

    async insertMissionBudget(missionId: string, direction: string, category: string, currency: string, amountMinor: number): Promise<MissionBudget | null> {
      // Plain insert — a concurrent creator hits the UNIQUE cell key (23505),
      // which the caller surfaces as a concurrency refusal, never a clobber.
      try {
        const [r] = await db
          .insert(schema.missionBudget)
          .values({ tenantId, missionId, direction, category, currency, amountMinor })
          .returning();
        return mapMissionBudget(r);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return null;
        throw e;
      }
    },

    async updateMissionBudget(missionId: string, direction: string, category: string, currency: string, expectedVersion: number, amountMinor: number): Promise<MissionBudget | null> {
      const rows = await db
        .update(schema.missionBudget)
        .set({ amountMinor, version: sql`${schema.missionBudget.version} + 1`, updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.missionBudget.missionId, missionId),
            eq(schema.missionBudget.direction, direction),
            eq(schema.missionBudget.category, category),
            eq(schema.missionBudget.currency, currency),
            eq(schema.missionBudget.version, expectedVersion),
          ),
        )
        .returning();
      return rows[0] ? mapMissionBudget(rows[0]) : null;
    },

    async deleteMissionBudget(missionId: string, direction: string, category: string, currency: string, expectedVersion: number): Promise<boolean> {
      const rows = await db
        .delete(schema.missionBudget)
        .where(
          and(
            eq(schema.missionBudget.missionId, missionId),
            eq(schema.missionBudget.direction, direction),
            eq(schema.missionBudget.category, category),
            eq(schema.missionBudget.currency, currency),
            eq(schema.missionBudget.version, expectedVersion),
          ),
        )
        .returning();
      return rows.length > 0;
    },

    async setMissionFinanceStage(missionId: string, expectedVersion: number, stage: string): Promise<Mission | null> {
      const rows = await db
        .update(schema.mission)
        .set({ financeStage: stage, version: sql`${schema.mission.version} + 1` })
        .where(and(eq(schema.mission.missionId, missionId), eq(schema.mission.version, expectedVersion)))
        .returning();
      return rows[0] ? mapMission(rows[0]) : null;
    },

    // ── Sprint 41 agreements (drizzle-only; mode:'string' dates, cents int) ──
    async insertAgreement(row: NewAgreementRow): Promise<Agreement> {
      const [r] = await db.insert(schema.agreement).values({ tenantId, ...row }).returning();
      return mapAgreement(r);
    },

    async getAgreement(agreementId: string): Promise<Agreement | null> {
      const rows = await db.select().from(schema.agreement).where(eq(schema.agreement.agreementId, agreementId)).limit(1);
      return rows[0] ? mapAgreement(rows[0]) : null;
    },

    async getAgreementByCreatingApproval(approvalId: string): Promise<Agreement | null> {
      const rows = await db
        .select()
        .from(schema.agreement)
        .where(eq(schema.agreement.createdByApprovalId, approvalId))
        .limit(1);
      return rows[0] ? mapAgreement(rows[0]) : null;
    },

    async renewAgreement(agreementId: string, newEndsOn: string): Promise<Agreement | null> {
      // Statement-level guard: Active AND the new end still beats the stored
      // one (a renewal that landed in between makes this a no-op → null).
      const rows = await db
        .update(schema.agreement)
        .set({ endsOn: newEndsOn, version: sql`${schema.agreement.version} + 1` })
        .where(
          and(
            eq(schema.agreement.agreementId, agreementId),
            eq(schema.agreement.status, 'Active'),
            lt(schema.agreement.endsOn, newEndsOn),
          ),
        )
        .returning();
      return rows[0] ? mapAgreement(rows[0]) : null;
    },

    async terminateAgreement(agreementId: string): Promise<Agreement | null> {
      const rows = await db
        .update(schema.agreement)
        .set({ status: 'Terminated', version: sql`${schema.agreement.version} + 1` })
        .where(and(eq(schema.agreement.agreementId, agreementId), eq(schema.agreement.status, 'Active')))
        .returning();
      return rows[0] ? mapAgreement(rows[0]) : null;
    },

    async updateAgreement(agreementId: string, expectedVersion: number, patch: AgreementPatch): Promise<Agreement | null> {
      const rows = await db
        .update(schema.agreement)
        .set({ ...patch, version: sql`${schema.agreement.version} + 1` })
        .where(and(eq(schema.agreement.agreementId, agreementId), eq(schema.agreement.version, expectedVersion)))
        .returning();
      return rows[0] ? mapAgreement(rows[0]) : null;
    },

    // ── S4 documents (metadata; bytes live in object storage) ────────────────
    async insertDocument(row: NewDocumentRow): Promise<C3Document> {
      const [r] = await db.insert(schema.document).values({ tenantId, ...row }).returning();
      return mapDocument(r);
    },

    async getDocument(documentId: string): Promise<C3Document | null> {
      const rows = await db
        .select()
        .from(schema.document)
        .where(and(eq(schema.document.documentId, documentId), eq(schema.document.isActive, true)))
        .limit(1);
      return rows[0] ? mapDocument(rows[0]) : null;
    },

    async deactivateDocument(documentId: string, expectedVersion: number): Promise<C3Document | null> {
      const rows = await db
        .update(schema.document)
        .set({ isActive: false, version: sql`${schema.document.version} + 1` })
        .where(
          and(
            eq(schema.document.documentId, documentId),
            eq(schema.document.version, expectedVersion),
            eq(schema.document.isActive, true),
          ),
        )
        .returning();
      return rows[0] ? mapDocument(rows[0]) : null;
    },

    // ── S6 invoices (direct-audited; numbers never reused) ───────────────────
    async insertInvoice(row: NewInvoiceRow): Promise<Invoice> {
      const [r] = await db.insert(schema.invoice).values({ tenantId, status: 'Issued', ...row }).returning();
      return mapInvoice(r);
    },

    async getInvoice(invoiceId: string): Promise<Invoice | null> {
      const rows = await db.select().from(schema.invoice).where(eq(schema.invoice.invoiceId, invoiceId)).limit(1);
      return rows[0] ? mapInvoice(rows[0]) : null;
    },

    async voidInvoice(invoiceId: string, expectedVersion: number, reason: string): Promise<Invoice | null> {
      const rows = await db
        .update(schema.invoice)
        .set({ status: 'Voided', voidedReason: reason, version: sql`${schema.invoice.version} + 1` })
        .where(
          and(
            eq(schema.invoice.invoiceId, invoiceId),
            eq(schema.invoice.version, expectedVersion),
            eq(schema.invoice.status, 'Issued'),
          ),
        )
        .returning();
      return rows[0] ? mapInvoice(rows[0]) : null;
    },

    async setInvoiceDocument(invoiceId: string, expectedVersion: number, documentId: string): Promise<Invoice | null> {
      const rows = await db
        .update(schema.invoice)
        .set({ documentId, version: sql`${schema.invoice.version} + 1` })
        .where(and(eq(schema.invoice.invoiceId, invoiceId), eq(schema.invoice.version, expectedVersion)))
        .returning();
      return rows[0] ? mapInvoice(rows[0]) : null;
    },

    // ── S10 notifications (L2 rows; UNIQUE dedupe; no deletes) ───────────────
    async insertNotification(row: { userIdentity: string; signalKey: string; kind: string; title: string; link: string }): Promise<boolean> {
      const res = await db.execute(sql`
        INSERT INTO notification (tenant_id, user_identity, signal_key, kind, title, link)
        VALUES (${tenantId}, ${row.userIdentity}, ${row.signalKey}, ${row.kind}, ${row.title}, ${row.link})
        ON CONFLICT (tenant_id, user_identity, signal_key) DO NOTHING
        RETURNING id
      `);
      return res.rows.length > 0;
    },

    async insertComment(row: { subjectType: string; subjectId: string; author: string; body: string; mentions: readonly string[] }): Promise<Comment> {
      const [r] = await db
        .insert(schema.comment)
        .values({ tenantId, subjectType: row.subjectType, subjectId: row.subjectId, author: row.author, body: row.body, mentions: [...row.mentions] })
        .returning();
      return mapComment(r);
    },

    // ── Track B6 guest intake (staff side) ───────────────────────────────────
    async insertIntakeLink(row: { tokenHash: string; kind: string; label: string | null; createdBy: string; expiresAt: string; maxUses: number }): Promise<IntakeLink> {
      const [r] = await db
        .insert(schema.intakeLink)
        .values({ tenantId, tokenHash: row.tokenHash, kind: row.kind, label: row.label, createdBy: row.createdBy, expiresAt: new Date(row.expiresAt), maxUses: row.maxUses })
        .returning();
      return mapIntakeLink(r);
    },

    async getIntakeLink(linkId: string): Promise<IntakeLink | null> {
      const rows = await db.select().from(schema.intakeLink).where(eq(schema.intakeLink.id, linkId)).limit(1);
      return rows[0] ? mapIntakeLink(rows[0]) : null;
    },

    async revokeIntakeLink(linkId: string): Promise<IntakeLink | null> {
      const rows = await db
        .update(schema.intakeLink)
        .set({ status: 'Revoked' })
        .where(and(eq(schema.intakeLink.id, linkId), eq(schema.intakeLink.status, 'Active')))
        .returning();
      return rows[0] ? mapIntakeLink(rows[0]) : null;
    },

    async getIntakeSubmission(submissionId: string): Promise<IntakeSubmission | null> {
      const rows = await db.select().from(schema.intakeSubmission).where(eq(schema.intakeSubmission.id, submissionId)).limit(1);
      return rows[0] ? mapIntakeSubmission(rows[0]) : null;
    },

    async markIntakeSubmissionPromoted(submissionId: string, reviewedBy: string, approvalId: string, decisionNote: string | null): Promise<IntakeSubmission | null> {
      const rows = await db
        .update(schema.intakeSubmission)
        .set({ status: 'Promoted', reviewedBy, reviewedAt: new Date(), promotedApprovalId: approvalId, decisionNote })
        .where(and(eq(schema.intakeSubmission.id, submissionId), eq(schema.intakeSubmission.status, 'Pending')))
        .returning();
      return rows[0] ? mapIntakeSubmission(rows[0]) : null;
    },

    async markIntakeSubmissionRejected(submissionId: string, reviewedBy: string, decisionNote: string | null): Promise<IntakeSubmission | null> {
      const rows = await db
        .update(schema.intakeSubmission)
        // Scrub payload AND upload metadata (filenames can be PII) — wipe-on-reject.
        // The CHECK forbids a Rejected row with a surviving payload; the API
        // separately deletes the quarantined blobs.
        .set({ status: 'Rejected', reviewedBy, reviewedAt: new Date(), payload: null, uploads: [], decisionNote })
        .where(and(eq(schema.intakeSubmission.id, submissionId), eq(schema.intakeSubmission.status, 'Pending')))
        .returning();
      return rows[0] ? mapIntakeSubmission(rows[0]) : null;
    },

    async setIntakeSubmissionPromotedPerson(submissionId: string, personId: string): Promise<IntakeSubmission | null> {
      const rows = await db
        .update(schema.intakeSubmission)
        .set({ promotedPersonId: personId })
        .where(and(eq(schema.intakeSubmission.id, submissionId), eq(schema.intakeSubmission.status, 'Promoted')))
        .returning();
      return rows[0] ? mapIntakeSubmission(rows[0]) : null;
    },

    // ── M-02 → HARDEN-3.5 B: the compensation STATE MACHINE on blob_tombstone ───────────────
    // prepared (pre-PUT, NOT drainable) → armed (failure/TTL ⇒ drainable) → resolved/swept
    // (terminal). Every transition carries a full prior-state predicate and rowCount === 1 —
    // zero rows THROWS (no silent no-ops; a zombie registration must abort, never commit
    // metadata over swept bytes).
    async insertBlobTombstone(input: {
      storageKey: string;
      blobClass: 'document' | 'photo' | 'intake';
      reason: 'intake_reject' | 'compensation' | 'quarantine_cleanup';
      /** compensation only: 'prepared' (pre-PUT; requires preparedTtlMs) or 'armed' (a KNOWN orphan, e.g. the redundant quarantine copy). Default 'prepared'. */
      state?: 'prepared' | 'armed';
      /** prepared only: the TTL after which a drain may arm this intent (deadlineMs × 2). */
      preparedTtlMs?: number;
    }): Promise<void> {
      // B: CLASS-SPECIFIC namespace discipline (round-6 §6 tail) — a document/photo key lives
      // under `${tenantId}/…` and NEVER under intake/; an intake key lives under
      // `intake/${tenantId}/…`. Path traversal always refuses.
      const key = input.storageKey;
      const requiredPrefix = input.blobClass === 'intake' ? `intake/${tenantId}/` : `${tenantId}/`;
      if (key.includes('..') || !key.startsWith(requiredPrefix)) {
        throw new Error(`Refusing a ${input.blobClass} tombstone for '${key}': outside the class namespace '${requiredPrefix}'.`);
      }
      if (input.reason === 'compensation' || input.reason === 'quarantine_cleanup') {
        // quarantine_cleanup is a SECOND episode for a key whose upload episode already resolved
        // (unique per (tenant, key, reason)) — always armed-at-birth (the copy is a known orphan).
        const state = input.reason === 'quarantine_cleanup' ? 'armed' : (input.state ?? 'prepared');
        // NO ON CONFLICT: compensation keys are fresh UUID paths — a duplicate is a bug and
        // must SURFACE (the old DO NOTHING silently ignored its row count).
        if (state === 'prepared') {
          const ttl = input.preparedTtlMs;
          if (!ttl || !Number.isInteger(ttl) || ttl <= 0) {
            throw new Error('a prepared compensation intent requires a positive integer preparedTtlMs');
          }
          await db.execute(sql`
            INSERT INTO blob_tombstone (tenant_ref, storage_key, blob_class, reason, state, prepared_expires_at)
            VALUES (${tenantId}, ${key}, ${input.blobClass}, 'compensation', 'prepared', now() + make_interval(secs => ${ttl} / 1000.0))
          `);
        } else {
          await db.execute(sql`
            INSERT INTO blob_tombstone (tenant_ref, storage_key, blob_class, reason, state)
            VALUES (${tenantId}, ${key}, ${input.blobClass}, ${input.reason}, 'armed')
          `);
        }
      } else {
        // The legacy reject path stays armed-at-birth and idempotent per key (a re-reject of
        // the same submission legitimately re-records the same keys).
        await db.execute(sql`
          INSERT INTO blob_tombstone (tenant_ref, storage_key, blob_class, reason, state)
          VALUES (${tenantId}, ${key}, ${input.blobClass}, ${input.reason}, 'armed')
          ON CONFLICT (tenant_ref, storage_key, reason) DO NOTHING
        `);
      }
    },

    // B: prepared → resolved, IN the owning row's transaction. rowCount === 1 is LOAD-BEARING:
    // zero rows means the drain TTL-armed (and possibly swept) this intent — the request blew
    // its deadline — so the registration MUST abort rather than commit metadata over swept
    // bytes (this closes R6-N01's second ordering, and makes the old false "zero-row raises"
    // claim true for real).
    async resolveCompensationIntent(storageKey: string): Promise<void> {
      const res = await db.execute(sql`
        UPDATE blob_tombstone SET state = 'resolved', deleted_at = now()
         WHERE tenant_ref = ${tenantId} AND storage_key = ${storageKey}
           AND reason = 'compensation' AND state = 'prepared'
        RETURNING id
      `);
      if (res.rows.length !== 1) {
        throw new Error(
          `Compensation intent for '${storageKey}' could not be resolved (expected 1 prepared row, matched ${res.rows.length}) — ` +
            'the intent was never prepared, or the drain already armed/swept it (the request outlived its deadline). Registration aborted.',
        );
      }
    },

    // B: prepared → armed (the owning request's failure path — the byte is now a confirmed
    // orphan the drain must sweep). Zero rows THROWS: the intent was never prepared or was
    // already TTL-armed; either way the caller's failure handling must know.
    async armCompensationIntent(storageKey: string): Promise<void> {
      const res = await db.execute(sql`
        UPDATE blob_tombstone SET state = 'armed'
         WHERE tenant_ref = ${tenantId} AND storage_key = ${storageKey}
           AND reason = 'compensation' AND state = 'prepared'
        RETURNING id
      `);
      if (res.rows.length !== 1) {
        throw new Error(`Compensation intent for '${storageKey}' could not be armed (expected 1 prepared row, matched ${res.rows.length}).`);
      }
    },

    // B: the drain's TTL sweep — prepared rows whose request is PROVABLY DEAD (the expiry is
    // deadline×2 past arrival) become armed. Set-based; any count is legal.
    async armExpiredPreparedIntents(): Promise<number> {
      const res = await db.execute(sql`
        UPDATE blob_tombstone SET state = 'armed'
         WHERE tenant_ref = ${tenantId} AND reason = 'compensation'
           AND state = 'prepared' AND prepared_expires_at < now()
        RETURNING id
      `);
      return res.rows.length;
    },

    // B §4: bounded terminal-row retention via the 0076 definer (c3_app has no DELETE).
    async purgeTerminalTombstones(olderThanDays: number): Promise<number> {
      const res = await db.execute(sql`SELECT blob_tombstone_purge_terminal(${olderThanDays}) AS n`);
      return Number((res.rows[0] as { n?: number | string } | undefined)?.n ?? 0);
    },

    async resolveBlobTombstone(id: string, outcome: { deleted: boolean; error?: string }): Promise<void> {
      if (outcome.deleted) {
        // armed → swept (terminal). Zero rows is tolerated HERE AND ONLY HERE: a concurrent
        // drain raced us to the same armed row — both verified the deletion, one recorded it.
        await db.execute(sql`
          UPDATE blob_tombstone SET state = 'swept', deleted_at = now(), attempts = attempts + 1
           WHERE id = ${id} AND state = 'armed'
        `);
      } else {
        await db.execute(sql`UPDATE blob_tombstone SET attempts = attempts + 1, last_error = ${(outcome.error ?? 'delete failed').slice(0, 500)} WHERE id = ${id}`);
      }
    },

    // ── Track B recurring subscriptions (direct-audited register) ────────────
    async insertSubscription(subscriptionId: string, row: NewSubscriptionRow): Promise<Subscription> {
      const [r] = await db.insert(schema.subscription).values({ tenantId, subscriptionId, ...row }).returning();
      return mapSubscription(r);
    },

    async getSubscription(subscriptionId: string): Promise<Subscription | null> {
      const rows = await db.select().from(schema.subscription).where(eq(schema.subscription.subscriptionId, subscriptionId)).limit(1);
      return rows[0] ? mapSubscription(rows[0]) : null;
    },

    async updateSubscription(subscriptionId: string, expectedVersion: number, patch: SubscriptionPatch): Promise<Subscription | null> {
      const rows = await db
        .update(schema.subscription)
        .set({ ...patch, version: sql`${schema.subscription.version} + 1` })
        .where(and(eq(schema.subscription.subscriptionId, subscriptionId), eq(schema.subscription.version, expectedVersion)))
        .returning();
      return rows[0] ? mapSubscription(rows[0]) : null;
    },

    async setSubscriptionStatus(subscriptionId: string, expectedVersion: number, status: string): Promise<Subscription | null> {
      const rows = await db
        .update(schema.subscription)
        .set({ status, version: sql`${schema.subscription.version} + 1` })
        .where(and(eq(schema.subscription.subscriptionId, subscriptionId), eq(schema.subscription.version, expectedVersion)))
        .returning();
      return rows[0] ? mapSubscription(rows[0]) : null;
    },

    // ── Track B saved views (per-user; owner-scoped; not audited) ────────────
    async insertSavedView(row: NewSavedViewRow): Promise<SavedView> {
      const [r] = await db
        .insert(schema.savedView)
        .values({ tenantId, userIdentity: row.userIdentity, register: row.register, name: row.name, state: row.state })
        .returning();
      return mapSavedView(r);
    },

    async updateSavedView(id: string, userIdentity: string, patch: SavedViewPatch): Promise<SavedView | null> {
      const rows = await db
        .update(schema.savedView)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.state !== undefined ? { state: patch.state } : {}),
          version: sql`${schema.savedView.version} + 1`,
        })
        // Owner-scoped: a user can only touch their own view (RLS covers tenant).
        .where(and(eq(schema.savedView.id, id), eq(schema.savedView.userIdentity, userIdentity), eq(schema.savedView.isActive, true)))
        .returning();
      return rows[0] ? mapSavedView(rows[0]) : null;
    },

    async deactivateSavedView(id: string, userIdentity: string): Promise<SavedView | null> {
      const rows = await db
        .update(schema.savedView)
        .set({ isActive: false, version: sql`${schema.savedView.version} + 1` })
        .where(and(eq(schema.savedView.id, id), eq(schema.savedView.userIdentity, userIdentity), eq(schema.savedView.isActive, true)))
        .returning();
      return rows[0] ? mapSavedView(rows[0]) : null;
    },

    // ── Track B departure workflow (direct-audited record) ───────────────────
    async insertDeparture(departureId: string, row: { personId: string; reason: string; initiatedBy: string; initiatedOn: string }): Promise<Departure> {
      const [r] = await db.insert(schema.departure).values({ tenantId, departureId, personId: row.personId, reason: row.reason, initiatedBy: row.initiatedBy, initiatedOn: row.initiatedOn }).returning();
      return mapDeparture(r);
    },

    async getOpenDepartureForPerson(personId: string): Promise<Departure | null> {
      const rows = await db.select().from(schema.departure).where(and(eq(schema.departure.personId, personId), eq(schema.departure.status, 'InProgress'))).limit(1);
      return rows[0] ? mapDeparture(rows[0]) : null;
    },

    async getDeparture(departureId: string): Promise<Departure | null> {
      const rows = await db.select().from(schema.departure).where(eq(schema.departure.departureId, departureId)).limit(1);
      return rows[0] ? mapDeparture(rows[0]) : null;
    },

    async setDepartureStatus(departureId: string, expectedVersion: number, status: string, completedOn: string | null, notes: string | null): Promise<Departure | null> {
      const rows = await db
        .update(schema.departure)
        .set({ status, completedOn, notes, version: sql`${schema.departure.version} + 1` })
        .where(and(eq(schema.departure.departureId, departureId), eq(schema.departure.version, expectedVersion)))
        .returning();
      return rows[0] ? mapDeparture(rows[0]) : null;
    },

    // M-03: complete AND persist the deactivation intent in ONE transaction, so a
    // crash before the governed submit leaves a durable, discoverable follow-up.
    async completeDepartureWithIntent(departureId: string, expectedVersion: number, completedOn: string, notes: string | null, deactivationRequested: boolean): Promise<Departure | null> {
      const rows = await db
        .update(schema.departure)
        .set({ status: 'Completed', completedOn, notes, deactivationRequested, version: sql`${schema.departure.version} + 1` })
        .where(and(eq(schema.departure.departureId, departureId), eq(schema.departure.version, expectedVersion)))
        .returning();
      return rows[0] ? mapDeparture(rows[0]) : null;
    },

    // M-03: link the submitted deactivation approval to the departure WRITE-ONCE —
    // a concurrent drain that already linked one makes this a no-op (no duplicate).
    async linkDepartureDeactivation(departureId: string, approvalId: string): Promise<boolean> {
      const rows = await db
        .update(schema.departure)
        .set({ deactivationApprovalId: approvalId })
        .where(and(eq(schema.departure.departureId, departureId), isNull(schema.departure.deactivationApprovalId)))
        .returning();
      return rows.length > 0;
    },

    // M-06: write-once revision-intent claim on a source approval. ON CONFLICT DO
    // NOTHING against the (tenant, source) unique index — a second concurrent revise
    // of the same source gets null and refuses; that is the fork guard.
    async insertRevisionIntent(intent: NewRevisionIntent): Promise<ApprovalRevision | null> {
      const rows = await db
        .insert(schema.approvalRevision)
        .values({
          tenantId,
          sourceApprovalId: intent.sourceApprovalId,
          operationType: intent.operationType,
          payload: intent.payload,
          reason: intent.reason,
          submittedBy: intent.submittedBy,
        })
        .onConflictDoNothing()
        .returning();
      return rows[0] ? mapApprovalRevision(rows[0]) : null;
    },

    // M-06: complete the intent — record the submitted successor (tx-3).
    async markRevisionCompleted(id: string, submittedApprovalId: string): Promise<void> {
      // R3-N03: predicate the transition on status='Pending' so a losing drainer (a peer
      // already completed this intent) can NEVER overwrite the winner's submitted_approval_id.
      await db
        .update(schema.approvalRevision)
        .set({ status: 'Completed', submittedApprovalId, updatedAt: new Date() })
        .where(and(eq(schema.approvalRevision.id, id), eq(schema.approvalRevision.status, 'Pending')));
    },

    // M-06: abandon the intent — a deterministic refusal (attempt 1) or the transient
    // retry backstop. The source stays Withdrawn; last_error is surfaced to the submitter.
    async markRevisionAbandoned(id: string, lastError: string): Promise<void> {
      await db
        .update(schema.approvalRevision)
        .set({ status: 'Abandoned', lastError, attempts: sql`${schema.approvalRevision.attempts} + 1`, updatedAt: new Date() })
        .where(eq(schema.approvalRevision.id, id));
    },

    // M-06: record a transient (retriable) failure — bump attempts + last_error, stay Pending.
    async bumpRevisionAttempt(id: string, lastError: string): Promise<number> {
      const rows = await db
        .update(schema.approvalRevision)
        .set({ lastError, attempts: sql`${schema.approvalRevision.attempts} + 1`, updatedAt: new Date() })
        .where(eq(schema.approvalRevision.id, id))
        .returning();
      return rows[0] ? Number(rows[0].attempts) : 0;
    },

    async markNotificationRead(identity: string, signalKey: string): Promise<boolean> {
      const rows = await db
        .update(schema.notification)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(schema.notification.userIdentity, identity),
            eq(schema.notification.signalKey, signalKey),
            isNull(schema.notification.readAt),
          ),
        )
        .returning();
      return rows.length > 0;
    },

    async markAllNotificationsRead(identity: string): Promise<number> {
      const rows = await db
        .update(schema.notification)
        .set({ readAt: new Date() })
        .where(and(eq(schema.notification.userIdentity, identity), isNull(schema.notification.readAt)))
        .returning();
      return rows.length;
    },

    // ── Tier 0.5 approver delegation (owner act; rows are history) ───────────
    async insertDelegation(row: {
      delegationId: string;
      granteeIdentity: string;
      grantedBy: string;
      startsOn: string;
      endsOn: string;
      reason: string;
    }): Promise<Delegation> {
      const [r] = await db.insert(schema.delegation).values({ tenantId, ...row }).returning();
      return mapDelegation(r);
    },

    async lockDelegation(delegationId: string): Promise<Delegation | null> {
      const res = await db.execute(sql`SELECT * FROM delegation WHERE delegation_id = ${delegationId} FOR UPDATE`);
      return res.rows[0] ? mapDelegation(res.rows[0]) : null;
    },

    async revokeDelegation(delegationId: string, expectedVersion: number, revokedBy: string, revokeReason: string): Promise<Delegation | null> {
      const rows = await db
        .update(schema.delegation)
        .set({ revokedAt: new Date(), revokedBy, revokeReason, version: expectedVersion + 1 })
        .where(
          and(
            eq(schema.delegation.delegationId, delegationId),
            eq(schema.delegation.version, expectedVersion),
            isNull(schema.delegation.revokedAt),
          ),
        )
        .returning();
      return rows[0] ? mapDelegation(rows[0]) : null;
    },

    async hasActiveDelegation(identity: string, onDate: string): Promise<boolean> {
      const res = await db.execute(sql`
        SELECT 1 FROM delegation
         WHERE grantee_identity = ${identity} AND revoked_at IS NULL
           AND starts_on <= ${onDate} AND ends_on >= ${onDate}
         LIMIT 1
      `);
      return res.rows.length > 0;
    },

    // ── S9 expense claims (lifecycle record; no deletes) ─────────────────────
    async insertClaim(row: NewClaimRow): Promise<Claim> {
      const [r] = await db.insert(schema.claim).values({ tenantId, status: 'Submitted', ...row }).returning();
      return mapClaim(r);
    },

    async getClaim(claimId: string): Promise<Claim | null> {
      const rows = await db.select().from(schema.claim).where(eq(schema.claim.claimId, claimId)).limit(1);
      return rows[0] ? mapClaim(rows[0]) : null;
    },

    async updateClaim(
      claimId: string,
      expectedVersion: number,
      patch: {
        status: string;
        reviewedBy?: string | null;
        rejectionReason?: string | null;
        paidOn?: string | null;
        paymentSourceLabel?: string | null;
        refNo?: string | null;
      },
    ): Promise<Claim | null> {
      const rows = await db
        .update(schema.claim)
        .set({ ...patch, version: sql`${schema.claim.version} + 1` })
        .where(and(eq(schema.claim.claimId, claimId), eq(schema.claim.version, expectedVersion)))
        .returning();
      return rows[0] ? mapClaim(rows[0]) : null;
    },

    // ── S8 distributions (direct-audited; one LIVE per line; no deletes) ─────
    async insertDistribution(row: NewDistributionRow): Promise<Distribution> {
      const [r] = await db.insert(schema.distribution).values({ tenantId, status: 'Live', ...row }).returning();
      return mapDistribution(r);
    },

    async insertDistributionShare(row: NewDistributionShareRow): Promise<void> {
      await db.insert(schema.distributionShare).values({ tenantId, ...row });
    },

    async getDistribution(distributionId: string): Promise<Distribution | null> {
      const rows = await db.select().from(schema.distribution).where(eq(schema.distribution.distributionId, distributionId)).limit(1);
      return rows[0] ? mapDistribution(rows[0]) : null;
    },

    async getDistributionShare(distributionId: string, personId: string): Promise<DistributionShare | null> {
      const res = await db.execute(sql`
        SELECT ds.*, p.full_name AS person_name
          FROM distribution_share ds
          JOIN person p ON p.tenant_id = ds.tenant_id AND p.person_id = ds.person_id
         WHERE ds.distribution_id = ${distributionId} AND ds.person_id = ${personId}
      `);
      const row = res.rows[0];
      return row ? mapDistributionShare(row) : null;
    },

    async listDistributionSharesTx(distributionId: string): Promise<DistributionShare[]> {
      const res = await db.execute(sql`
        SELECT ds.*, p.full_name AS person_name
          FROM distribution_share ds
          JOIN person p ON p.tenant_id = ds.tenant_id AND p.person_id = ds.person_id
         WHERE ds.distribution_id = ${distributionId}
         ORDER BY ds.amount_minor DESC, ds.person_id ASC
      `);
      return res.rows.map(mapDistributionShare);
    },

    async revokeDistribution(distributionId: string, expectedVersion: number, reason: string): Promise<Distribution | null> {
      const rows = await db
        .update(schema.distribution)
        .set({ status: 'Revoked', revokedReason: reason, version: sql`${schema.distribution.version} + 1` })
        .where(
          and(
            eq(schema.distribution.distributionId, distributionId),
            eq(schema.distribution.version, expectedVersion),
            eq(schema.distribution.status, 'Live'),
          ),
        )
        .returning();
      return rows[0] ? mapDistribution(rows[0]) : null;
    },

    async setPayout(
      distributionId: string,
      personId: string,
      expectedVersion: number,
      patch: { payoutStatus: string; paidOn: string | null; paymentSourceLabel: string | null; refNo: string | null },
    ): Promise<DistributionShare | null> {
      const rows = await db
        .update(schema.distributionShare)
        .set({ ...patch, version: sql`${schema.distributionShare.version} + 1` })
        .where(
          and(
            eq(schema.distributionShare.distributionId, distributionId),
            eq(schema.distributionShare.personId, personId),
            eq(schema.distributionShare.version, expectedVersion),
          ),
        )
        .returning();
      return rows[0] ? this.getDistributionShare(distributionId, personId) : null;
    },

    // ── S7 teams (direct-audited org structure; the entity-register pattern) ──
    async insertTeam(row: NewTeamRow): Promise<Team> {
      const [r] = await db.insert(schema.team).values({ tenantId, ...row }).returning();
      return mapTeam(r);
    },

    async getTeam(teamId: string): Promise<Team | null> {
      const rows = await db.select().from(schema.team).where(eq(schema.team.teamId, teamId)).limit(1);
      return rows[0] ? mapTeam(rows[0]) : null;
    },

    async updateTeam(teamId: string, expectedVersion: number, patch: TeamPatch): Promise<Team | null> {
      const rows = await db
        .update(schema.team)
        .set({ ...patch, version: sql`${schema.team.version} + 1` })
        .where(and(eq(schema.team.teamId, teamId), eq(schema.team.version, expectedVersion), eq(schema.team.isActive, true)))
        .returning();
      return rows[0] ? mapTeam(rows[0]) : null;
    },

    async deactivateTeam(teamId: string, expectedVersion: number): Promise<Team | null> {
      const rows = await db
        .update(schema.team)
        .set({ isActive: false, version: sql`${schema.team.version} + 1` })
        .where(and(eq(schema.team.teamId, teamId), eq(schema.team.version, expectedVersion), eq(schema.team.isActive, true)))
        .returning();
      return rows[0] ? mapTeam(rows[0]) : null;
    },

    async reactivateTeam(teamId: string, expectedVersion: number): Promise<Team | null> {
      const rows = await db
        .update(schema.team)
        .set({ isActive: true, version: sql`${schema.team.version} + 1` })
        .where(and(eq(schema.team.teamId, teamId), eq(schema.team.version, expectedVersion), eq(schema.team.isActive, false)))
        .returning();
      return rows[0] ? mapTeam(rows[0]) : null;
    },

    async getTeamMembership(teamId: string, personId: string): Promise<TeamMembership | null> {
      const res = await db.execute(sql`
        SELECT tm.*, p.full_name AS person_name
          FROM team_membership tm
          JOIN person p ON p.tenant_id = tm.tenant_id AND p.person_id = tm.person_id
         WHERE tm.team_id = ${teamId} AND tm.person_id = ${personId}
      `);
      const row = res.rows[0];
      return row ? mapTeamMembership(row) : null;
    },

    async insertTeamMembership(teamId: string, personId: string, role: string): Promise<TeamMembership> {
      await db.insert(schema.teamMembership).values({ tenantId, teamId, personId, role });
      const created = await this.getTeamMembership(teamId, personId);
      if (!created) throw new Error('team membership insert did not read back');
      return created;
    },

    // HARDEN-2 M-03: membership flips are version-guarded — reactivation uses
    // the version read in THIS tx (the roster hides inactive rows from the
    // browser), removal uses the version the caller displayed.
    async reactivateTeamMembership(teamId: string, personId: string, role: string, expectedVersion: number): Promise<TeamMembership | null> {
      const rows = await db
        .update(schema.teamMembership)
        .set({ role, isActive: true, version: sql`${schema.teamMembership.version} + 1` })
        .where(
          and(
            eq(schema.teamMembership.teamId, teamId),
            eq(schema.teamMembership.personId, personId),
            eq(schema.teamMembership.isActive, false),
            eq(schema.teamMembership.version, expectedVersion),
          ),
        )
        .returning();
      return rows[0] ? this.getTeamMembership(teamId, personId) : null;
    },

    async deactivateTeamMembership(teamId: string, personId: string, expectedVersion: number): Promise<TeamMembership | null> {
      const rows = await db
        .update(schema.teamMembership)
        .set({ isActive: false, version: sql`${schema.teamMembership.version} + 1` })
        .where(
          and(
            eq(schema.teamMembership.teamId, teamId),
            eq(schema.teamMembership.personId, personId),
            eq(schema.teamMembership.isActive, true),
            eq(schema.teamMembership.version, expectedVersion),
          ),
        )
        .returning();
      return rows[0] ? this.getTeamMembership(teamId, personId) : null;
    },

    // ── Finance S3 agreement terms (direct-audited; the DB CHECK backstops shape) ──
    async insertAgreementTerm(row: NewAgreementTermRow): Promise<AgreementTerm> {
      const [r] = await db.insert(schema.agreementTerm).values({ tenantId, ...row }).returning();
      return mapAgreementTerm(r);
    },

    async getAgreementTerm(termId: string): Promise<AgreementTerm | null> {
      const rows = await db
        .select()
        .from(schema.agreementTerm)
        .where(and(eq(schema.agreementTerm.termId, termId), eq(schema.agreementTerm.isActive, true)))
        .limit(1);
      return rows[0] ? mapAgreementTerm(rows[0]) : null;
    },

    async updateAgreementTerm(termId: string, expectedVersion: number, patch: AgreementTermPatch): Promise<AgreementTerm | null> {
      const rows = await db
        .update(schema.agreementTerm)
        .set({ ...patch, version: sql`${schema.agreementTerm.version} + 1` })
        .where(
          and(
            eq(schema.agreementTerm.termId, termId),
            eq(schema.agreementTerm.version, expectedVersion),
            eq(schema.agreementTerm.isActive, true),
          ),
        )
        .returning();
      return rows[0] ? mapAgreementTerm(rows[0]) : null;
    },

    async deactivateAgreementTerm(termId: string, expectedVersion: number): Promise<AgreementTerm | null> {
      const rows = await db
        .update(schema.agreementTerm)
        .set({ isActive: false, version: sql`${schema.agreementTerm.version} + 1` })
        .where(
          and(
            eq(schema.agreementTerm.termId, termId),
            eq(schema.agreementTerm.version, expectedVersion),
            eq(schema.agreementTerm.isActive, true),
          ),
        )
        .returning();
      return rows[0] ? mapAgreementTerm(rows[0]) : null;
    },

    // ── Comms (the Mission Comms slice) ───────────────────────────────────────
    async getModuleEntitlement(moduleKey: string) {
      const rows = await db
        .select()
        .from(schema.tenantModuleEntitlement)
        .where(eq(schema.tenantModuleEntitlement.moduleKey, moduleKey))
        .limit(1);
      return rows[0] ? mapModuleEntitlement(rows[0]) : null;
    },

    async getCommsThread(threadId: string) {
      const rows = await db.select().from(schema.commsThread).where(eq(schema.commsThread.threadId, threadId)).limit(1);
      return rows[0] ? mapCommsThread(rows[0]) : null;
    },

    async missionExists(missionId: string): Promise<boolean> {
      const res = await db.execute(sql`SELECT 1 FROM mission WHERE mission_id = ${missionId} LIMIT 1`);
      return res.rows.length > 0;
    },

    async insertCommsThread(row) {
      // ON CONFLICT on the one-per-anchor partial unique keeps the tx healthy on
      // a concurrent-creator race; the caller re-reads the winner on null.
      const res = await db.execute(sql`
        INSERT INTO comms_thread (tenant_id, thread_id, kind, anchor_type, anchor_id, created_by_user_id, created_by_label)
        VALUES (${tenantId}, ${row.threadId}, ${row.kind}, ${row.anchorType}, ${row.anchorId}, ${row.createdByUserId}, ${row.createdByLabel})
        ON CONFLICT (tenant_id, anchor_type, anchor_id) WHERE kind = 'anchored' DO NOTHING
        RETURNING *
      `);
      const r = res.rows[0];
      return r ? mapCommsThread(r as Record<string, unknown>) : null;
    },

    async bumpCommsThreadSeq(threadId: string): Promise<number | null> {
      // The row lock serialises concurrent senders per thread (the business-id
      // counter argument: never MAX+1). Held to COMMIT of the enclosing tx.
      const res = await db.execute(sql`
        UPDATE comms_thread SET last_seq = last_seq + 1, last_message_at = now()
         WHERE thread_id = ${threadId}
         RETURNING last_seq
      `);
      const r = res.rows[0] as { last_seq: string | number } | undefined;
      return r ? Number(r.last_seq) : null;
    },

    async insertCommsMessage(row): Promise<boolean> {
      // ON CONFLICT on the send-idempotency unique DO NOTHING: false = duplicate
      // send; the caller re-reads the existing message (tx stays healthy).
      const res = await db.execute(sql`
        INSERT INTO comms_message (tenant_id, message_id, thread_id, seq, author_user_id, author_label, client_mutation_id)
        VALUES (${tenantId}, ${row.messageId}, ${row.threadId}, ${row.seq}, ${row.authorUserId}, ${row.authorLabel}, ${row.clientMutationId})
        ON CONFLICT (tenant_id, author_user_id, client_mutation_id) DO NOTHING
        RETURNING id
      `);
      return res.rows.length > 0;
    },

    async insertCommsMessageRevision(row): Promise<string> {
      const [r] = await db
        .insert(schema.commsMessageRevision)
        .values({
          tenantId,
          messageId: row.messageId,
          revisionNo: row.revisionNo,
          body: row.body,
          editorUserId: row.editorUserId,
          editorLabel: row.editorLabel,
          reason: row.reason,
        })
        .returning();
      if (!r) throw new Error('comms revision insert returned no row');
      return r.id;
    },

    async insertCommsThreadEvent(row): Promise<void> {
      await db.insert(schema.commsThreadEvent).values({
        tenantId,
        threadId: row.threadId,
        eventType: row.eventType,
        actorUserId: row.actorUserId,
        actorLabel: row.actorLabel,
      });
    },

    async insertCommsObjectLink(row): Promise<void> {
      await db.insert(schema.commsObjectLink).values({
        tenantId,
        revisionId: row.revisionId,
        targetType: row.targetType,
        targetId: row.targetId,
      });
    },

    async insertCommsDocumentAttachment(row): Promise<void> {
      await db.insert(schema.commsDocumentAttachment).values({
        tenantId,
        messageId: row.messageId,
        documentId: row.documentId,
        attachedByUserId: row.attachedByUserId,
      });
    },

    async insertCommsObligation(row): Promise<void> {
      await db.insert(schema.commsObligation).values({
        tenantId,
        obligationId: row.obligationId,
        threadId: row.threadId,
        sourceMessageId: row.sourceMessageId,
        description: row.description,
        accountableUserId: row.accountableUserId,
        requesterUserId: row.requesterUserId,
        beneficiaryKind: row.beneficiaryKind,
        beneficiaryUserId: row.beneficiaryUserId,
        beneficiaryLabel: row.beneficiaryLabel,
        dueAt: new Date(row.dueAt),
        evidenceRequirement: row.evidenceRequirement,
        acceptanceKind: row.acceptanceKind,
        acceptanceUserId: row.acceptanceUserId,
        acceptanceLabel: row.acceptanceLabel,
        createdByUserId: row.createdByUserId,
      });
    },

    async getCommsObligationRow(obligationId: string) {
      const rows = await db.select().from(schema.commsObligation).where(eq(schema.commsObligation.obligationId, obligationId)).limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        obligationId: r.obligationId,
        threadId: r.threadId,
        state: r.state,
        version: r.version,
        accountableUserId: r.accountableUserId,
        requesterUserId: r.requesterUserId,
        acceptanceKind: r.acceptanceKind as 'account' | 'external',
        acceptanceUserId: r.acceptanceUserId,
      };
    },

    async updateCommsObligationState(obligationId: string, expectedVersion: number, toState: string) {
      // CAS: the optimistic-lock refusal (null = stale) — the transition gateway's spine.
      const rows = await db
        .update(schema.commsObligation)
        .set({ state: toState, version: sql`${schema.commsObligation.version} + 1` })
        .where(and(eq(schema.commsObligation.obligationId, obligationId), eq(schema.commsObligation.version, expectedVersion)))
        .returning();
      return rows[0] ? { state: rows[0].state, version: rows[0].version } : null;
    },

    async insertCommsObligationEvent(row): Promise<string> {
      const [r] = await db
        .insert(schema.commsObligationEvent)
        .values({
          tenantId,
          obligationId: row.obligationId,
          eventType: row.eventType,
          fromState: row.fromState,
          toState: row.toState,
          actorUserId: row.actorUserId,
          actorLabel: row.actorLabel,
          reason: row.reason,
          attestation: row.attestation,
          deliveryId: row.deliveryId,
          clientMutationId: row.clientMutationId,
        })
        .returning();
      if (!r) throw new Error('comms obligation event insert returned no row');
      return r.id;
    },

    async insertCommsEvidenceDelivery(row): Promise<string> {
      const [r] = await db
        .insert(schema.commsEvidenceDelivery)
        .values({
          tenantId,
          obligationId: row.obligationId,
          documentId: row.documentId,
          deliveredByUserId: row.deliveredByUserId,
          delivererLabel: row.delivererLabel,
          note: row.note,
        })
        .returning();
      if (!r) throw new Error('comms evidence delivery insert returned no row');
      return r.id;
    },
  } satisfies WriteTx;
}
