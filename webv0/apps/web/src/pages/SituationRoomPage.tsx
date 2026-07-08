import { Link, useNavigate } from 'react-router-dom';
import { Button, makeStyles, mergeClasses } from '@fluentui/react-components';
import type { SignalDto } from '@c3web/api-contracts';
import { useSituation } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';

/**
 * The Situation Room (Sprint 43) — the operational cockpit. Story cards with
 * their reasoning printed, explainable priority, and the next action one
 * click away. The Command Desk visual language debuts here: severity accent
 * rails, eyebrow taxonomy, mono facts, and an all-clear that enumerates its
 * checks so silence is provably not blindness.
 */

const useStyles = makeStyles({
  grid: { display: 'flex', flexDirection: 'column', rowGap: '14px', maxWidth: '860px' },
  card: {
    position: 'relative',
    backgroundColor: 'var(--c3-identity-white)',
    border: '1px solid var(--c3-hairline)',
    borderRadius: 'var(--c3-radius)',
    boxShadow: 'var(--c3-e1)',
    padding: '16px 20px 14px 24px',
    overflow: 'hidden',
  },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px' },
  railImmediate: { backgroundColor: 'var(--c3-signal-red)' },
  railAttention: { backgroundColor: 'var(--c3-status-pending)' },
  railWatch: { backgroundColor: 'var(--c3-ink-35)' },
  railInMotion: { backgroundColor: 'var(--c3-hairline)' },
  topRow: { display: 'flex', alignItems: 'baseline', columnGap: '10px', flexWrap: 'wrap' },
  eyebrow: {
    fontSize: '11px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-50)',
    fontWeight: 600,
  },
  scoreChip: {
    marginLeft: 'auto',
    fontFamily: 'ui-monospace, monospace',
    fontSize: '11px',
    color: 'var(--c3-ink-50)',
    border: '1px solid var(--c3-hairline)',
    borderRadius: '999px',
    padding: '2px 10px',
    whiteSpace: 'nowrap',
  },
  inMotionChip: {
    marginLeft: 'auto',
    fontSize: '11px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-50)',
    border: '1px dashed var(--c3-hairline)',
    borderRadius: '999px',
    padding: '2px 10px',
    whiteSpace: 'nowrap',
  },
  headline: { fontSize: '16px', lineHeight: '24px', fontWeight: 600, color: 'var(--c3-command-black)', margin: '6px 0 8px' },
  reasons: { margin: '0 0 12px', paddingLeft: '18px', display: 'flex', flexDirection: 'column', rowGap: '3px' },
  reason: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-70)' },
  actions: { display: 'flex', columnGap: '8px', rowGap: '8px', flexWrap: 'wrap' },
  allClearChecks: { margin: '12px 0 0', paddingLeft: '18px', display: 'flex', flexDirection: 'column', rowGap: '4px' },
  check: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-50)' },
  checkedNote: { fontSize: '12px', color: 'var(--c3-ink-50)', marginTop: '16px' },
});

const KIND_LABEL: Record<SignalDto['kind'], string> = {
  MissionReadiness: 'Mission readiness',
  CredentialExpiry: 'Credential expiry',
  AgreementWindow: 'Agreement renewal',
  ApprovalStale: 'Awaiting decision',
  ExecutionFailedRecovery: 'Execution recovery',
  OwnerWedge: 'Governance wedge',
  JourneyStalled: 'Journey stalled',
};

function actionTarget(a: SignalDto['actions'][number]): { label: string; to: string } | null {
  switch (a.kind) {
    case 'AddCredential':
      return a.personId ? { label: 'Request credential →', to: `/people/${a.personId}` } : null;
    case 'RenewAgreement':
      return a.agreementId ? { label: 'Renew agreement →', to: `/agreements/${a.agreementId}` } : null;
    case 'ReviewApproval':
      return a.approvalId ? { label: 'Review request →', to: `/approvals/${a.approvalId}` } : null;
    case 'ResubmitOrExecute':
      return a.approvalId ? { label: 'Recover execution →', to: `/approvals/${a.approvalId}` } : null;
    case 'WithdrawOwnRequest':
      return a.approvalId ? { label: 'Withdraw or resolve →', to: `/approvals/${a.approvalId}` } : null;
    case 'ViewMission':
      return a.missionId ? { label: 'View mission', to: `/missions/${a.missionId}` } : null;
    case 'ViewPerson':
      return a.personId ? { label: `View ${a.personId}`, to: `/people/${a.personId}` } : null;
    case 'ViewAgreement':
      return a.agreementId ? { label: 'View agreement', to: `/agreements/${a.agreementId}` } : null;
    case 'ViewApproval':
      return a.approvalId ? { label: 'View request', to: `/approvals/${a.approvalId}` } : null;
    case 'ViewJourney':
      return a.journeyId ? { label: 'View journeys', to: '/journeys' } : null;
    default:
      return null;
  }
}

function SignalCard({ signal }: { signal: SignalDto }) {
  const s = useStyles();
  const navigate = useNavigate();
  const rail =
    signal.band === 'immediate'
      ? s.railImmediate
      : signal.band === 'attention'
        ? s.railAttention
        : signal.band === 'inMotion'
          ? s.railInMotion
          : s.railWatch;
  const targets = signal.actions.map(actionTarget).filter((t): t is { label: string; to: string } => t !== null);
  // De-duplicate targets pointing at the same route (a story may suggest the same person twice).
  const seen = new Set<string>();
  const unique = targets.filter((t) => (seen.has(t.to) ? false : (seen.add(t.to), true)));

  return (
    <article className={s.card} data-testid={`signal-${signal.key}`} aria-label={signal.headline}>
      <div className={mergeClasses(s.rail, rail)} aria-hidden="true" />
      <div className={s.topRow}>
        <span className={s.eyebrow}>{KIND_LABEL[signal.kind]}</span>
        {signal.band === 'inMotion' ? (
          <span className={s.inMotionChip} data-testid={`signal-band-${signal.key}`}>
            In motion
          </span>
        ) : (
          <span className={s.scoreChip} data-testid={`signal-band-${signal.key}`} title="Priority = impact × urgency — the components are the reasons below">
            P{signal.score} · impact {signal.impact} × urgency {signal.urgency}
          </span>
        )}
      </div>
      <h2 className={s.headline}>{signal.headline}</h2>
      <ul className={s.reasons}>
        {signal.reasons.map((rr, i) => (
          <li key={i} className={s.reason}>
            {rr}
          </li>
        ))}
      </ul>
      <div className={s.actions}>
        {unique.map((t, i) => (
          <Button
            key={t.to}
            appearance={i === 0 && signal.band !== 'inMotion' ? 'primary' : 'secondary'}
            size="small"
            data-testid={i === 0 ? `signal-action-${signal.key}` : undefined}
            onClick={() => navigate(t.to)}
          >
            {t.label}
          </Button>
        ))}
      </div>
    </article>
  );
}

export function SituationRoomPage() {
  const s = useStyles();
  const { me } = useSession();
  const operational = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const { data, isLoading, isError, error } = useSituation(operational);

  if (!operational) {
    return (
      <div>
        <PageHeader title="Situation Room" />
        <EmptyState data-testid="situation-denied" message="The Situation Room is an operational surface and is not available for your role." />
      </div>
    );
  }

  const live = data?.signals.filter((x) => x.band !== 'inMotion') ?? [];
  const inMotion = data?.signals.filter((x) => x.band === 'inMotion') ?? [];

  return (
    <div>
      <PageHeader
        title="Situation Room"
        context={data ? (data.signals.length === 0 ? 'All clear' : `${live.length} need attention · ${inMotion.length} in motion`) : undefined}
      />
      {isLoading && <LoadingState label="Reading the situation…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not read the situation.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.signals.length === 0 && (
        <div data-testid="situation-all-clear">
          <EmptyState message="Nothing needs your attention." />
          <p className={s.checkedNote}>Checked just now, across the whole organization:</p>
          <ul className={s.allClearChecks} data-testid="situation-checks">
            {data.checks.map((c, i) => (
              <li key={i} className={s.check}>
                ✓ {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data && data.signals.length > 0 && (
        <div className={s.grid} data-testid="situation-signals">
          {[...live, ...inMotion].map((signal) => (
            <SignalCard key={signal.key} signal={signal} />
          ))}
        </div>
      )}
      {data && data.signals.length > 0 && (
        <p className={s.checkedNote}>
          Priority is impact × urgency, shown on every card. Signals with a matching pending request are “in motion.”{' '}
          <Link to="/approvals">Open approvals →</Link>
        </p>
      )}
    </div>
  );
}
