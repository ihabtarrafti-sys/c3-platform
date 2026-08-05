import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { SignalDto, SituationResponse } from '@c3web/api-contracts';
import { ApiError } from '../api';
import { useSituation } from '../queries';
import { useSession } from '../session';
import { ago } from '../shellModel';
import { useForegroundRewitness } from './useForegroundRewitness';
import { truthStateOf, type WitnessState } from './TruthPanel';

const SIGNAL_LABELS: Readonly<Record<SignalDto['kind'], string>> = {
  MissionReadiness: 'Mission readiness',
  CredentialExpiry: 'Credential expiry',
  AgreementWindow: 'Agreement renewal',
  ApprovalStale: 'Awaiting decision',
  ExecutionFailedRecovery: 'Execution recovery',
  OwnerWedge: 'Governance wedge',
  JourneyStalled: 'Journey stalled',
  IncomeNotInvoiced: 'Income not invoiced',
  PaymentOutstanding: 'Payment outstanding',
  TeamUnstaffed: 'Unstaffed division',
  PayoutsOutstanding: 'Payouts owed',
  ClaimsAwaitingReview: 'Claims waiting',
  DelegationActive: 'Delegation active',
  RejectedAwaitingRevision: 'Rejected, unrevised',
  DepartureIncomplete: 'Departure incomplete',
  ClaimsAwaitingPayment: 'Claims awaiting payment',
};

export interface ConstellationTruthFacts {
  readonly canView: boolean;
  readonly data: SituationResponse | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

/** The organization signal engine owns its witness. Mission/Comms health can
 * neither grant this read nor turn a failed read into a quiet constellation. */
export function constellationTruthOf({
  canView,
  data,
  error,
  isLoading,
  isFetching,
  dataUpdatedAt,
}: ConstellationTruthFacts): WitnessState {
  if (!canView) return { kind: 'denied', reasonClass: 'SITUATION_UNAVAILABLE' };
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return { kind: 'denied', reasonClass: error.code || `HTTP_${error.status}` };
  }

  const base = truthStateOf(
    { data, error, isLoading, dataUpdatedAt },
    (view) => view.signals.length === 0,
  );
  if (isFetching && data !== undefined && (base.kind === 'verified' || base.kind === 'proven-empty')) {
    return {
      kind: 'stale',
      verifiedAt: new Date(dataUpdatedAt > 0 ? dataUpdatedAt : 0),
      message: 'The organization signal field is being checked again.',
    };
  }
  return base;
}

export function constellationActionTarget(action: SignalDto['actions'][number]): string | null {
  switch (action.kind) {
    case 'AddCredential':
      return action.personId ? `/people/${action.personId}` : null;
    case 'RenewAgreement':
      return action.agreementId ? `/agreements/${action.agreementId}` : null;
    case 'ReviewApproval':
    case 'ResubmitOrExecute':
    case 'WithdrawOwnRequest':
    case 'ViewApproval':
      return action.approvalId ? `/approvals/${action.approvalId}` : null;
    case 'ViewMission':
      return action.missionId ? `/missions/${action.missionId}/comms` : null;
    case 'ViewPerson':
      return action.personId ? `/people/${action.personId}` : null;
    case 'ViewAgreement':
      return action.agreementId ? `/agreements/${action.agreementId}` : null;
    case 'ViewJourney':
      return action.journeyId ? '/journeys' : null;
    default:
      return null;
  }
}

export interface CommandConstellationProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly onTruthChange?: (truth: WitnessState) => void;
  readonly hrefForAction?: (action: SignalDto['actions'][number]) => string | null;
}

/**
 * A compact, explainable command field for Workspace OS. It is deliberately a
 * read-and-navigate surface: score components stay printed, cards never mutate,
 * and an all-clear is shown only beside the exact checks that earned it.
 */
export function CommandConstellation({
  enabled = true,
  foreground = true,
  onTruthChange,
  hrefForAction = constellationActionTarget,
}: CommandConstellationProps = {}) {
  const { me } = useSession();
  const canView = me?.capabilities.canViewSituation ?? false;
  const queryEnabled = enabled && canView;
  const query = useSituation(queryEnabled);
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = query;
  const rewitnessing = useForegroundRewitness({ foreground, enabled: queryEnabled, refetch });
  const truth = useMemo(
    () =>
      constellationTruthOf({
        canView,
        data,
        error,
        isLoading,
        isFetching: isFetching || rewitnessing,
        dataUpdatedAt,
      }),
    [canView, data, error, isLoading, isFetching, rewitnessing, dataUpdatedAt],
  );

  useEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  const body = data ? (
    <div className="command-constellation-body">
      <div className="command-constellation-counts" aria-label="Organization command counts">
        <span><strong>{data.counts.activeMissions}</strong><small>Active missions</small></span>
        <span><strong>{data.counts.rosteredPlayers}</strong><small>Rostered people</small></span>
        <span><strong>{data.counts.openApprovals}</strong><small>Open approvals</small></span>
      </div>
      <div className="command-constellation-checks" aria-label="Signal checks that ran">
        <header>
          <strong>{data.checks.length} checks ran</strong>
          <small>{data.signals.length === 0 ? 'Silence proven' : 'Reasoning visible'}</small>
        </header>
        <ul>
          {data.checks.map((check) => <li key={check}>{check}</li>)}
        </ul>
      </div>
      {data.signals.length > 0 ? (
        <div className="command-constellation-signals" data-testid="constellation-signals">
          {data.signals.map((signal) => {
            const targets = signal.actions
              .map((action) => ({ action, href: hrefForAction(action) }))
              .filter((target): target is { action: SignalDto['actions'][number]; href: string } => target.href !== null);
            return (
              <article key={signal.key} className="command-constellation-signal" data-signal-band={signal.band}>
                <header>
                  <span>{SIGNAL_LABELS[signal.kind]}</span>
                  <small>{signal.band === 'inMotion' ? 'In motion' : `P${signal.score} · ${signal.impact} × ${signal.urgency}`}</small>
                </header>
                <h3>{signal.headline}</h3>
                <ul>{signal.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                {targets.length > 0 ? (
                  <div className="message-actions">
                    {targets.map(({ action, href }) => (
                      <Link key={`${action.kind}:${href}`} className="mini-action" to={href}>
                        Open {action.kind.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  ) : null;

  switch (truth.kind) {
    case 'loading':
      return <p className="boundary-note" data-truth="loading">Checking the organization signal field…</p>;
    case 'denied':
      return <div className="field-error-block" data-truth="denied">Your standing does not include the organization signal field ({truth.reasonClass}).</div>;
    case 'fetch-failed':
      return <div className="field-error-block" role="alert" data-truth="fetch-failed">The signal field could not be read. No all-clear has been issued. {truth.message}</div>;
    case 'stale':
      return (
        <div data-truth="stale">
          <p className="field-error-block" role="status">Last verified {ago(truth.verifiedAt.toISOString())}; checking again. No current all-clear is claimed.</p>
          {body}
        </div>
      );
    case 'proven-empty':
      return (
        <div data-truth="proven-empty" data-testid="constellation-clear">
          <p className="boundary-note">Nothing is firing. The checks below earned that quiet at {truth.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
          {body}
        </div>
      );
    case 'verified':
      return <div data-truth="verified">{body}</div>;
  }
}
