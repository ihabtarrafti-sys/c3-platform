/**
 * importExportOps — S5, the locked design in motion.
 *
 * STAGE (ops or owner): a CSV file is validated ALL-OR-NOTHING through the
 * domain codec (the same zod create schemas the API uses) PLUS the DB-aware
 * cross-checks a file cannot do alone (referenced people/entities/agreements
 * exist; codes not already taken). A single error anywhere = the full per-row
 * report and NOTHING persisted. A clean file = ONE ImportBatch approval whose
 * payload is the parsed batch — the immutable snapshot the owner reviews.
 *
 * EXECUTE (owner, in executeApproval): every row inserted in ONE transaction
 * with a per-row audit event; imported rows carry created_by_approval_id NULL
 * (their provenance is the batch approval, named in each audit event).
 *
 * EXPORT (owner/ops): each register as CSV in EXACTLY the import shape — the
 * export IS the template. The audit trail exports alongside (read-only file,
 * not importable — history is not writable).
 */
import {
  type Actor,
  type ImportDomain,
  type ImportRowError,
  type Approval,
  AGREEMENTS_COLUMNS,
  CREDENTIALS_COLUMNS,
  PEOPLE_COLUMNS,
  IMPORT_BATCH_TARGET,
  columnsForDomain,
  formatApprovalId,
  toCsv,
  validateImportCsv,
} from '@c3web/domain';
import { assertSubmitApproval, assertViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

export type StageImportResult =
  | { readonly ok: true; readonly approval: Approval; readonly rowCount: number; readonly domain: ImportDomain }
  | { readonly ok: false; readonly errors: ImportRowError[] };

const MAX_IMPORT_ROWS = 5000;

/** Stage an import file: validate everything, then submit ONE batch approval. */
export async function stageImport(
  p: Persistence,
  actor: Actor,
  domain: ImportDomain,
  fileName: string,
  csvText: string,
): Promise<StageImportResult> {
  assertSubmitApproval(actor);

  const validated = validateImportCsv(domain, csvText);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  const batch = validated.batch;
  if (batch.rowCount > MAX_IMPORT_ROWS) {
    return { ok: false, errors: [{ row: 0, column: '(file)', message: `At most ${MAX_IMPORT_ROWS} rows per file — split the import.` }] };
  }

  // DB-aware cross-checks (the file alone cannot know these).
  const reads = p.reads.forActor(actor);
  const errors: ImportRowError[] = [];

  if (domain === 'people') {
    const entityIds = new Set((await reads.listEntities()).map((e) => e.entityId));
    const existingCodes = new Set((await reads.listPeople()).map((x) => x.personnelCode).filter(Boolean) as string[]);
    batch.people!.forEach((row, i) => {
      if (row.entityId && !entityIds.has(row.entityId)) {
        errors.push({ row: i + 1, column: 'entityId', message: `Entity ${row.entityId} does not exist.` });
      }
      if (row.personnelCode && existingCodes.has(row.personnelCode)) {
        errors.push({ row: i + 1, column: 'personnelCode', message: `personnelCode "${row.personnelCode}" is already in use.` });
      }
    });
  }

  if (domain === 'credentials') {
    const peopleIds = new Set((await reads.listPeople()).map((x) => x.personId));
    batch.credentials!.forEach((row, i) => {
      if (!peopleIds.has(row.personId)) {
        errors.push({ row: i + 1, column: 'personId', message: `Person ${row.personId} does not exist — import people first.` });
      }
    });
  }

  if (domain === 'agreements') {
    const peopleIds = new Set((await reads.listPeople()).map((x) => x.personId));
    const entityIds = new Set((await reads.listEntities()).map((e) => e.entityId));
    const existing = await reads.listAgreements();
    const existingAgrIds = new Set(existing.map((a) => a.agreementId));
    const existingCodes = new Set(existing.map((a) => a.agreementCode).filter(Boolean) as string[]);
    batch.agreements!.forEach((row, i) => {
      if (row.personId && !peopleIds.has(row.personId)) {
        errors.push({ row: i + 1, column: 'personId', message: `Person ${row.personId} does not exist — import people first.` });
      }
      if (row.entityId && !entityIds.has(row.entityId)) {
        errors.push({ row: i + 1, column: 'entityId', message: `Entity ${row.entityId} does not exist.` });
      }
      if (row.linkedAgreementId && !existingAgrIds.has(row.linkedAgreementId)) {
        errors.push({ row: i + 1, column: 'linkedAgreementId', message: `Agreement ${row.linkedAgreementId} does not exist (in-file links are not supported — import parents first).` });
      }
      if (row.agreementCode && existingCodes.has(row.agreementCode)) {
        errors.push({ row: i + 1, column: 'agreementCode', message: `agreementCode "${row.agreementCode}" is already in use.` });
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => a.row - b.row) };

  const approval = await p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const created = await tx.insertApproval({
      approvalId,
      operationType: 'ImportBatch',
      targetPersonId: IMPORT_BATCH_TARGET,
      targetId: null,
      reason: null,
      payload: { operationType: 'ImportBatch', input: { domain, fileName, rowCount: batch.rowCount, people: batch.people, credentials: batch.credentials, agreements: batch.agreements } },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `ImportBatch staged: ${batch.rowCount} ${domain} from "${fileName}"`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'ImportBatch', domain, rowCount: batch.rowCount, fileName },
    });
    return created;
  });

  return { ok: true, approval, rowCount: batch.rowCount, domain };
}

const s = (v: string | null | undefined): string => v ?? '';

/** Export a register as CSV — EXACTLY the import template shape. */
export async function exportDomainCsv(p: Persistence, actor: Actor, domain: ImportDomain): Promise<string> {
  assertSubmitApproval(actor); // bulk data leaves the org: owner/operations only
  const reads = p.reads.forActor(actor);

  if (domain === 'people') {
    const rows = (await reads.listPeople()).map((x) => [
      x.personId,
      x.fullName,
      s(x.ign),
      s(x.nationality),
      s(x.primaryRole),
      s(x.personnelCode),
      s(x.currentTeam),
      s(x.currentGameTitle),
      s(x.primaryDepartment),
      s(x.entityId),
      s(x.notes),
      String(x.isActive),
    ]);
    return toCsv(PEOPLE_COLUMNS, rows);
  }

  if (domain === 'credentials') {
    const rows = (await reads.listCredentials()).map((x) => [
      x.credentialId,
      x.personId,
      x.credentialType,
      s(x.issuer),
      x.issuedOn,
      s(x.expiresOn),
      s(x.notes),
      String(x.isActive),
    ]);
    return toCsv(CREDENTIALS_COLUMNS, rows);
  }

  // Agreements embed the financial value — the stricter gate applies.
  assertViewFinancials(actor);
  const rows = (await reads.listAgreements()).map((x) => [
    x.agreementId,
    s(x.personId),
    s(x.entityId),
    s(x.agreementCode),
    x.agreementType,
    s(x.linkedAgreementId),
    x.startsOn,
    x.endsOn,
    x.valueUsdCents === null || x.valueUsdCents === undefined ? '' : String(x.valueUsdCents),
    s(x.notes),
    x.status,
  ]);
  return toCsv(AGREEMENTS_COLUMNS, rows);
}

/** The blank template: headers only — the shape IS the contract. */
export function templateCsv(domain: ImportDomain): string {
  return toCsv(columnsForDomain(domain), []);
}

/** The audit trail as CSV (read-only history; not importable by design). */
export async function exportAuditCsv(p: Persistence, actor: Actor): Promise<string> {
  assertSubmitApproval(actor);
  const events = await p.reads.forActor(actor).listAllAuditEvents();
  const rows = events.map((e) => [
    e.at,
    e.entityType,
    e.entityId,
    e.action,
    e.actor,
    e.before ? JSON.stringify(e.before) : '',
    e.after ? JSON.stringify(e.after) : '',
  ]);
  return toCsv(['at', 'entityType', 'entityId', 'action', 'actor', 'before', 'after'], rows);
}
