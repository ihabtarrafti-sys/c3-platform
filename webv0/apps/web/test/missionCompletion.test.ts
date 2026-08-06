import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ClaimDto,
  CommsObligationDto,
  DistributionDto,
  DistributionShareDto,
  InvoiceDto,
  MissionDto,
  MissionLineDto,
  MissionPnlV2Dto,
} from '@c3web/api-contracts';
import { ApiError } from '../src/api';
import {
  claimsCompletionTruthOf,
  distributionsCompletionTruthOf,
  invoicesCompletionTruthOf,
  joinMissionCompletionTruth,
  MissionCompletionView,
  missionObligationsCompletionTruthOf,
  missionPnlCompletionTruthOf,
  missionRecordCompletionTruthOf,
  projectMissionCompletion,
  type CompletionSourceTruthFacts,
  type MissionCompletionProjection,
  type MissionCompletionViewProps,
  type MissionPnlView,
} from '../src/tablework/MissionCompletion';
import type { WitnessState } from '../src/tablework/TruthPanel';

const missionId = 'MSN-0001';
const otherMissionId = 'MSN-0002';
const witnessedAt = Date.parse('2026-08-06T16:00:00.000Z');
const verified = { kind: 'verified' as const, at: new Date(witnessedAt) };
const provenEmpty = { kind: 'proven-empty' as const, at: new Date(witnessedAt) };

const mission: MissionDto = {
  missionId,
  name: 'World Final',
  code: 'WF26',
  organizer: 'League',
  city: 'Riyadh',
  teamId: 'TEAM-0001',
  gameTitle: 'Arena',
  startsOn: '2026-08-10',
  endsOn: '2026-08-14',
  notes: null,
  financeStage: 'Settled',
  isActive: true,
  version: 8,
  createdAt: '2026-07-01T09:00:00.000Z',
  updatedAt: '2026-08-06T15:00:00.000Z',
};

const receivedIncome: MissionLineDto = {
  lineId: 'PNL-0001',
  missionId,
  direction: 'Income',
  category: 'PrizeMoney',
  label: 'Prize purse',
  amountMinor: 100_000,
  currency: 'USD',
  paymentStatus: 'Received',
  receivedAmountMinor: 100_000,
  receivedUsdPerUnit: 1,
  paymentSourceLabel: 'Treasury',
  refNo: 'REC-7',
  isActive: true,
  version: 3,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-05T10:00:00.000Z',
};

const inactiveIncome: MissionLineDto = {
  ...receivedIncome,
  lineId: 'PNL-0002',
  label: 'Removed appearance fee',
  paymentStatus: 'Expected',
  isActive: false,
};

const expenseLine: MissionLineDto = {
  ...receivedIncome,
  lineId: 'PNL-0003',
  direction: 'Expense',
  category: 'Travel',
  label: 'Travel',
  paymentStatus: null,
  receivedAmountMinor: null,
  receivedUsdPerUnit: null,
  paymentSourceLabel: null,
  refNo: null,
};

function pnlView(
  lines: readonly MissionLineDto[],
  settlement: { readonly outstandingIncomeCount: number; readonly incomeComplete: boolean },
): MissionPnlView {
  return {
    lines,
    pnl: { settlement } as MissionPnlV2Dto,
  };
}

const invoice: InvoiceDto = {
  invoiceId: 'INV-0001',
  invoiceNumber: 'C3-2026-001',
  entityId: 'ENT-0001',
  missionId,
  lineId: receivedIncome.lineId,
  billedToName: 'League',
  billedToDetails: null,
  incomeCategory: 'PrizeMoney',
  description: 'Prize purse',
  currency: 'USD',
  subtotalMinor: 100_000,
  vatRateBps: 0,
  vatMinor: 0,
  totalMinor: 100_000,
  status: 'Issued',
  issuedOn: '2026-08-02',
  issuedBy: 'finance@example.test',
  voidedReason: null,
  documentId: 'DOC-0001',
  version: 1,
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
};

const distribution: DistributionDto = {
  distributionId: 'DIST-0001',
  missionId,
  lineId: receivedIncome.lineId,
  poolMinor: 80_000,
  currency: 'USD',
  orgShareBps: 2000,
  orgCutMinor: 20_000,
  status: 'Live',
  revokedReason: null,
  notes: null,
  createdBy: 'owner@example.test',
  version: 1,
  createdAt: '2026-08-05T11:00:00.000Z',
};

const payout: DistributionShareDto = {
  distributionId: distribution.distributionId,
  personId: 'PER-0001',
  personName: 'Avery',
  shareBps: 10_000,
  amountMinor: 80_000,
  payoutStatus: 'Paid',
  paidOn: '2026-08-06',
  paymentSourceLabel: 'Treasury',
  refNo: 'PAY-9',
  version: 2,
};

const claim: ClaimDto = {
  claimId: 'CLM-0001',
  submittedBy: 'avery@example.test',
  personId: 'PER-0001',
  missionId,
  category: 'Travel',
  description: 'Airport transfer',
  amountMinor: 12_500,
  currency: 'USD',
  expenseOn: '2026-08-03',
  status: 'Paid',
  reviewedBy: 'finance@example.test',
  rejectionReason: null,
  paidOn: '2026-08-06',
  paymentSourceLabel: 'Treasury',
  refNo: 'CLM-PAY-1',
  version: 4,
  createdAt: '2026-08-03T10:00:00.000Z',
};

const selfAcceptedCancelled: CommsObligationDto = {
  obligationId: 'OBL-0001',
  threadId: 'THR-0001',
  sourceMessageId: null,
  state: 'Cancelled',
  description: 'Deliver the signed pack',
  accountableUserId: 'user-avery',
  requesterUserId: 'user-cameron',
  beneficiaryKind: 'external',
  beneficiaryUserId: null,
  beneficiaryLabel: 'Publisher',
  acceptanceKind: 'account',
  acceptanceUserId: 'user-avery',
  acceptanceLabel: null,
  dueAt: '2026-08-09T12:00:00.000Z',
  evidenceRequirement: 'Signed pack',
  version: 3,
  createdAt: '2026-08-01T09:00:00.000Z',
  events: [
    {
      eventType: 'EvidenceDelivered',
      fromState: 'Open',
      toState: 'Delivered',
      actorUserId: 'user-avery',
      actorLabel: 'Avery',
      reason: null,
      attestation: null,
      deliveryEpisodeVersion: 1,
      at: '2026-08-02T10:01:00.000Z',
    },
    {
      eventType: 'Accepted',
      fromState: 'Delivered',
      toState: 'Accepted',
      actorUserId: 'user-avery',
      actorLabel: 'Avery',
      reason: null,
      attestation: null,
      deliveryEpisodeVersion: 1,
      at: '2026-08-02T10:02:00.000Z',
    },
    {
      eventType: 'Cancelled',
      fromState: 'Accepted',
      toState: 'Cancelled',
      actorUserId: 'user-cameron',
      actorLabel: 'Cameron',
      reason: 'Superseded requirement',
      attestation: null,
      deliveryEpisodeVersion: null,
      at: '2026-08-02T10:03:00.000Z',
    },
  ],
  evidence: [
    {
      documentId: 'DOC-0002',
      fileName: 'signed-pack.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      deliveredByUserId: 'user-avery',
      delivererLabel: 'Avery',
      note: null,
      deliveredAt: '2026-08-02T10:01:00.000Z',
    },
  ],
};

const externalAccepted: CommsObligationDto = {
  ...selfAcceptedCancelled,
  obligationId: 'OBL-0002',
  state: 'Accepted',
  acceptanceKind: 'external',
  acceptanceUserId: 'user-cameron',
  acceptanceLabel: 'Publisher council',
  version: 2,
  events: selfAcceptedCancelled.events.slice(0, 2).map((event) =>
    event.eventType === 'Accepted'
      ? { ...event, actorUserId: 'user-cameron', actorLabel: 'Cameron Recorder' }
      : event,
  ),
};

const externalAcceptedThenCancelled: CommsObligationDto = {
  ...externalAccepted,
  obligationId: 'OBL-0003',
  state: 'Cancelled',
  version: 3,
  events: [...externalAccepted.events, selfAcceptedCancelled.events[2]!],
};

function facts<T>(overrides: Partial<CompletionSourceTruthFacts<T>> = {}): CompletionSourceTruthFacts<T> {
  return {
    included: true,
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    dataUpdatedAt: witnessedAt,
    ...overrides,
  };
}

describe('Mission Completion independent source witnesses', () => {
  const currentPnl = pnlView([receivedIncome], { outstandingIncomeCount: 0, incomeComplete: true });

  it('derives all six income states without turning zero into proof', () => {
    expect(missionPnlCompletionTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(missionPnlCompletionTruthOf(facts({ data: currentPnl }))).toEqual(verified);
    expect(
      missionPnlCompletionTruthOf(
        facts({ data: pnlView([inactiveIncome, expenseLine], { outstandingIncomeCount: 0, incomeComplete: false }) }),
      ),
    ).toEqual(provenEmpty);
    expect(missionPnlCompletionTruthOf(facts({ included: false }))).toEqual({
      kind: 'denied',
      reasonClass: 'FINANCIALS_NOT_INCLUDED',
    });
    expect(missionPnlCompletionTruthOf(facts({ error: new Error('income unavailable') }))).toEqual({
      kind: 'fetch-failed',
      message: 'income unavailable',
    });
    expect(missionPnlCompletionTruthOf(facts({ data: currentPnl, isFetching: true }))).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'Mission income is being checked again.',
    });
  });

  it('earns mission-specific emptiness independently in the three list registers', () => {
    expect(
      invoicesCompletionTruthOf(
        facts({ data: { invoices: [{ ...invoice, missionId: otherMissionId }] } }),
        missionId,
      ),
    ).toEqual(provenEmpty);
    expect(
      distributionsCompletionTruthOf(
        facts({ data: { distributions: [{ distribution: { ...distribution, missionId: otherMissionId }, shares: [payout] }] } }),
        missionId,
      ),
    ).toEqual(provenEmpty);
    expect(
      claimsCompletionTruthOf(
        facts({ data: { claims: [{ ...claim, missionId: null }, { ...claim, claimId: 'CLM-0002', missionId: otherMissionId }] } }),
        missionId,
      ),
    ).toEqual(provenEmpty);
  });

  it.each([401, 403])('redacts cached children for authoritative HTTP %s across every queried register', (status) => {
    const error = new ApiError(status, 'READ_REFUSED', 'Standing refused.');
    expect(missionPnlCompletionTruthOf(facts({ data: currentPnl, error }))).toEqual({
      kind: 'denied',
      reasonClass: 'READ_REFUSED',
    });
    expect(invoicesCompletionTruthOf(facts({ data: { invoices: [invoice] }, error }), missionId)).toEqual({
      kind: 'denied',
      reasonClass: 'READ_REFUSED',
    });
    expect(
      distributionsCompletionTruthOf(
        facts({ data: { distributions: [{ distribution, shares: [payout] }] }, error }),
        missionId,
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'READ_REFUSED' });
    expect(claimsCompletionTruthOf(facts({ data: { claims: [claim] }, error }), missionId)).toEqual({
      kind: 'denied',
      reasonClass: 'READ_REFUSED',
    });
  });

  it('withholds cached record-scoped children after an authoritative 404', () => {
    expect(
      missionPnlCompletionTruthOf(
        facts({ data: currentPnl, error: new ApiError(404, 'MISSION_NOT_FOUND', 'Missing Mission.') }),
      ),
    ).toEqual({
      kind: 'fetch-failed',
      message: 'The selected Mission no longer resolves, so its prior income view has been withheld.',
    });
    expect(
      distributionsCompletionTruthOf(
        facts({
          data: { distributions: [{ distribution, shares: [payout] }] },
          error: new ApiError(404, 'MISSION_NOT_FOUND', 'Missing Mission.'),
        }),
        missionId,
      ),
    ).toEqual({
      kind: 'fetch-failed',
      message: 'The selected Mission no longer resolves, so its prior distribution view has been withheld.',
    });
  });

  it('keeps cached success visibly stale during a background recheck or failed refresh', () => {
    expect(invoicesCompletionTruthOf(facts({ data: { invoices: [invoice] }, isFetching: true }), missionId).kind).toBe('stale');
    expect(
      claimsCompletionTruthOf(
        facts({ data: { claims: [claim] }, error: new ApiError(503, 'UNAVAILABLE', 'Try again.') }),
        missionId,
      ),
    ).toEqual({ kind: 'stale', verifiedAt: new Date(witnessedAt), message: 'Try again.' });
  });

  it('marks rechecking parent-owned Mission and obligation sources stale instead of borrowing cached standing', () => {
    const missionFacts: CompletionSourceTruthFacts<{ mission: MissionDto }> = {
      included: true,
      data: { mission },
      error: null,
      isLoading: false,
      isFetching: true,
      dataUpdatedAt: witnessedAt,
    };
    const obligationFacts: CompletionSourceTruthFacts<{ obligations: readonly CommsObligationDto[] }> = {
      included: true,
      data: { obligations: [selfAcceptedCancelled] },
      error: null,
      isLoading: false,
      isFetching: true,
      dataUpdatedAt: witnessedAt,
    };

    expect(missionRecordCompletionTruthOf(missionFacts)).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'The Mission record is being checked again.',
    });
    expect(missionObligationsCompletionTruthOf(obligationFacts)).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'Mission obligations are being checked again.',
    });
    expect(
      missionRecordCompletionTruthOf({
        ...missionFacts,
        isFetching: false,
        error: new ApiError(403, 'MISSION_REFUSED', 'Standing refused.'),
      }),
    ).toEqual({ kind: 'denied', reasonClass: 'MISSION_REFUSED' });
  });
});

describe('Mission Completion projection boundaries', () => {
  it('keeps lifecycle records separate and includes only explicit Mission membership', () => {
    const projection = projectMissionCompletion({
      missionId,
      obligations: [selfAcceptedCancelled],
      pnl: pnlView([inactiveIncome, expenseLine, receivedIncome], {
        outstandingIncomeCount: 0,
        incomeComplete: false,
      }),
      invoices: {
        invoices: [invoice, { ...invoice, invoiceId: 'INV-0002', invoiceNumber: 'OTHER', missionId: otherMissionId }],
      },
      distributions: {
        distributions: [
          { distribution, shares: [payout] },
          { distribution: { ...distribution, distributionId: 'DIST-0002', missionId: otherMissionId }, shares: [] },
        ],
      },
      claims: {
        claims: [
          claim,
          { ...claim, claimId: 'CLM-0002', missionId: null },
          { ...claim, claimId: 'CLM-0003', missionId: otherMissionId },
        ],
      },
    });

    expect(projection.activeIncome.map(({ lineId }) => lineId)).toEqual([receivedIncome.lineId]);
    expect(projection.incomeCriterion).toEqual({ kind: 'no-qualifying-income' });
    expect(projection.invoices.map(({ invoice: row }) => row.invoiceId)).toEqual([invoice.invoiceId]);
    expect(projection.invoices[0]?.linePaymentStatus).toBe('Received');
    expect(projection.distributions.map(({ distribution: row }) => row.distributionId)).toEqual([
      distribution.distributionId,
    ]);
    expect(projection.claims.map(({ claimId }) => claimId)).toEqual([claim.claimId]);
    expect(projection.obligations[0]).toMatchObject({
      deliveryRecorded: true,
      acceptanceRecorded: false,
      doneRecorded: false,
      acceptanceProvenance: {
        shape: 'same-person',
        lifecycle: 'cancelled',
        actorName: 'Avery',
      },
    });
  });

  it('does not equate outstanding zero with income-complete false', () => {
    expect(
      projectMissionCompletion({
        missionId,
        obligations: [],
        pnl: pnlView([], { outstandingIncomeCount: 0, incomeComplete: false }),
      }).incomeCriterion,
    ).toEqual({ kind: 'no-qualifying-income' });
    expect(
      projectMissionCompletion({
        missionId,
        obligations: [],
        pnl: pnlView([receivedIncome], { outstandingIncomeCount: 0, incomeComplete: true }),
      }).incomeCriterion,
    ).toEqual({ kind: 'recorded-true' });
  });

  it('keeps the outside authority separate from the internal recorder for current and superseded acceptance', () => {
    const projection = projectMissionCompletion({
      missionId,
      obligations: [externalAccepted, externalAcceptedThenCancelled],
    });

    expect(projection.obligations.map(({ acceptanceProvenance }) => acceptanceProvenance)).toEqual([
      {
        shape: 'external',
        lifecycle: 'current',
        actorName: 'Cameron Recorder',
        authorityLabel: 'Publisher council',
      },
      {
        shape: 'external',
        lifecycle: 'cancelled',
        actorName: 'Cameron Recorder',
        authorityLabel: 'Publisher council',
      },
    ]);
  });
});

describe('Mission Completion aggregate availability', () => {
  const allSources = {
    mission: verified,
    obligations: verified,
    pnl: verified,
    invoices: verified,
    distributions: verified,
    claims: verified,
    financialsIncluded: true,
    claimsIncluded: true,
  } as const;

  it('excludes unavailable capability lanes rather than calling their absence empty', () => {
    expect(
      joinMissionCompletionTruth({
        ...allSources,
        financialsIncluded: false,
        claimsIncluded: false,
        pnl: { kind: 'denied', reasonClass: 'FINANCIALS_NOT_INCLUDED' },
        invoices: { kind: 'denied', reasonClass: 'FINANCIALS_NOT_INCLUDED' },
        distributions: { kind: 'denied', reasonClass: 'FINANCIALS_NOT_INCLUDED' },
        claims: { kind: 'denied', reasonClass: 'CLAIMS_NOT_INCLUDED' },
      }),
    ).toEqual(verified);
  });

  it('joins availability with denied > failed > loading > stale > current precedence', () => {
    expect(
      joinMissionCompletionTruth({
        ...allSources,
        pnl: { kind: 'fetch-failed', message: 'income failed' },
        claims: { kind: 'denied', reasonClass: 'CLAIMS_DENIED' },
      }),
    ).toEqual({ kind: 'denied', reasonClass: 'claims:CLAIMS_DENIED' });
    expect(
      joinMissionCompletionTruth({ ...allSources, obligations: { kind: 'loading' }, pnl: { kind: 'fetch-failed', message: 'income failed' } }),
    ).toEqual({ kind: 'fetch-failed', message: 'income: income failed' });
    expect(
      joinMissionCompletionTruth({
        ...allSources,
        invoices: { kind: 'stale', verifiedAt: new Date('2026-08-06T15:30:00.000Z'), message: 'refresh failed' },
      }),
    ).toMatchObject({ kind: 'stale', verifiedAt: new Date('2026-08-06T15:30:00.000Z') });
  });
});

const fullProjection = projectMissionCompletion({
  missionId,
  obligations: [selfAcceptedCancelled],
  pnl: pnlView([receivedIncome], { outstandingIncomeCount: 0, incomeComplete: true }),
  invoices: { invoices: [invoice] },
  distributions: { distributions: [{ distribution, shares: [payout] }] },
  claims: { claims: [claim] },
});

function viewProps(overrides: Partial<MissionCompletionViewProps> = {}): MissionCompletionViewProps {
  return {
    mission,
    missionTruth: verified,
    obligationsTruth: verified,
    pnlTruth: verified,
    invoicesTruth: verified,
    distributionsTruth: verified,
    claimsTruth: verified,
    truth: verified,
    projection: fullProjection,
    financialsIncluded: true,
    claimsIncluded: true,
    claimsScope: 'tenant',
    ...overrides,
  };
}

describe('Mission Completion rendered contract', () => {
  it('keeps the no-verdict boundary permanent while rendering separate exact statuses and DTO provenance', () => {
    const markup = renderToStaticMarkup(createElement(MissionCompletionView, viewProps()));

    expect(markup).toContain('data-tablework="MissionCompletion"');
    expect(markup).toContain('Recorded completion facts. No overall completion is inferred.');
    expect(markup).toContain('does not create a verdict, score, or new state');
    expect(markup).toContain('Finance lifecycle · Settled');
    expect(markup).toContain('Invoice · Issued');
    expect(markup).toContain('Payment state ·');
    expect(markup).toContain('Received');
    expect(markup).toContain('Distribution · Live');
    expect(markup).toContain('Payout · Paid');
    expect(markup).toContain('Claim · Paid');
    expect(markup).toContain('issued 2026-08-02 by finance@example.test');
    expect(markup).toContain('Created by owner@example.test');
    expect(markup).toContain('submitted by avery@example.test · reviewed by finance@example.test');
    expect(markup.toLowerCase()).not.toContain('invoice paid');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
  });

  it('preserves the weighted superseded same-person record without promoting it to current acceptance', () => {
    const markup = renderToStaticMarkup(createElement(MissionCompletionView, viewProps()));

    expect(markup).toContain('data-acceptance-shape="same-person"');
    expect(markup).toContain('data-acceptance-lifecycle="cancelled"');
    expect(markup).toContain('data-acceptance-emphasis="governance-sensitive"');
    expect(markup).toContain('Superseded same-person record');
    expect(markup).toContain('Before cancellation, Avery both delivered evidence and accepted it as the named authority.');
    expect(markup).toContain('Not currently recorded');
  });

  it('names external authority acceptance as recorded by its internal transcriber, current or superseded', () => {
    const projection = projectMissionCompletion({
      missionId,
      obligations: [externalAccepted, externalAcceptedThenCancelled],
    });
    const markup = renderToStaticMarkup(
      createElement(MissionCompletionView, viewProps({ projection })),
    );

    expect(markup).toContain('data-acceptance-shape="external"');
    expect(markup).toContain('data-acceptance-lifecycle="current"');
    expect(markup).toContain('External acceptance record');
    expect(markup).toContain('Publisher council&#x27;s acceptance was recorded by Cameron Recorder.');
    expect(markup).toContain('data-acceptance-lifecycle="cancelled"');
    expect(markup).toContain('Superseded external acceptance record');
    expect(markup).toContain('Before cancellation, Publisher council&#x27;s acceptance was recorded by Cameron Recorder.');
    expect(markup).not.toContain('Cameron Recorder accepted it as the named authority.');
  });

  it('does not let verified invoice truth authorize a denied P&L payment subfact', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MissionCompletionView,
        viewProps({ pnlTruth: { kind: 'denied', reasonClass: 'FINANCIALS_REVOKED' } }),
      ),
    );
    const invoiceStart = markup.indexOf('data-source="completion-invoices"');
    const distributionStart = markup.indexOf('data-source="completion-distributions"');
    const invoiceMarkup = markup.slice(invoiceStart, distributionStart);

    expect(invoiceMarkup).toContain('Invoice · Issued');
    expect(invoiceMarkup).toContain('data-truth="denied"');
    expect(invoiceMarkup).toContain('Linked-line payment state withheld until the Mission P&amp;L has a current witness.');
    expect(invoiceMarkup).not.toContain('>Received<');
  });

  it('labels a cached linked-line payment as stale instead of borrowing current invoice standing', () => {
    const stalePnl: WitnessState = {
      kind: 'stale',
      verifiedAt: new Date('2026-08-06T15:00:00.000Z'),
      message: 'P&L refresh failed.',
    };
    const markup = renderToStaticMarkup(createElement(MissionCompletionView, viewProps({ pnlTruth: stalePnl })));
    const invoiceStart = markup.indexOf('data-source="completion-invoices"');
    const distributionStart = markup.indexOf('data-source="completion-distributions"');
    const invoiceMarkup = markup.slice(invoiceStart, distributionStart);

    expect(invoiceMarkup).toContain('data-truth="stale"');
    expect(invoiceMarkup).toContain('Last witnessed payment state');
    expect(invoiceMarkup).toContain('The Mission P&amp;L is stale.');
  });

  it('states account-scoped claims without claiming all, and visibly labels omitted registers as not requested', () => {
    const emptyProjection: MissionCompletionProjection = {
      ...fullProjection,
      activeIncome: [],
      incomeCriterion: { kind: 'no-qualifying-income' },
      invoices: [],
      distributions: [],
    };
    const markup = renderToStaticMarkup(
      createElement(
        MissionCompletionView,
        viewProps({
          projection: emptyProjection,
          financialsIncluded: false,
          claimsScope: 'account',
          pnlTruth: { kind: 'denied', reasonClass: 'FINANCIALS_NOT_INCLUDED' },
          invoicesTruth: { kind: 'denied', reasonClass: 'FINANCIALS_NOT_INCLUDED' },
          distributionsTruth: { kind: 'denied', reasonClass: 'FINANCIALS_NOT_INCLUDED' },
        }),
      ),
    );
    const claimsScopeStart = markup.indexOf('data-claim-scope="account"');
    const claimsScopeMarkup = markup.slice(claimsScopeStart, markup.indexOf('</p>', claimsScopeStart));

    expect(claimsScopeMarkup).toContain('Only claims visible to the signed-in account');
    expect(claimsScopeMarkup.toLowerCase()).not.toContain('all claims');
    expect(markup).toContain('data-testid="completion-financials-not-requested"');
    expect(markup).toContain('were not requested. Their absence is not a zero.');
  });

  it('renders outstanding zero plus incomeComplete false as no qualifying fact, never as completion', () => {
    const zeroProjection = projectMissionCompletion({
      missionId,
      obligations: [],
      pnl: pnlView([], { outstandingIncomeCount: 0, incomeComplete: false }),
    });
    const markup = renderToStaticMarkup(
      createElement(
        MissionCompletionView,
        viewProps({
          projection: zeroProjection,
          obligationsTruth: provenEmpty,
          pnlTruth: provenEmpty,
          invoicesTruth: provenEmpty,
          distributionsTruth: provenEmpty,
          claimsTruth: provenEmpty,
        }),
      ),
    );

    expect(markup).toContain('No active income line qualifies. Zero outstanding is not an income-complete fact.');
    expect(markup).not.toContain('every active income line is Received');
  });
});
