import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WitnessState } from './TruthPanel';
import { MissionPnlSection } from '../pages/MissionDetailPage';
import { MissionFinanceOverview } from '../pages/MissionFinancePage';
import { InvoicesRegister } from '../pages/InvoicesPage';
import { ClaimsRegister } from '../pages/ClaimsPage';
import { SubscriptionsRegister } from '../pages/SubscriptionsPage';
import { AgreementsRegister } from '../pages/AgreementsPage';
import { DistributionsSection } from '../components/DistributionsSection';
import {
  joinMissionMoneyWitnesses,
  moneyContinuityHrefFor,
  type MoneyContinuityLens,
} from './moneyContinuityModel';
import './money-continuity.css';

export interface MoneyContinuityProps {
  readonly missionId: string;
  readonly missionOrganizer: string | null;
  readonly canManageMission: boolean;
  readonly lens: MoneyContinuityLens;
  readonly enabled: boolean;
  readonly foreground: boolean;
  readonly requestKey: string;
  readonly onTruthChange: (truth: WitnessState) => void;
}

const LENS_LABELS: Readonly<Record<MoneyContinuityLens, string>> = {
  mission: 'This mission',
  portfolio: 'Portfolio',
  invoices: 'Invoices',
  claims: 'Claims',
  subscriptions: 'Subscriptions',
  agreements: 'Agreements',
};

interface MissionLensWitnesses {
  readonly requestKey: string;
  readonly pnl: WitnessState;
  readonly distributions: WitnessState;
}

const LOADING_WITNESS: WitnessState = { kind: 'loading' };

function MissionMoneyLens({
  missionId,
  missionOrganizer,
  canManageMission,
  enabled,
  foreground,
  requestKey,
  onTruthChange,
}: Omit<MoneyContinuityProps, 'lens'>) {
  const [witnesses, setWitnesses] = useState<MissionLensWitnesses>({
    requestKey,
    pnl: LOADING_WITNESS,
    distributions: LOADING_WITNESS,
  });
  const current = witnesses.requestKey === requestKey
    ? witnesses
    : { requestKey, pnl: LOADING_WITNESS, distributions: LOADING_WITNESS };
  const joined = useMemo(
    () => joinMissionMoneyWitnesses({ pnl: current.pnl, distributions: current.distributions }),
    [current.distributions, current.pnl],
  );

  const onPnlTruthChange = useCallback(
    (truth: WitnessState) => {
      setWitnesses((value) => ({
        requestKey,
        pnl: truth,
        distributions: value.requestKey === requestKey ? value.distributions : LOADING_WITNESS,
      }));
    },
    [requestKey],
  );
  const onDistributionsTruthChange = useCallback(
    (truth: WitnessState) => {
      setWitnesses((value) => ({
        requestKey,
        pnl: value.requestKey === requestKey ? value.pnl : LOADING_WITNESS,
        distributions: truth,
      }));
    },
    [requestKey],
  );

  useEffect(() => {
    onTruthChange(joined);
  }, [joined, onTruthChange]);

  return (
    <div className="money-continuity-mission" data-money-mission-truth={joined.kind}>
      <p className="boundary-note">
        P&amp;L and distributions remain independent records. Their shared view infers no settlement or mission completion.
      </p>
      <div className="money-continuity-mission-grid">
        <MissionPnlSection
          missionId={missionId}
          canManage={canManageMission}
          organizer={missionOrganizer}
          enabled={enabled}
          foreground={foreground}
          requestKey={requestKey}
          onTruthChange={onPnlTruthChange}
        />
        <DistributionsSection
          missionId={missionId}
          canManage={canManageMission}
          enabled={enabled}
          foreground={foreground}
          requestKey={requestKey}
          onTruthChange={onDistributionsTruthChange}
        />
      </div>
    </div>
  );
}

/**
 * One persistent money desk with a runtime-selected lens. Only the active lens
 * mounts, so hidden registers do not query, mutate, or retain drafts. The lens
 * travels in the route/session tree and is intentionally absent from saved
 * workspace geometry.
 */
export function MoneyContinuity({
  missionId,
  missionOrganizer,
  canManageMission,
  lens,
  enabled,
  foreground,
  requestKey,
  onTruthChange,
}: MoneyContinuityProps) {
  const common = { enabled, foreground, requestKey, onTruthChange } as const;

  return (
    <section className="money-continuity" data-tablework="MoneyContinuity" data-money-lens={lens}>
      <header className="money-continuity-header">
        <div>
          <span className="eyebrow">Continuity · Money</span>
          <p>Move between mission and organization records without leaving the command workspace.</p>
        </div>
        <nav className="money-continuity-lenses" aria-label="Money Continuity views">
          {(Object.keys(LENS_LABELS) as MoneyContinuityLens[]).map((candidate) => (
            <Link
              key={candidate}
              to={moneyContinuityHrefFor(candidate, missionId)}
              aria-current={candidate === lens ? 'page' : undefined}
              data-money-lens-link={candidate}
            >
              {LENS_LABELS[candidate]}
            </Link>
          ))}
        </nav>
      </header>

      <div className="money-continuity-body" key={lens}>
        {lens === 'mission' ? (
          <MissionMoneyLens
            missionId={missionId}
            missionOrganizer={missionOrganizer}
            canManageMission={canManageMission}
            {...common}
          />
        ) : null}
        {lens === 'portfolio' ? (
          <MissionFinanceOverview
            {...common}
            linkToMission={(nextMissionId) => `/missions/${nextMissionId}/comms?open=finance`}
          />
        ) : null}
        {lens === 'invoices' ? (
          <InvoicesRegister
            {...common}
            linkToMission={(nextMissionId) => `/missions/${nextMissionId}/comms?open=finance`}
          />
        ) : null}
        {lens === 'claims' ? (
          <ClaimsRegister
            {...common}
            linkToClaim={(claimId) => `/claims/${claimId}`}
          />
        ) : null}
        {lens === 'subscriptions' ? <SubscriptionsRegister {...common} /> : null}
        {lens === 'agreements' ? (
          <AgreementsRegister
            {...common}
            linkToAgreement={(agreementId) => `/agreements/${agreementId}`}
            linkToPerson={(personId) => `/people/${personId}?workspace=${missionId}`}
          />
        ) : null}
      </div>
    </section>
  );
}
