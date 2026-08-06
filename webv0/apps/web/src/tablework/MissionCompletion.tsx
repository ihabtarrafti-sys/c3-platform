import { useLayoutEffect, useMemo, type ReactNode } from 'react';
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
import { deriveCommsAcceptanceProvenance, deriveCommsSelfAcceptance } from '@c3web/domain';
import { ApiError } from '../api';
import { claimStatusOf, formatMinor, invoiceStatusOf, missionFinanceStageOf, paymentStatusOf } from '../labels';
import { useClaims, useInvoices, useMissionDistributions, useMissionPnl } from '../queries';
import { useSession } from '../session';
import { RecheckingTruthPanel } from './RecheckingTruthPanel';
import { StatusBadge, type StatusVariant } from './collections';
import { truthStateOf, type WitnessState } from './TruthPanel';
import { useForegroundRewitness } from './useForegroundRewitness';
import './MissionCompletion.css';

export interface MissionPnlView {
  readonly lines: readonly MissionLineDto[];
  readonly pnl: MissionPnlV2Dto;
}

export interface InvoicesView {
  readonly invoices: readonly InvoiceDto[];
}

export interface DistributionView {
  readonly distribution: DistributionDto;
  readonly shares: readonly DistributionShareDto[];
}

export interface MissionDistributionsView {
  readonly distributions: readonly DistributionView[];
}

export interface ClaimsView {
  readonly claims: readonly ClaimDto[];
}

export interface CompletionSourceTruthFacts<T> {
  readonly included: boolean;
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

interface CompletionTruthOptions<T> {
  readonly isEmpty: (data: T) => boolean;
  readonly omittedReason: string;
  readonly recheckMessage: string;
  readonly missingMessage?: string;
}

function completionSourceTruthOf<T>(
  facts: CompletionSourceTruthFacts<T>,
  options: CompletionTruthOptions<T>,
): WitnessState {
  if (!facts.included) return { kind: 'denied', reasonClass: options.omittedReason };
  if (facts.error instanceof ApiError && (facts.error.status === 401 || facts.error.status === 403)) {
    return { kind: 'denied', reasonClass: facts.error.code || `HTTP_${facts.error.status}` };
  }
  // A record-scoped 404 is authoritative. It withholds any cached child rows
  // rather than showing a stale view for a Mission that no longer resolves.
  if (options.missingMessage && facts.error instanceof ApiError && facts.error.status === 404) {
    return { kind: 'fetch-failed', message: options.missingMessage };
  }

  const base = truthStateOf(
    {
      data: facts.data,
      error: facts.error,
      isLoading: facts.isLoading,
      dataUpdatedAt: facts.dataUpdatedAt,
    },
    options.isEmpty,
  );
  if (
    facts.isFetching &&
    facts.data !== undefined &&
    (base.kind === 'verified' || base.kind === 'proven-empty')
  ) {
    return {
      kind: 'stale',
      verifiedAt: new Date(facts.dataUpdatedAt > 0 ? facts.dataUpdatedAt : 0),
      message: options.recheckMessage,
    };
  }
  return base;
}

const activeIncomeLinesOf = (view: MissionPnlView): readonly MissionLineDto[] =>
  view.lines.filter((line) => line.isActive && line.direction === 'Income');

export function missionPnlCompletionTruthOf(facts: CompletionSourceTruthFacts<MissionPnlView>): WitnessState {
  return completionSourceTruthOf(facts, {
    isEmpty: (view) => activeIncomeLinesOf(view).length === 0,
    omittedReason: 'FINANCIALS_NOT_INCLUDED',
    recheckMessage: 'Mission income is being checked again.',
    missingMessage: 'The selected Mission no longer resolves, so its prior income view has been withheld.',
  });
}

export function invoicesCompletionTruthOf(
  facts: CompletionSourceTruthFacts<InvoicesView>,
  missionId: string,
): WitnessState {
  return completionSourceTruthOf(facts, {
    isEmpty: (view) => view.invoices.every((invoice) => invoice.missionId !== missionId),
    omittedReason: 'FINANCIALS_NOT_INCLUDED',
    recheckMessage: 'Invoices are being checked again.',
  });
}

export function distributionsCompletionTruthOf(
  facts: CompletionSourceTruthFacts<MissionDistributionsView>,
  missionId: string,
): WitnessState {
  return completionSourceTruthOf(facts, {
    isEmpty: (view) => view.distributions.every(({ distribution }) => distribution.missionId !== missionId),
    omittedReason: 'FINANCIALS_NOT_INCLUDED',
    recheckMessage: 'Distributions and payouts are being checked again.',
    missingMessage: 'The selected Mission no longer resolves, so its prior distribution view has been withheld.',
  });
}

export function claimsCompletionTruthOf(
  facts: CompletionSourceTruthFacts<ClaimsView>,
  missionId: string,
): WitnessState {
  return completionSourceTruthOf(facts, {
    // Only an explicit missionId is membership in this band. An unlinked claim
    // is never pulled into a Mission by dates, people, text, or amount.
    isEmpty: (view) => view.claims.every((claim) => claim.missionId !== missionId),
    omittedReason: 'CLAIMS_NOT_INCLUDED',
    recheckMessage: 'Mission-linked claims are being checked again.',
  });
}

interface CompletionTruthSources {
  readonly mission: WitnessState;
  readonly obligations: WitnessState;
  readonly pnl: WitnessState;
  readonly invoices: WitnessState;
  readonly distributions: WitnessState;
  readonly claims: WitnessState;
  readonly financialsIncluded: boolean;
  readonly claimsIncluded: boolean;
}

const completeWitness = (
  state: WitnessState,
): state is Extract<WitnessState, { kind: 'verified' | 'proven-empty' }> =>
  state.kind === 'verified' || state.kind === 'proven-empty';

/** Window truth summarizes source availability only. It never asserts that a
 * Mission is complete. Omitted capability lanes stay visible below but do not
 * turn the window into a denial for facts the seat is entitled to inspect. */
export function joinMissionCompletionTruth({
  mission,
  obligations,
  pnl,
  invoices,
  distributions,
  claims,
  financialsIncluded,
  claimsIncluded,
}: CompletionTruthSources): WitnessState {
  const sources: ReadonlyArray<{ readonly label: string; readonly state: WitnessState }> = [
    { label: 'mission', state: mission },
    { label: 'obligations', state: obligations },
    ...(financialsIncluded
      ? [
          { label: 'income', state: pnl },
          { label: 'invoices', state: invoices },
          { label: 'distributions', state: distributions },
        ]
      : []),
    ...(claimsIncluded ? [{ label: 'claims', state: claims }] : []),
  ];

  const denied = sources.filter(({ state }) => state.kind === 'denied');
  if (denied.length > 0) {
    return {
      kind: 'denied',
      reasonClass: denied
        .map(({ label, state }) => `${label}:${state.kind === 'denied' ? state.reasonClass : 'denied'}`)
        .join(','),
    };
  }
  const failed = sources.filter(({ state }) => state.kind === 'fetch-failed');
  if (failed.length > 0) {
    return {
      kind: 'fetch-failed',
      message: failed
        .map(({ label, state }) => `${label}: ${state.kind === 'fetch-failed' ? state.message : 'The request failed.'}`)
        .join(' '),
    };
  }
  if (sources.some(({ state }) => state.kind === 'loading')) return { kind: 'loading' };
  const stale = sources.filter(({ state }) => state.kind === 'stale');
  if (stale.length > 0) {
    const verifiedAt = stale
      .map(({ state }) => (state.kind === 'stale' ? state.verifiedAt : new Date(0)))
      .reduce((left, right) => (left.getTime() <= right.getTime() ? left : right));
    return {
      kind: 'stale',
      verifiedAt,
      message: `${stale.map(({ label }) => label).join(' and ')} ${stale.length === 1 ? 'is' : 'are'} stale; the ledger may be incomplete.`,
    };
  }
  const complete = sources.filter(
    (source): source is { readonly label: string; readonly state: Extract<WitnessState, { kind: 'verified' | 'proven-empty' }> } =>
      completeWitness(source.state),
  );
  if (complete.length !== sources.length) {
    return { kind: 'fetch-failed', message: 'A Completion Ledger source has no current witness.' };
  }
  const at = new Date(Math.min(...complete.map(({ state }) => state.at.getTime())));
  if (complete.every(({ state }) => state.kind === 'proven-empty')) return { kind: 'proven-empty', at };
  return { kind: 'verified', at };
}

export interface CompletionObligationRow {
  readonly obligation: CommsObligationDto;
  readonly deliveryRecorded: boolean;
  readonly acceptanceRecorded: boolean;
  readonly doneRecorded: boolean;
  readonly acceptanceProvenance:
    | {
        readonly shape: 'same-person' | 'ordinary';
        readonly lifecycle: 'current' | 'cancelled';
        readonly actorName: string;
      }
    | null;
}

export interface CompletionInvoiceRow {
  readonly invoice: InvoiceDto;
  readonly linePaymentStatus: MissionLineDto['paymentStatus'] | null;
}

export interface MissionCompletionProjection {
  readonly obligations: readonly CompletionObligationRow[];
  readonly activeIncome: readonly MissionLineDto[];
  readonly incomeCriterion:
    | { readonly kind: 'recorded-true' }
    | { readonly kind: 'outstanding'; readonly count: number }
    | { readonly kind: 'no-qualifying-income' };
  readonly invoices: readonly CompletionInvoiceRow[];
  readonly distributions: readonly DistributionView[];
  readonly claims: readonly ClaimDto[];
}

export interface MissionCompletionProjectionInput {
  readonly missionId: string;
  readonly obligations: readonly CommsObligationDto[];
  readonly pnl?: MissionPnlView;
  readonly invoices?: InvoicesView;
  readonly distributions?: MissionDistributionsView;
  readonly claims?: ClaimsView;
}

const actorNameOf = (label: string | null, userId: string): string => label?.trim() || userId;

export function projectMissionCompletion({
  missionId,
  obligations,
  pnl,
  invoices,
  distributions,
  claims,
}: MissionCompletionProjectionInput): MissionCompletionProjection {
  const obligationRows = [...obligations]
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt) || left.obligationId.localeCompare(right.obligationId))
    .map((obligation): CompletionObligationRow => {
      const provenance = deriveCommsAcceptanceProvenance(obligation);
      const selfAcceptance = deriveCommsSelfAcceptance(obligation);
      return {
        obligation,
        deliveryRecorded: obligation.evidence.length > 0,
        acceptanceRecorded: obligation.state === 'Accepted' || obligation.state === 'Done',
        doneRecorded: obligation.state === 'Done',
        acceptanceProvenance: selfAcceptance
          ? {
              shape: 'same-person',
              lifecycle: selfAcceptance.lifecycle,
              actorName: actorNameOf(selfAcceptance.actorLabel, selfAcceptance.actorUserId),
            }
          : provenance
            ? {
                shape: 'ordinary',
                lifecycle: provenance.lifecycle,
                actorName: actorNameOf(provenance.actorLabel, provenance.actorUserId),
              }
            : null,
      };
    });
  const activeIncome = pnl
    ? [...activeIncomeLinesOf(pnl)].sort(
        (left, right) => left.label.localeCompare(right.label) || left.lineId.localeCompare(right.lineId),
      )
    : [];
  const incomeCriterion: MissionCompletionProjection['incomeCriterion'] = pnl?.pnl.settlement.incomeComplete
    ? { kind: 'recorded-true' }
    : (pnl?.pnl.settlement.outstandingIncomeCount ?? 0) > 0
      ? { kind: 'outstanding', count: pnl!.pnl.settlement.outstandingIncomeCount }
      : { kind: 'no-qualifying-income' };
  const linesById = new Map((pnl?.lines ?? []).map((line) => [line.lineId, line]));
  const missionInvoices = [...(invoices?.invoices ?? [])]
    .filter((invoice) => invoice.missionId === missionId)
    .sort(
      (left, right) =>
        right.issuedOn.localeCompare(left.issuedOn) || left.invoiceNumber.localeCompare(right.invoiceNumber),
    )
    .map((invoice): CompletionInvoiceRow => ({
      invoice,
      linePaymentStatus: linesById.get(invoice.lineId)?.paymentStatus ?? null,
    }));
  const missionDistributions = [...(distributions?.distributions ?? [])]
    .filter(({ distribution }) => distribution.missionId === missionId)
    .sort(
      (left, right) =>
        right.distribution.createdAt.localeCompare(left.distribution.createdAt) ||
        left.distribution.distributionId.localeCompare(right.distribution.distributionId),
    )
    .map(({ distribution, shares }) => ({
      distribution,
      shares: [...shares].sort(
        (left, right) => left.personName.localeCompare(right.personName) || left.personId.localeCompare(right.personId),
      ),
    }));
  const missionClaims = [...(claims?.claims ?? [])]
    .filter((claim) => claim.missionId === missionId)
    .sort(
      (left, right) => right.expenseOn.localeCompare(left.expenseOn) || left.claimId.localeCompare(right.claimId),
    );

  return {
    obligations: obligationRows,
    activeIncome,
    incomeCriterion,
    invoices: missionInvoices,
    distributions: missionDistributions,
    claims: missionClaims,
  };
}

const obligationVariant = (state: CommsObligationDto['state']): StatusVariant => {
  if (state === 'Done') return 'ready';
  if (state === 'Accepted') return 'info';
  if (state === 'Delivered') return 'pending';
  return 'neutral';
};

const distributionVariant = (status: DistributionDto['status']): StatusVariant =>
  status === 'Live' ? 'info' : 'neutral';

const payoutVariant = (status: DistributionShareDto['payoutStatus']): StatusVariant =>
  status === 'Paid' ? 'ready' : 'pending';

const factCopy = (recorded: boolean, present: string, absent: string) => (recorded ? present : absent);

function LinkedLinePaymentFact({
  paymentStatus,
  pnlTruth,
}: {
  readonly paymentStatus: MissionLineDto['paymentStatus'] | null;
  readonly pnlTruth: WitnessState;
}) {
  const payment = paymentStatus ? paymentStatusOf(paymentStatus) : null;
  if (pnlTruth.kind === 'verified' || pnlTruth.kind === 'proven-empty') {
    return (
      <span data-truth="verified">
        {payment ? (
          <>
            Payment state · <StatusBadge variant={payment.variant}>{payment.label}</StatusBadge>
          </>
        ) : (
          'Payment state not present in the current Mission P&L witness.'
        )}
      </span>
    );
  }
  if (pnlTruth.kind === 'stale') {
    return (
      <span data-truth="stale">
        {payment ? (
          <>
            Last witnessed payment state · <StatusBadge variant={payment.variant}>{payment.label}</StatusBadge>
          </>
        ) : (
          'No payment state was present in the last P&L witness.'
        )}{' '}
        The Mission P&amp;L is stale.
      </span>
    );
  }
  return (
    <span data-truth={pnlTruth.kind}>
      Linked-line payment state withheld until the Mission P&amp;L has a current witness.
    </span>
  );
}

function RegisterBand({
  number,
  label,
  title,
  state,
  rechecking,
  emptyLabel,
  testId,
  children,
}: {
  readonly number: string;
  readonly label: string;
  readonly title: string;
  readonly state: WitnessState;
  readonly rechecking: boolean;
  readonly emptyLabel: string;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mission-completion-band" aria-labelledby={`${testId}-title`} data-source={testId}>
      <header className="mission-completion-band-heading">
        <span className="mission-completion-index" aria-hidden="true">{number}</span>
        <span>
          <small>{label}</small>
          <h2 id={`${testId}-title`}>{title}</h2>
        </span>
      </header>
      <RecheckingTruthPanel
        state={state}
        rechecking={rechecking}
        emptyLabel={emptyLabel}
        testids={{
          loading: `${testId}-loading`,
          verified: `${testId}-verified`,
          empty: `${testId}-empty`,
          denied: `${testId}-denied`,
          failed: `${testId}-failed`,
          stale: `${testId}-stale`,
        }}
      >
        {children}
      </RecheckingTruthPanel>
    </section>
  );
}

interface CompletionRechecking {
  readonly mission?: boolean;
  readonly obligations?: boolean;
  readonly pnl?: boolean;
  readonly invoices?: boolean;
  readonly distributions?: boolean;
  readonly claims?: boolean;
}

export interface MissionCompletionViewProps {
  readonly mission: MissionDto | undefined;
  readonly missionTruth: WitnessState;
  readonly obligationsTruth: WitnessState;
  readonly pnlTruth: WitnessState;
  readonly invoicesTruth: WitnessState;
  readonly distributionsTruth: WitnessState;
  readonly claimsTruth: WitnessState;
  readonly truth: WitnessState;
  readonly projection: MissionCompletionProjection;
  readonly financialsIncluded: boolean;
  readonly claimsIncluded: boolean;
  readonly claimsScope: 'tenant' | 'account';
  readonly rechecking?: CompletionRechecking;
}

export function MissionCompletionView({
  mission,
  missionTruth,
  obligationsTruth,
  pnlTruth,
  invoicesTruth,
  distributionsTruth,
  claimsTruth,
  truth,
  projection,
  financialsIncluded,
  claimsIncluded,
  claimsScope,
  rechecking = {},
}: MissionCompletionViewProps) {
  const financeStage = mission ? missionFinanceStageOf(mission.financeStage) : null;

  return (
    <section className="mission-completion" data-tablework="MissionCompletion" data-truth={truth.kind}>
      <header className="mission-completion-intro">
        <span className="mission-completion-sigil" aria-hidden="true"><i /><i /><i /></span>
        <span>
          <small>Mission record · independently witnessed registers</small>
          <h1>Completion Ledger</h1>
          <p>Recorded completion facts. No overall completion is inferred.</p>
        </span>
      </header>

      <p className="mission-completion-boundary" data-testid="mission-completion-boundary">
        Mission finance, Obligation facts, invoice status, line receipt, distribution standing, payout status, and claim status remain separate records. This surface joins their read models; it does not create a verdict, score, or new state.
      </p>

      <div className="mission-completion-registers">
        <RegisterBand
          number="01"
          label="Mission lifecycle"
          title="Recorded standing"
          state={missionTruth}
          rechecking={rechecking.mission ?? false}
          emptyLabel="The selected Mission was not returned. No lifecycle standing can be stated."
          testId="completion-mission"
        >
          {mission ? (
            <article className="mission-completion-mission-record">
              <span>
                <small>{mission.code ?? mission.missionId}</small>
                <strong>{mission.name}</strong>
                <span>{mission.city ?? 'No city recorded'} · {mission.startsOn}{mission.endsOn ? ` — ${mission.endsOn}` : ' — no end date recorded'}</span>
              </span>
              <span className="mission-completion-standing">
                <StatusBadge variant={mission.isActive ? 'ready' : 'neutral'}>{mission.isActive ? 'Active Mission' : 'Inactive Mission'}</StatusBadge>
                {financeStage ? <StatusBadge variant={financeStage.variant}>Finance lifecycle · {financeStage.label}</StatusBadge> : null}
              </span>
            </article>
          ) : null}
        </RegisterBand>

        <RegisterBand
          number="02"
          label="Durable asks"
          title="Obligation facts"
          state={obligationsTruth}
          rechecking={rechecking.obligations ?? false}
          emptyLabel="No Obligations were returned for this Mission. That says nothing about its finance or claim records."
          testId="completion-obligations"
        >
          <div className="mission-completion-stack">
            {projection.obligations.map((row) => {
              const provenance = row.acceptanceProvenance;
              return (
                <article className="mission-completion-record" key={row.obligation.obligationId}>
                  <header>
                    <span>
                      <small>{row.obligation.obligationId} · due {row.obligation.dueAt.slice(0, 10)}</small>
                      <strong>{row.obligation.description}</strong>
                    </span>
                    <StatusBadge variant={obligationVariant(row.obligation.state)}>{row.obligation.state}</StatusBadge>
                  </header>
                  <dl className="mission-completion-facts" aria-label="Independent Obligation facts">
                    <div data-recorded={row.deliveryRecorded ? 'true' : 'false'}>
                      <dt>Delivery</dt>
                      <dd>{factCopy(row.deliveryRecorded, `${row.obligation.evidence.length} evidence record${row.obligation.evidence.length === 1 ? '' : 's'}`, 'Not recorded')}</dd>
                    </div>
                    <div data-recorded={row.acceptanceRecorded ? 'true' : 'false'}>
                      <dt>Acceptance</dt>
                      <dd>{factCopy(row.acceptanceRecorded, 'Recorded', 'Not currently recorded')}</dd>
                    </div>
                    <div data-recorded={row.doneRecorded ? 'true' : 'false'}>
                      <dt>Done</dt>
                      <dd>{factCopy(row.doneRecorded, 'Recorded', 'Not recorded')}</dd>
                    </div>
                  </dl>
                  {provenance ? (
                    <p
                      className={`mission-completion-provenance${provenance.shape === 'same-person' ? ' is-same-person' : ''}`}
                      data-tablework="CompletionAcceptanceProvenance"
                      data-acceptance-shape={provenance.shape}
                      data-acceptance-lifecycle={provenance.lifecycle}
                      data-acceptance-emphasis={provenance.shape === 'same-person' && provenance.lifecycle === 'cancelled' ? 'governance-sensitive' : undefined}
                    >
                      <strong>
                        {provenance.lifecycle === 'cancelled'
                          ? provenance.shape === 'same-person'
                            ? 'Superseded same-person record'
                            : 'Superseded acceptance record'
                          : provenance.shape === 'same-person'
                            ? 'Same-person record'
                            : 'Acceptance provenance'}
                      </strong>
                      <span>
                        {provenance.lifecycle === 'cancelled' ? 'Before cancellation, ' : ''}
                        {provenance.shape === 'same-person'
                          ? `${provenance.actorName} both delivered evidence and accepted it as the named authority.`
                          : `${provenance.actorName} accepted it as the named authority.`}
                      </span>
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </RegisterBand>

        <RegisterBand
          number="03"
          label="Mission income"
          title="Receipt criterion"
          state={pnlTruth}
          rechecking={rechecking.pnl ?? false}
          emptyLabel="No active income line qualifies. Zero outstanding is not an income-complete fact."
          testId="completion-income"
        >
          <div className="mission-completion-ledger-note" data-income-criterion={projection.incomeCriterion.kind}>
            <strong>Income receipt criterion</strong>
            <span>
              {projection.incomeCriterion.kind === 'recorded-true'
                ? 'Recorded true · every active income line is Received.'
                : projection.incomeCriterion.kind === 'outstanding'
                  ? `${projection.incomeCriterion.count} active income line${projection.incomeCriterion.count === 1 ? '' : 's'} not Received.`
                  : 'No active income line qualifies. Zero outstanding does not mean complete.'}
            </span>
          </div>
          <div className="mission-completion-stack">
            {projection.activeIncome.map((line) => {
              const payment = line.paymentStatus ? paymentStatusOf(line.paymentStatus) : null;
              return (
                <article className="mission-completion-record is-compact" key={line.lineId}>
                  <header>
                    <span>
                      <small>{line.lineId} · {line.category}</small>
                      <strong>{line.label}</strong>
                      <span>{formatMinor(line.amountMinor, line.currency)}</span>
                    </span>
                    {payment ? <StatusBadge variant={payment.variant}>Line · {payment.label}</StatusBadge> : null}
                  </header>
                </article>
              );
            })}
          </div>
        </RegisterBand>

        <RegisterBand
          number="04"
          label="Issued artifacts"
          title="Invoices"
          state={invoicesTruth}
          rechecking={rechecking.invoices ?? false}
          emptyLabel="No invoice explicitly names this Mission. Income lines do not imply an invoice."
          testId="completion-invoices"
        >
          <p className="mission-completion-source-rule">Invoice standing and linked-line receipt are separate. An Issued invoice with a Received line is not labelled as a paid invoice.</p>
          <div className="mission-completion-stack">
            {projection.invoices.map(({ invoice, linePaymentStatus }) => {
              const invoiceStatus = invoiceStatusOf(invoice.status);
              return (
                <article className="mission-completion-record" key={invoice.invoiceId}>
                  <header>
                    <span>
                      <small>{invoice.invoiceNumber} · {invoice.invoiceId}</small>
                      <strong>{invoice.billedToName}</strong>
                      <span>{formatMinor(invoice.totalMinor, invoice.currency)} · issued {invoice.issuedOn} by {invoice.issuedBy}</span>
                    </span>
                    <StatusBadge variant={invoiceStatus.variant}>Invoice · {invoiceStatus.label}</StatusBadge>
                  </header>
                  <p className="mission-completion-linked-state">
                    <strong>Linked line · {invoice.lineId}</strong>
                    <LinkedLinePaymentFact paymentStatus={linePaymentStatus} pnlTruth={pnlTruth} />
                  </p>
                </article>
              );
            })}
          </div>
        </RegisterBand>

        <RegisterBand
          number="05"
          label="Distribution register"
          title="Distributions & payouts"
          state={distributionsTruth}
          rechecking={rechecking.distributions ?? false}
          emptyLabel="No Live or Revoked distribution explicitly names this Mission. Income receipt does not imply a distribution."
          testId="completion-distributions"
        >
          <p className="mission-completion-source-rule">Distribution standing belongs to the distribution. Paid or Pending belongs to each payout. Neither restates the Mission finance lifecycle.</p>
          <div className="mission-completion-stack">
            {projection.distributions.map(({ distribution, shares }) => (
              <article className="mission-completion-record" key={distribution.distributionId}>
                <header>
                  <span>
                    <small>{distribution.distributionId} · income line {distribution.lineId}</small>
                    <strong>{formatMinor(distribution.poolMinor, distribution.currency)} distribution pool</strong>
                    <span>Created by {distribution.createdBy}</span>
                  </span>
                  <StatusBadge variant={distributionVariant(distribution.status)}>Distribution · {distribution.status}</StatusBadge>
                </header>
                <ul className="mission-completion-payouts" aria-label={`Payouts for ${distribution.distributionId}`}>
                  {shares.map((share) => (
                    <li key={share.personId}>
                      <span><strong>{share.personName}</strong><small>{formatMinor(share.amountMinor, distribution.currency)}</small></span>
                      <StatusBadge variant={payoutVariant(share.payoutStatus)}>Payout · {share.payoutStatus}</StatusBadge>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </RegisterBand>

        <RegisterBand
          number="06"
          label="Explicit Mission references"
          title="Claims"
          state={claimsTruth}
          rechecking={rechecking.claims ?? false}
          emptyLabel="No readable claim explicitly names this Mission. Unlinked claims are not inferred into it."
          testId="completion-claims"
        >
          <p className="mission-completion-source-rule" data-claim-scope={claimsScope}>
            {claimsScope === 'tenant'
              ? 'All claims visible under financial standing, filtered only by explicit Mission ID.'
              : 'Only claims visible to the signed-in account, filtered only by explicit Mission ID.'}
          </p>
          <div className="mission-completion-stack">
            {projection.claims.map((claim) => {
              const status = claimStatusOf(claim.status);
              return (
                <article className="mission-completion-record is-compact" key={claim.claimId}>
                  <header>
                    <span>
                      <small>{claim.claimId} · {claim.category} · expense {claim.expenseOn}</small>
                      <strong>{claim.description}</strong>
                      <span>
                        {formatMinor(claim.amountMinor, claim.currency)} · submitted by {claim.submittedBy}
                        {claim.reviewedBy ? ` · reviewed by ${claim.reviewedBy}` : ''}
                      </span>
                    </span>
                    <StatusBadge variant={status.variant}>Claim · {status.label}</StatusBadge>
                  </header>
                </article>
              );
            })}
          </div>
        </RegisterBand>
      </div>

      {!financialsIncluded ? (
        <p className="mission-completion-omission" data-testid="completion-financials-not-requested">
          Financial registers are unavailable in this seat and were not requested. Their absence is not a zero.
        </p>
      ) : null}
      {!claimsIncluded ? (
        <p className="mission-completion-omission" data-testid="completion-claims-not-requested">
          The Claims register is unavailable in this seat and was not requested. Its absence is not an empty Mission claim record.
        </p>
      ) : null}
    </section>
  );
}

export interface MissionCompletionProps {
  readonly missionId: string;
  readonly mission: MissionDto | undefined;
  readonly missionTruth: WitnessState;
  readonly obligations: readonly CommsObligationDto[];
  readonly obligationsTruth: WitnessState;
  readonly missionRechecking?: boolean;
  readonly obligationsRechecking?: boolean;
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly requestKey?: string | number;
  readonly onTruthChange?: (truth: WitnessState) => void;
}

export function MissionCompletion({
  missionId,
  mission,
  missionTruth,
  obligations,
  obligationsTruth,
  missionRechecking = false,
  obligationsRechecking = false,
  enabled = true,
  foreground = true,
  requestKey,
  onTruthChange,
}: MissionCompletionProps) {
  const { me } = useSession();
  const financialsIncluded = me?.capabilities.canViewFinancials ?? false;
  const claimsIncluded = me?.capabilities.canReadClaims ?? false;
  const financialsEnabled = enabled && financialsIncluded;
  const claimsEnabled = enabled && claimsIncluded;
  const pnlQuery = useMissionPnl(missionId, financialsEnabled);
  const invoicesQuery = useInvoices(financialsEnabled);
  const distributionsQuery = useMissionDistributions(missionId, financialsEnabled);
  const claimsQuery = useClaims(claimsEnabled);
  const pnlRewitnessing = useForegroundRewitness({
    foreground,
    enabled: financialsEnabled,
    refetch: pnlQuery.refetch,
    requestKey: `${String(requestKey ?? 'direct')}:${missionId}:income`,
  });
  const invoicesRewitnessing = useForegroundRewitness({
    foreground,
    enabled: financialsEnabled,
    refetch: invoicesQuery.refetch,
    requestKey: `${String(requestKey ?? 'direct')}:${missionId}:invoices`,
  });
  const distributionsRewitnessing = useForegroundRewitness({
    foreground,
    enabled: financialsEnabled,
    refetch: distributionsQuery.refetch,
    requestKey: `${String(requestKey ?? 'direct')}:${missionId}:distributions`,
  });
  const claimsRewitnessing = useForegroundRewitness({
    foreground,
    enabled: claimsEnabled,
    refetch: claimsQuery.refetch,
    requestKey: `${String(requestKey ?? 'direct')}:${missionId}:claims`,
  });

  const pnlData = financialsIncluded ? pnlQuery.data : undefined;
  const invoicesData = financialsIncluded ? invoicesQuery.data : undefined;
  const distributionsData = financialsIncluded ? distributionsQuery.data : undefined;
  const claimsData = claimsIncluded ? claimsQuery.data : undefined;
  const pnlTruth = useMemo(
    () =>
      missionPnlCompletionTruthOf({
        included: financialsIncluded,
        data: pnlData,
        error: pnlQuery.error,
        isLoading: pnlQuery.isLoading,
        isFetching: pnlQuery.isFetching || pnlRewitnessing,
        dataUpdatedAt: pnlQuery.dataUpdatedAt,
      }),
    [financialsIncluded, pnlData, pnlQuery.dataUpdatedAt, pnlQuery.error, pnlQuery.isFetching, pnlQuery.isLoading, pnlRewitnessing],
  );
  const invoicesTruth = useMemo(
    () =>
      invoicesCompletionTruthOf(
        {
          included: financialsIncluded,
          data: invoicesData,
          error: invoicesQuery.error,
          isLoading: invoicesQuery.isLoading,
          isFetching: invoicesQuery.isFetching || invoicesRewitnessing,
          dataUpdatedAt: invoicesQuery.dataUpdatedAt,
        },
        missionId,
      ),
    [
      financialsIncluded,
      invoicesData,
      invoicesQuery.dataUpdatedAt,
      invoicesQuery.error,
      invoicesQuery.isFetching,
      invoicesQuery.isLoading,
      invoicesRewitnessing,
      missionId,
    ],
  );
  const distributionsTruth = useMemo(
    () =>
      distributionsCompletionTruthOf(
        {
          included: financialsIncluded,
          data: distributionsData,
          error: distributionsQuery.error,
          isLoading: distributionsQuery.isLoading,
          isFetching: distributionsQuery.isFetching || distributionsRewitnessing,
          dataUpdatedAt: distributionsQuery.dataUpdatedAt,
        },
        missionId,
      ),
    [
      distributionsData,
      distributionsQuery.dataUpdatedAt,
      distributionsQuery.error,
      distributionsQuery.isFetching,
      distributionsQuery.isLoading,
      distributionsRewitnessing,
      financialsIncluded,
      missionId,
    ],
  );
  const claimsTruth = useMemo(
    () =>
      claimsCompletionTruthOf(
        {
          included: claimsIncluded,
          data: claimsData,
          error: claimsQuery.error,
          isLoading: claimsQuery.isLoading,
          isFetching: claimsQuery.isFetching || claimsRewitnessing,
          dataUpdatedAt: claimsQuery.dataUpdatedAt,
        },
        missionId,
      ),
    [
      claimsData,
      claimsIncluded,
      claimsQuery.dataUpdatedAt,
      claimsQuery.error,
      claimsQuery.isFetching,
      claimsQuery.isLoading,
      claimsRewitnessing,
      missionId,
    ],
  );
  const truth = useMemo(
    () =>
      joinMissionCompletionTruth({
        mission: missionTruth,
        obligations: obligationsTruth,
        pnl: pnlTruth,
        invoices: invoicesTruth,
        distributions: distributionsTruth,
        claims: claimsTruth,
        financialsIncluded,
        claimsIncluded,
      }),
    [
      claimsIncluded,
      claimsTruth,
      distributionsTruth,
      financialsIncluded,
      invoicesTruth,
      missionTruth,
      obligationsTruth,
      pnlTruth,
    ],
  );
  const projection = useMemo(
    () =>
      projectMissionCompletion({
        missionId,
        obligations,
        ...(pnlData ? { pnl: pnlData } : {}),
        ...(invoicesData ? { invoices: invoicesData } : {}),
        ...(distributionsData ? { distributions: distributionsData } : {}),
        ...(claimsData ? { claims: claimsData } : {}),
      }),
    [claimsData, distributionsData, invoicesData, missionId, obligations, pnlData],
  );

  useLayoutEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  return (
    <MissionCompletionView
      mission={mission}
      missionTruth={missionTruth}
      obligationsTruth={obligationsTruth}
      pnlTruth={pnlTruth}
      invoicesTruth={invoicesTruth}
      distributionsTruth={distributionsTruth}
      claimsTruth={claimsTruth}
      truth={truth}
      projection={projection}
      financialsIncluded={financialsIncluded}
      claimsIncluded={claimsIncluded}
      claimsScope={financialsIncluded ? 'tenant' : 'account'}
      rechecking={{
        mission: missionRechecking,
        obligations: obligationsRechecking,
        pnl: pnlQuery.data !== undefined && pnlQuery.error == null && (pnlQuery.isFetching || pnlRewitnessing),
        invoices: invoicesQuery.data !== undefined && invoicesQuery.error == null && (invoicesQuery.isFetching || invoicesRewitnessing),
        distributions:
          distributionsQuery.data !== undefined &&
          distributionsQuery.error == null &&
          (distributionsQuery.isFetching || distributionsRewitnessing),
        claims: claimsQuery.data !== undefined && claimsQuery.error == null && (claimsQuery.isFetching || claimsRewitnessing),
      }}
    />
  );
}
