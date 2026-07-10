/**
 * invoiceOps — S6: issue / void / read invoices, and link the stored PDF.
 *
 * Posture: DIRECT-BUT-AUDITED, the same standing as the S2 payment flip this
 * automates (issuing IS "the line went Expected → Invoiced", plus the paper).
 * Writes take assertManageMissions + assertViewFinancials; reads take
 * assertReadPeople + assertViewFinancials (an invoice is money).
 *
 * Issue happens in ONE transaction: allocate the per-(entity, year) series
 * number, insert the invoice, flip the line to Invoiced, audit both trails.
 * The PDF is generated AFTER the transaction (bytes go to object storage —
 * external I/O never rides a DB tx); a failed PDF leaves an honest invoice
 * with documentId = null and a retry endpoint, never a lie.
 *
 * Numbers are NEVER reused. A voided invoice keeps its number (the gap is the
 * audit trail); voiding flips the line back to Expected so a corrected
 * invoice can be issued with a FRESH number.
 */
import {
  type Actor,
  type Invoice,
  type IssueInvoiceInput,
  assertInvoiceVoidable,
  assertLineInvoiceable,
  computeVatMinor,
  ConcurrencyError,
  formatInvoiceId,
  formatInvoiceNumber,
  InvoiceRuleError,
  invoiceSeriesKind,
  issueInvoiceInputSchema,
  NotFoundError,
  ValidationError,
} from '@c3web/domain';
import { assertManageMissions, assertReadPeople, assertViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

/** The register (newest first) — an invoice is money; the finance gate applies. */
export async function listInvoices(p: Persistence, actor: Actor): Promise<Invoice[]> {
  assertReadPeople(actor);
  assertViewFinancials(actor);
  return p.reads.forActor(actor).listInvoices();
}

export async function getInvoice(p: Persistence, actor: Actor, invoiceId: string): Promise<Invoice> {
  assertReadPeople(actor);
  assertViewFinancials(actor);
  const invoice = await p.reads.forActor(actor).getInvoiceById(invoiceId);
  if (!invoice) throw new NotFoundError('Invoice', invoiceId);
  return invoice;
}

/**
 * Issue: ONE transaction — series number allocated, invoice inserted, line
 * flipped Expected → Invoiced, both trails audited. The entity must be active
 * and CARRY A CODE (the series prefix); the line must be an active, still-
 * Expected income line of the named mission.
 */
export async function issueInvoice(p: Persistence, actor: Actor, input: IssueInvoiceInput): Promise<Invoice> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const parsed = issueInvoiceInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    const mission = await tx.getMission(parsed.missionId);
    if (!mission) throw new NotFoundError('Mission', parsed.missionId);
    if (!mission.isActive) throw new ValidationError('This mission is retired — its P&L is frozen.', { missionId: parsed.missionId });

    const line = await tx.getMissionLine(parsed.lineId);
    if (!line || line.missionId !== parsed.missionId) throw new NotFoundError('Mission line', parsed.lineId);
    assertLineInvoiceable(line);

    const entity = await tx.getEntity(parsed.entityId);
    if (!entity) throw new NotFoundError('Entity', parsed.entityId);
    if (!entity.isActive) throw new ValidationError('This entity is deactivated — reactivate it before issuing from its series.', { entityId: parsed.entityId });
    if (!entity.code) {
      throw new ValidationError('This entity has no code — set one on the entity first (the code is the invoice series prefix).', { entityId: parsed.entityId });
    }

    const issuedOn = new Date().toISOString().slice(0, 10);
    const year = Number(issuedOn.slice(0, 4));
    const seriesSeq = await tx.allocateSequence(invoiceSeriesKind(parsed.entityId, year));
    const invoiceNumber = formatInvoiceNumber(entity.code, year, seriesSeq);
    const invoiceId = formatInvoiceId(await tx.allocateSequence('invoice'));

    const subtotalMinor = line.amountMinor;
    const vatMinor = computeVatMinor(subtotalMinor, parsed.vatRateBps);

    const invoice = await tx.insertInvoice({
      invoiceId,
      invoiceNumber,
      entityId: parsed.entityId,
      missionId: parsed.missionId,
      lineId: parsed.lineId,
      billedToName: parsed.billedToName,
      billedToDetails: parsed.billedToDetails,
      incomeCategory: line.category,
      description: parsed.description,
      currency: line.currency,
      subtotalMinor,
      vatRateBps: parsed.vatRateBps,
      vatMinor,
      totalMinor: subtotalMinor + vatMinor,
      issuedOn,
      issuedBy: actor.identity,
    });

    // The flip THIS document exists for. Version-guarded: a concurrent change
    // to the line (or a racing second issue) loses here and rolls everything
    // back — the partial-unique index on live invoices is the DB backstop.
    const flipped = await tx.setMissionLinePayment(parsed.lineId, line.version, {
      paymentStatus: 'Invoiced',
      receivedAmountMinor: null,
      receivedUsdPerUnit: null,
      paymentSourceLabel: line.paymentSourceLabel,
      refNo: line.refNo,
    });
    if (!flipped) throw new ConcurrencyError('Mission line', parsed.lineId);

    await tx.appendAuditEvent({
      entityType: 'Invoice',
      entityId: invoiceId,
      action: 'InvoiceIssued',
      actor: actor.identity,
      before: null,
      after: {
        invoiceId,
        invoiceNumber,
        entityId: parsed.entityId,
        missionId: parsed.missionId,
        lineId: parsed.lineId,
        billedToName: parsed.billedToName,
        currency: line.currency,
        subtotalMinor,
        vatRateBps: parsed.vatRateBps,
        vatMinor,
        totalMinor: subtotalMinor + vatMinor,
      },
    });
    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: parsed.missionId,
      action: 'MissionLinePaymentSet',
      actor: actor.identity,
      before: { lineId: parsed.lineId, paymentStatus: 'Expected' },
      after: { lineId: parsed.lineId, paymentStatus: 'Invoiced', invoiceId, invoiceNumber },
    });

    return invoice;
  });
}

/**
 * Void (reason mandatory): Issued → Voided, number kept forever; the line
 * flips back to Expected so corrected paper can be issued fresh. Refused once
 * the line is Received — correct the line first, the money already moved.
 */
export async function voidInvoice(p: Persistence, actor: Actor, invoiceId: string, reason: string, expectedVersion: number): Promise<Invoice> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const trimmed = reason.trim();
  if (trimmed === '') throw new ValidationError('A void reason is required.', { invoiceId });

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getInvoice(invoiceId);
    if (!current) throw new NotFoundError('Invoice', invoiceId);
    const line = await tx.getMissionLine(current.lineId);
    // A removed line cannot un-invoice; the invoice still voids (the paper is
    // withdrawn) but there is no line state to restore.
    assertInvoiceVoidable(current, { paymentStatus: line?.paymentStatus ?? null });

    const voided = await tx.voidInvoice(invoiceId, expectedVersion, trimmed);
    if (!voided) throw new ConcurrencyError('Invoice', invoiceId);

    if (line && line.paymentStatus === 'Invoiced') {
      const flipped = await tx.setMissionLinePayment(current.lineId, line.version, {
        paymentStatus: 'Expected',
        receivedAmountMinor: null,
        receivedUsdPerUnit: null,
        paymentSourceLabel: line.paymentSourceLabel,
        refNo: line.refNo,
      });
      if (!flipped) throw new ConcurrencyError('Mission line', current.lineId);
      await tx.appendAuditEvent({
        entityType: 'Mission',
        entityId: current.missionId,
        action: 'MissionLinePaymentSet',
        actor: actor.identity,
        before: { lineId: current.lineId, paymentStatus: 'Invoiced' },
        after: { lineId: current.lineId, paymentStatus: 'Expected', voidedInvoiceId: invoiceId },
      });
    }

    await tx.appendAuditEvent({
      entityType: 'Invoice',
      entityId: invoiceId,
      action: 'InvoiceVoided',
      actor: actor.identity,
      before: { status: 'Issued', invoiceNumber: current.invoiceNumber },
      after: { status: 'Voided', reason: trimmed },
    });

    return voided;
  });
}

/** Link the stored PDF artifact (documentId) to its invoice, version-guarded. */
export async function linkInvoiceDocument(p: Persistence, actor: Actor, invoiceId: string, expectedVersion: number, documentId: string): Promise<Invoice> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  return p.writes.transaction(actor, async (tx) => {
    const linked = await tx.setInvoiceDocument(invoiceId, expectedVersion, documentId);
    if (!linked) throw new ConcurrencyError('Invoice', invoiceId);
    return linked;
  });
}

export { InvoiceRuleError };
