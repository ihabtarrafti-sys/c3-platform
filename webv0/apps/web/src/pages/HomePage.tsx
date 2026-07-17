import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@fluentui/react-components';
import { SITUATION_CHECK_KINDS } from '@c3web/domain';
import type { SignalDto } from '@c3web/api-contracts';
import { useSituation } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import '../theme/hearth-home.css';

/**
 * Home — signature screen 03 (re-skin chapter). REPLACES the Situation Room
 * as the operational landing (owner-approved; the war-room name retires).
 * The post-sign-in "your world is alive" moment: welcome, the domains
 * spelled out, the REAL situation signals as calm nudges, the always-on
 * check ledger, and the three scales of the product made explicit.
 *
 * The data flow is UNCHANGED from the Situation Room: one useSituation read
 * feeding the pure engine's output straight to the screen. No SQL scoping
 * rode along — that lands only behind the L-05b equivalence harness
 * (packages/persistence/test/l05bHarness.ts). Every situation-* / signal-*
 * test id is preserved; only the room around them changed.
 *
 * Glass law: every in-flow surface here is opaque (the S47 floating signal
 * cards retire). Silence is provably not blindness: the ledger renders in
 * every state.
 */

const KIND_LABEL: Record<SignalDto['kind'], string> = {
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

function SignalNudge({ signal }: { signal: SignalDto }) {
  const navigate = useNavigate();
  const thread =
    signal.band === 'immediate'
      ? 'hh-thread--immediate'
      : signal.band === 'attention'
        ? 'hh-thread--attention'
        : signal.band === 'inMotion'
          ? 'hh-thread--inMotion'
          : 'hh-thread--watch';
  const targets = signal.actions.map(actionTarget).filter((t): t is { label: string; to: string } => t !== null);
  const seen = new Set<string>();
  const unique = targets.filter((t) => (seen.has(t.to) ? false : (seen.add(t.to), true)));

  return (
    <article className="hh-signal" data-testid={`signal-${signal.key}`} aria-label={signal.headline}>
      <span className={`hh-signal__thread ${thread}`} aria-hidden="true" />
      <div className="hh-signal__top">
        <span className="hh-signal__kind">{KIND_LABEL[signal.kind]}</span>
        {signal.band === 'inMotion' ? (
          <span className="hh-signal__chip hh-signal__chip--motion" data-testid={`signal-band-${signal.key}`}>
            In motion
          </span>
        ) : (
          <span
            className="hh-signal__chip"
            data-testid={`signal-band-${signal.key}`}
            title="Priority = impact × urgency — the components are the reasons below"
          >
            P{signal.score} · impact {signal.impact} × urgency {signal.urgency}
          </span>
        )}
      </div>
      <h3 className="hh-signal__headline">{signal.headline}</h3>
      <ul className="hh-signal__reasons">
        {signal.reasons.map((rr, i) => (
          <li key={i}>{rr}</li>
        ))}
      </ul>
      <div className="hh-signal__actions">
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

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function HomePage() {
  const { me } = useSession();
  const operational = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const { data, isLoading, isError, error } = useSituation(operational);

  if (!operational) {
    return (
      <div>
        <PageHeader title="Home" />
        <EmptyState data-testid="situation-denied" message="The Situation Room is an operational surface and is not available for your role." />
      </div>
    );
  }

  const firstName = me?.displayName?.split(' ')[0] ?? '';
  const live = data?.signals.filter((x) => x.band !== 'inMotion') ?? [];
  const inMotion = data?.signals.filter((x) => x.band === 'inMotion') ?? [];

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
    <div className="hh-ledger" data-testid="situation-checks">
      <div className="hh-ledger__head">
        <span className="hh-ledger__title">Checked just now, across the whole organization</span>
        <span className="hh-ledger__meta">{data.checks.length} checks · engine-derived</span>
      </div>
      {ledger.map((row, i) => (
        <div key={i} className="hh-ledger__row">
          <span
            className={`hh-ledger__dot ${
              row.tone === 'firing' ? 'hh-dot--firing' : row.tone === 'watching' ? 'hh-dot--watching' : row.tone === 'moving' ? 'hh-dot--moving' : 'hh-dot--clear'
            }`}
            aria-hidden="true"
          />
          <span className="hh-ledger__text">{row.text}</span>
          <span
            className={`hh-ledger__state ${row.tone === 'firing' ? 'hh-state--firing' : row.tone === 'watching' ? 'hh-state--watching' : ''}`}
          >
            {row.state}
          </span>
        </div>
      ))}
    </div>
  ) : null;

  const caps = me?.capabilities;

  return (
    <div className="hh-root">
      <section className="hh-welcome" aria-labelledby="home-title">
        <div>
          <p className="hh-eyebrow">{me?.tenantSlug ?? 'Home'}</p>
          <h1 className="hh-title" id="home-title">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}. <em>Your world is here.</em>
          </h1>
          {data && (
            <p className="hh-lede">
              {data.signals.length === 0
                ? 'The table is quiet — nothing is waiting on you.'
                : `${live.length} ${live.length === 1 ? 'thing is' : 'things are'} worth gathering today${inMotion.length > 0 ? `, ${inMotion.length} already in motion` : ''}.`}
            </p>
          )}
        </div>
      </section>

      {isLoading && <LoadingState label="Setting the table…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not read the situation.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}

      {data && (
        <div className="hh-ribbon" data-testid="situation-ribbon">
          {RIBBON.map((cell) => (
            <div key={cell.label} className="hh-ribbon__cell">
              <div className="hh-ribbon__label">{cell.label}</div>
              <div className="hh-ribbon__value">{cell.pick(data.counts)}</div>
            </div>
          ))}
        </div>
      )}

      <nav className="hh-domains" aria-label="Everything in C3">
        <Link to="/people">
          <span aria-hidden="true">●</span>
          <span>
            <strong>People</strong>
            <small>the whole roster</small>
          </span>
        </Link>
        <Link to="/missions">
          <span aria-hidden="true">↗</span>
          <span>
            <strong>Missions</strong>
            <small>events & finance</small>
          </span>
        </Link>
        <Link to="/teams">
          <span aria-hidden="true">◒</span>
          <span>
            <strong>Teams</strong>
            <small>divisions & homes</small>
          </span>
        </Link>
        <Link to="/credentials">
          <span aria-hidden="true">◇</span>
          <span>
            <strong>Credentials</strong>
            <small>documents that travel</small>
          </span>
        </Link>
        <Link to="/journeys">
          <span aria-hidden="true">⌁</span>
          <span>
            <strong>Journeys</strong>
            <small>arrivals & milestones</small>
          </span>
        </Link>
        {caps?.canViewSituation && (
          <Link to="/calendar">
            <span aria-hidden="true">○</span>
            <span>
              <strong>Calendar</strong>
              <small>what's ahead</small>
            </span>
          </Link>
        )}
        <Link to="/approvals">
          <span aria-hidden="true">□</span>
          <span>
            <strong>Approvals</strong>
            <small>governed changes</small>
          </span>
        </Link>
        {caps?.canViewFinancials && (
          <Link to="/invoices">
            <span aria-hidden="true">▤</span>
            <span>
              <strong>Finance</strong>
              <small>invoices & claims</small>
            </span>
          </Link>
        )}
      </nav>

      {data && data.signals.length === 0 && (
        <div data-testid="situation-all-clear">
          <div className="hh-quiet">
            <h2>The table is quiet.</h2>
            <p>Nothing needs your attention. Every check below still ran — silence is proven, not assumed.</p>
          </div>
          {ledgerPanel}
        </div>
      )}
      {data && data.signals.length > 0 && (
        <>
          <div className="hh-section-heading">
            <div>
              <p className="hh-overline">The living situation</p>
              <h2 className="hh-h2">Worth gathering today</h2>
            </div>
            <p className="hh-section-note">
              Priority is impact × urgency. <Link to="/approvals">Open approvals →</Link>
            </p>
          </div>
          <div className="hh-signals" data-testid="situation-signals">
            {[...live, ...inMotion].map((signal) => (
              <SignalNudge key={signal.key} signal={signal} />
            ))}
          </div>
          {ledgerPanel}
        </>
      )}

      <div className="hh-section-heading">
        <div>
          <p className="hh-overline">One place, every scale</p>
          <h2 className="hh-h2">From the whole company to one person</h2>
        </div>
        <p className="hh-section-note">Nothing falls between rooms.</p>
      </div>
      <div className="hh-scales">
        <div className="hh-scale">
          <p className="hh-scale__label">
            Scale <span>whole company</span>
          </p>
          <h3>{me?.tenantSlug ?? 'Your organization'}</h3>
          <p>Every register in one place — the people, the teams, the missions, and the money that moves between them.</p>
          <footer>
            <Link to="/people">People</Link>
            <Link to="/teams">Teams</Link>
            <Link to="/missions">Missions</Link>
            {caps?.canViewFinancials && <Link to="/invoices">Invoices</Link>}
          </footer>
        </div>
        <div className="hh-scale">
          <p className="hh-scale__label">
            Scale <span>one mission</span>
          </p>
          <h3>Missions</h3>
          <p>Each mission gathers its roster, credentials, documents, and finances around a single event.</p>
          <footer>
            <Link to="/missions">Missions</Link>
            {caps?.canViewSituation && <Link to="/calendar">Calendar</Link>}
            <Link to="/approvals">Approvals</Link>
          </footer>
        </div>
        <div className="hh-scale">
          <p className="hh-scale__label">
            Scale <span>one person</span>
          </p>
          <h3>People</h3>
          <p>Each person carries their journey, credentials, agreements, and equipment with them wherever they go.</p>
          <footer>
            <Link to="/people">People</Link>
            <Link to="/journeys">Journeys</Link>
            <Link to="/credentials">Credentials</Link>
          </footer>
        </div>
      </div>
    </div>
  );
}
