import { Link, useNavigate } from 'react-router-dom';
import { Button, makeStyles, mergeClasses } from '@fluentui/react-components';
import { SITUATION_CHECK_KINDS } from '@c3web/domain';
import type { SignalDto } from '@c3web/api-contracts';
import { useSituation } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';

/**
 * The Situation Room (S43 engine · S46 cockpit v2 from the approved Design
 * packet). Story cards with their reasoning printed, explainable priority,
 * a stat ribbon and an always-on check ledger from the SAME one-pass read —
 * silence is provably not blindness in every state, not just all-clear.
 *
 * Motion here runs at the approved level-4 ceiling (Situation Room ONLY):
 * staggered card rise, a once-on-load scan sweep, and ONE pulse dot on the
 * single top signal. Governed actions stay calm — cards never mutate;
 * they navigate into context.
 */

const useStyles = makeStyles({
  // ── stat ribbon ────────────────────────────────────────────────────────────
  ribbon: {
    display: 'flex',
    flexWrap: 'wrap',
    border: '1px solid var(--c3-hairline)',
    borderRadius: 'var(--c3-radius)',
    backgroundColor: 'var(--c3-identity-white)',
    boxShadow: 'var(--c3-e1)',
    marginBottom: '18px',
    overflow: 'hidden',
    position: 'relative',
  },
  ribbonCell: {
    flexGrow: 1,
    flexBasis: '150px',
    padding: '14px 20px 12px',
    borderRight: '1px solid var(--c3-hairline)',
    ':last-child': { borderRight: 'none' },
  },
  ribbonLabel: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '10.5px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    fontWeight: 500,
    color: 'var(--c3-ink-50)',
    whiteSpace: 'nowrap',
  },
  ribbonValue: {
    fontSize: '28px',
    lineHeight: '36px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--c3-command-black)',
  },
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '28%',
    background: 'linear-gradient(90deg, transparent, rgba(13,13,13,0.045), transparent)',
    animationName: 'c3-sweep',
    animationDuration: 'var(--c3-dur-sweep)',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 1,
    pointerEvents: 'none',
  },

  // ── signal cards ───────────────────────────────────────────────────────────
  grid: { display: 'flex', flexDirection: 'column', rowGap: '14px', maxWidth: '980px' },
  card: {
    position: 'relative',
    backgroundColor: 'var(--c3-identity-white)',
    border: '1px solid var(--c3-hairline)',
    borderRadius: 'var(--c3-radius)',
    boxShadow: 'var(--c3-e1)',
    padding: '16px 20px 14px 24px',
    overflow: 'hidden',
    animationName: 'c3-rise',
    animationDuration: 'var(--c3-dur-rise)',
    animationTimingFunction: 'var(--c3-ease)',
    animationFillMode: 'backwards',
  },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px' },
  railImmediate: { backgroundColor: 'var(--c3-signal-red)' },
  railAttention: { backgroundColor: 'var(--c3-status-pending)' },
  railWatch: { backgroundColor: 'var(--c3-ink-35)' },
  railInMotion: { backgroundColor: 'var(--c3-hairline)' },
  topRow: { display: 'flex', alignItems: 'baseline', columnGap: '10px', flexWrap: 'wrap' },
  eyebrow: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-50)',
    fontWeight: 500,
  },
  pulseDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: 'var(--c3-signal-red)',
    flexShrink: 0,
    alignSelf: 'center',
    animationName: 'c3-pulse',
    animationDuration: 'var(--c3-dur-pulse)',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  scoreChip: {
    marginLeft: 'auto',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    color: 'var(--c3-ink-50)',
    border: '1px solid var(--c3-hairline)',
    borderRadius: '999px',
    padding: '2px 10px',
    whiteSpace: 'nowrap',
  },
  inMotionChip: {
    marginLeft: 'auto',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-50)',
    border: '1px dashed var(--c3-hairline)',
    borderRadius: '999px',
    padding: '2px 10px',
    whiteSpace: 'nowrap',
  },
  headline: { fontSize: '17px', lineHeight: '25px', fontWeight: 600, color: 'var(--c3-command-black)', margin: '6px 0 8px' },
  reasons: { margin: '0 0 12px', paddingLeft: '18px', display: 'flex', flexDirection: 'column', rowGap: '3px' },
  reason: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-70)' },
  actions: { display: 'flex', columnGap: '8px', rowGap: '8px', flexWrap: 'wrap' },

  // ── the check ledger (always on) ───────────────────────────────────────────
  ledger: {
    border: '1px solid var(--c3-hairline)',
    borderRadius: 'var(--c3-radius)',
    backgroundColor: 'var(--c3-identity-white)',
    boxShadow: 'var(--c3-e1)',
    marginTop: '20px',
    maxWidth: '980px',
  },
  ledgerHead: {
    display: 'flex',
    alignItems: 'baseline',
    padding: '12px 20px',
    borderBottom: '1px solid var(--c3-hairline)',
  },
  ledgerTitle: { fontSize: '14px', fontWeight: 600, color: 'var(--c3-command-black)' },
  ledgerMeta: {
    marginLeft: 'auto',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '10.5px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-50)',
  },
  ledgerRow: {
    display: 'flex',
    alignItems: 'center',
    columnGap: '12px',
    padding: '9px 20px',
    borderBottom: '1px solid var(--c3-hairline)',
    ':last-child': { borderBottom: 'none' },
  },
  ledgerDot: { width: '7px', height: '7px', borderRadius: '2px', flexShrink: 0 },
  dotFiring: { backgroundColor: 'var(--c3-signal-red)' },
  dotWatching: { backgroundColor: 'var(--c3-command-black)' },
  dotMoving: { backgroundColor: 'var(--c3-ink-35)' },
  dotClear: { backgroundColor: 'var(--c3-status-ready)' },
  ledgerText: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-70)' },
  ledgerState: {
    marginLeft: 'auto',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11.5px',
    whiteSpace: 'nowrap',
    color: 'var(--c3-ink-50)',
  },
  stateFiring: { color: 'var(--c3-signal-red)', fontWeight: 600 },
  stateWatching: { color: 'var(--c3-command-black)', fontWeight: 600 },

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

function SignalCard({ signal, index, pulse }: { signal: SignalDto; index: number; pulse: boolean }) {
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
    <article
      className={s.card}
      style={{ animationDelay: `${index * 70}ms` }}
      data-testid={`signal-${signal.key}`}
      aria-label={signal.headline}
    >
      <div className={mergeClasses(s.rail, rail)} aria-hidden="true" />
      <div className={s.topRow}>
        {pulse && <span className={s.pulseDot} aria-hidden="true" />}
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

interface RibbonCounts {
  activeMissions: number;
  rosteredPlayers: number;
  credentialsTracked: number;
  liveAgreements: number;
  openApprovals: number;
}
const RIBBON: Array<{ label: string; pick: (c: RibbonCounts) => number }> = [
  { label: 'Active missions', pick: (c) => c.activeMissions },
  { label: 'Rostered players', pick: (c) => c.rosteredPlayers },
  { label: 'Credentials tracked', pick: (c) => c.credentialsTracked },
  { label: 'Live agreements', pick: (c) => c.liveAgreements },
  { label: 'Open approvals', pick: (c) => c.openApprovals },
];

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
  const topKey = live[0]?.key ?? null;

  // The always-on check ledger: each engine check line reports its live state,
  // derived from the SAME signals array — one engine, no second source.
  const ledger = (data?.checks ?? []).map((text, i) => {
    const kind = SITUATION_CHECK_KINDS[i];
    const of = (data?.signals ?? []).filter((x) => x.kind === kind);
    const firing = of.filter((x) => x.band === 'immediate' || x.band === 'attention').length;
    const watching = of.filter((x) => x.band === 'watch').length;
    const moving = of.filter((x) => x.band === 'inMotion').length;
    const tone = firing > 0 ? 'firing' : watching > 0 ? 'watching' : moving > 0 ? 'moving' : 'clear';
    const state =
      firing > 0 ? `${firing} firing` : watching > 0 ? `${watching} watching` : moving > 0 ? `${moving} in motion` : 'clear';
    return { text, tone, state };
  });

  const ledgerPanel = data ? (
    <div className={s.ledger} data-testid="situation-checks">
      <div className={s.ledgerHead}>
        <span className={s.ledgerTitle}>Checked just now, across the whole organization</span>
        <span className={s.ledgerMeta}>7 checks · engine-derived</span>
      </div>
      {ledger.map((row, i) => (
        <div key={i} className={s.ledgerRow}>
          <span
            className={mergeClasses(
              s.ledgerDot,
              row.tone === 'firing' ? s.dotFiring : row.tone === 'watching' ? s.dotWatching : row.tone === 'moving' ? s.dotMoving : s.dotClear,
            )}
            aria-hidden="true"
          />
          <span className={s.ledgerText}>{row.text}</span>
          <span className={mergeClasses(s.ledgerState, row.tone === 'firing' && s.stateFiring, row.tone === 'watching' && s.stateWatching)}>
            {row.state}
          </span>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div>
      <PageHeader
        kicker="Situation"
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

      {data && (
        <div className={s.ribbon} data-testid="situation-ribbon">
          <div className={s.sweep} aria-hidden="true" />
          {RIBBON.map((cell) => (
            <div key={cell.label} className={s.ribbonCell}>
              <div className={s.ribbonLabel}>{cell.label}</div>
              <div className={s.ribbonValue}>{cell.pick(data.counts)}</div>
            </div>
          ))}
        </div>
      )}

      {data && data.signals.length === 0 && (
        <div data-testid="situation-all-clear">
          <EmptyState message="Nothing needs your attention." />
          {ledgerPanel}
        </div>
      )}
      {data && data.signals.length > 0 && (
        <>
          <div className={s.grid} data-testid="situation-signals">
            {[...live, ...inMotion].map((signal, i) => (
              <SignalCard key={signal.key} signal={signal} index={i} pulse={signal.key === topKey && signal.band !== 'watch'} />
            ))}
          </div>
          {ledgerPanel}
          <p className={s.checkedNote}>
            Priority is impact × urgency, shown on every card. Signals with a matching pending request are “in motion.”{' '}
            <Link to="/approvals">Open approvals →</Link>
          </p>
        </>
      )}
    </div>
  );
}
