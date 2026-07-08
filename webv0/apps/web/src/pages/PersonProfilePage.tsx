import { Link, useParams } from 'react-router-dom';
import { makeStyles } from '@fluentui/react-components';
import { agreementRenewalStateOn, credentialStatusOn } from '@c3web/domain';
import {
  usePerson,
  usePersonAgreements,
  usePersonApprovals,
  usePersonAudit,
  usePersonCredentials,
  usePersonJourneys,
  usePersonMissionMemberships,
} from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { DefinitionList } from '../components/DefinitionList';
import { StatusBadge } from '../components/StatusBadge';
import { AuditTimeline, type TimelineEntry } from '../components/AuditTimeline';
import { ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { agreementRenewalStateOf, approvalStatusOf, auditActionOf, credentialStatusOf, formatUsdCents, journeyStatusOf, operationOf } from '../labels';

function localTodayIso(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const useStyles = makeStyles({
  section: { marginTop: '32px' },
  h2: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, color: 'var(--c3-command-black)', margin: '0 0 12px' },
});

export function PersonProfilePage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { personId = '' } = useParams();
  const { me } = useSession();
  const canReadAgreements = me?.capabilities.canReadAgreements ?? false;
  const showValue = me?.capabilities.canViewFinancials ?? false;
  const canViewApprovals = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const { data, isLoading, isError, error } = usePerson(personId);
  const audit = usePersonAudit(personId);
  const credentials = usePersonCredentials(personId);
  const journeys = usePersonJourneys(personId);
  const agreements = usePersonAgreements(personId, canReadAgreements);
  const missions = usePersonMissionMemberships(personId);
  const approvals = usePersonApprovals(personId, canViewApprovals);
  const today = localTodayIso();

  if (isError) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <div>
        <PageHeader title="Person" breadcrumbs={<Breadcrumbs crumbs={[{ label: 'People', to: '/people' }, { label: personId }]} />} />
        <ErrorState
          data-testid="person-error"
          message={is404 ? `No person ${personId} in your tenant.` : 'Could not load this person.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      </div>
    );
  }

  const name = data?.person.fullName ?? (isLoading ? 'Loading…' : personId);
  const entries: TimelineEntry[] = (audit.data?.events ?? []).map((e) => ({
    at: e.at,
    label: auditActionOf(e.action),
    actor: e.actor,
  }));

  return (
    <div>
      <PageHeader
        title={name}
        titleTestId="person-title"
        breadcrumbs={<Breadcrumbs crumbs={[{ label: 'People', to: '/people' }, { label: name }]} />}
      />
      {isLoading && <LoadingState label="Loading person…" />}
      {data && (
        <>
          <DefinitionList
            items={[
              { label: 'Person ID', value: data.person.personId, mono: true, testId: 'person-id' },
              { label: 'In-game name', value: data.person.ign ?? null },
              { label: 'Team', value: data.person.currentTeam ?? null },
              {
                label: 'Status',
                value: (
                  <StatusBadge variant={data.person.isActive ? 'ready' : 'neutral'}>
                    {data.person.isActive ? 'Active' : 'Inactive'}
                  </StatusBadge>
                ),
              },
            ]}
          />
          {(credentials.data?.credentials.length ?? 0) > 0 && (
            <div className={s.section}>
              <h2 className={s.h2}>Credentials</h2>
              <table className={r.table} data-testid="person-credentials" aria-label="Person credentials">
                <thead>
                  <tr>
                    <th className={r.th}>Credential</th>
                    <th className={r.th}>Type</th>
                    <th className={r.th}>Expires</th>
                    <th className={r.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {credentials.data!.credentials.map((c) => {
                    const badge = credentialStatusOf(credentialStatusOn(c, today));
                    return (
                      <tr key={c.credentialId} className={r.row}>
                        <td className={r.td}>{c.credentialId}</td>
                        <td className={`${r.td} ${r.name}`}>{c.credentialType}</td>
                        <td className={r.td}>{c.expiresOn ?? '—'}</td>
                        <td className={r.td}>
                          <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(journeys.data?.journeys.length ?? 0) > 0 && (
            <div className={s.section}>
              <h2 className={s.h2}>Journeys</h2>
              <table className={r.table} data-testid="person-journeys" aria-label="Person journeys">
                <thead>
                  <tr>
                    <th className={r.th}>Journey</th>
                    <th className={r.th}>Type</th>
                    <th className={r.th}>Started</th>
                    <th className={r.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {journeys.data!.journeys.map((j) => {
                    const badge = journeyStatusOf(j.status);
                    return (
                      <tr key={j.journeyId} className={r.row}>
                        <td className={r.td}>{j.journeyId}</td>
                        <td className={`${r.td} ${r.name}`}>{j.title ?? j.journeyType}</td>
                        <td className={r.td}>{j.startedOn}</td>
                        <td className={r.td}>
                          <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {canReadAgreements && (agreements.data?.agreements.length ?? 0) > 0 && (
            <div className={s.section}>
              <h2 className={s.h2}>Agreements</h2>
              <table className={r.table} data-testid="person-agreements" aria-label="Person agreements">
                <thead>
                  <tr>
                    <th className={r.th}>Agreement</th>
                    <th className={r.th}>Type</th>
                    <th className={r.th}>Ends</th>
                    {showValue && <th className={r.th}>Value</th>}
                    <th className={r.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agreements.data!.agreements.map((a) => {
                    const badge = agreementRenewalStateOf(agreementRenewalStateOn(a, today));
                    return (
                      <tr key={a.agreementId} className={r.row}>
                        <td className={r.td}>
                          <Link className={r.idLink} to={`/agreements/${a.agreementId}`}>
                            {a.agreementId}
                          </Link>
                        </td>
                        <td className={`${r.td} ${r.name}`}>{a.agreementType}</td>
                        <td className={r.td}>{a.endsOn}</td>
                        {showValue && <td className={r.td}>{formatUsdCents(a.valueUsdCents)}</td>}
                        <td className={r.td}>
                          <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(missions.data?.missions.length ?? 0) > 0 && (
            <div className={s.section}>
              <h2 className={s.h2}>Missions</h2>
              <table className={r.table} data-testid="person-missions" aria-label="Person missions">
                <thead>
                  <tr>
                    <th className={r.th}>Mission</th>
                    <th className={r.th}>Name</th>
                    <th className={r.th}>Role</th>
                    <th className={r.th}>Membership</th>
                  </tr>
                </thead>
                <tbody>
                  {missions.data!.missions.map((m) => (
                    <tr key={m.missionId} className={r.row}>
                      <td className={r.td}>
                        <Link className={r.idLink} to={`/missions/${m.missionId}`}>
                          {m.missionId}
                        </Link>
                      </td>
                      <td className={`${r.td} ${r.name}`}>{m.missionName}</td>
                      <td className={r.td}>{m.role}</td>
                      <td className={r.td}>
                        <StatusBadge variant={m.isActive ? 'ready' : 'neutral'}>{m.isActive ? 'Active' : 'Removed'}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canViewApprovals && (approvals.data?.approvals.length ?? 0) > 0 && (
            <div className={s.section}>
              <h2 className={s.h2}>Approvals</h2>
              <table className={r.table} data-testid="person-approvals" aria-label="Person approvals">
                <thead>
                  <tr>
                    <th className={r.th}>Approval</th>
                    <th className={r.th}>Operation</th>
                    <th className={r.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.data!.approvals.map((ap) => {
                    const badge = approvalStatusOf(ap.status);
                    return (
                      <tr key={ap.approvalId} className={r.row}>
                        <td className={r.td}>
                          <Link className={r.idLink} to={`/approvals/${ap.approvalId}`}>
                            {ap.approvalId}
                          </Link>
                        </td>
                        <td className={`${r.td} ${r.name}`}>{operationOf(ap.operationType)}</td>
                        <td className={r.td}>
                          <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className={s.section}>
            <h2 className={s.h2}>History</h2>
            <AuditTimeline entries={entries} testId="person-audit" />
          </div>
        </>
      )}
    </div>
  );
}
