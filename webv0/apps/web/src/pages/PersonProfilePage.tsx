import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { agreementRenewalStateOn, credentialStatusOn } from '@c3web/domain';
import {
  usePerson,
  usePersonAgreements,
  usePersonApprovals,
  usePersonAudit,
  usePersonCredentials,
  usePersonJourneys,
  usePersonMissionMemberships,
  usePersonTeams,
} from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import { PersonV2Sections } from '../components/PersonV2Sections';
import { BeneficiarySection, CredentialFactsAction } from '../components/PersonS12Sections';
import { PersonActions } from '../components/PersonActions';
import '../theme/person-hero.css';
import { PersonPhotoControl } from '../components/PersonPhotoControl';
import { agreementRenewalStateOf, approvalStatusOf, auditActionOf, credentialStatusOf, formatUsdCents, journeyStatusOf, operationOf } from '../labels';
import {
  TableworkGate,
  TableworkPage,
  RecordPage,
  SectionRail,
  DocumentsSection,
  CommentThread,
  AuditTimeline,
  ComparisonTable,
  FactList,
  RecordLink,
  StatusBadge,
  ErrorState,
  LoadingState,
  type TimelineEntry,
} from '../tablework';

function localTodayIso(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function PersonProfilePage() {
  // Gate before hooks: an anonymous Entra deep link must reach the sign-in
  // screen, not fire pre-auth queries into acquireTokenRedirect. The band's
  // record NAME comes from data, so the body renders TableworkPage.
  const { personId = '' } = useParams();
  return (
    <TableworkGate>
      <PersonProfileBody personId={personId} />
    </TableworkGate>
  );
}

function PersonProfileBody({ personId }: { personId: string }) {
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
  const teams = usePersonTeams(personId);
  const today = localTodayIso();
  const [activeSection, setActiveSection] = useState('identity');

  if (isError) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <TableworkPage record={personId}>
        <RecordPage title="Person">
        <ErrorState
          data-testid="person-error"
          message={is404 ? `No person ${personId} in your tenant.` : 'Could not load this person.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
        </RecordPage>
      </TableworkPage>
    );
  }

  const name = data?.person.fullName ?? (isLoading ? 'Loading…' : personId);
  const entries: TimelineEntry[] = (audit.data?.events ?? []).map((e) => ({
    at: e.at,
    label: auditActionOf(e.action),
    actor: e.actor,
  }));

  // Integration note: the lane passed `wide`; removed at the seat — detail
  // pages keep the calm centred measure (the WIDE_ROUTES law + Dawn's record
  // bar), matching the Fluent original.
  return (
    <TableworkPage record={name}>
      <RecordPage
        eyebrow="Person"
        title={name}
        documentTitle={data ? name : personId}
        titleTestId="person-title"
        lead={data ? data.person.currentTeam ?? undefined : undefined}
        actions={
          <Link to={`/people/${personId}/one-pager`} data-testid="person-onepager">
            <button className="secondary-action" type="button">One-pager</button>
          </Link>
        }
      >
      {data && (
        <SectionRail
          label="Person sections"
          active={activeSection}
          onSelect={(key) => {
            setActiveSection(key);
            document.getElementById(`person-section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          sections={[
            { key: 'identity', label: 'Identity' },
            { key: 'credentials', label: 'Credentials' },
            { key: 'journeys', label: 'Journeys' },
            { key: 'agreements', label: 'Agreements' },
            { key: 'missions', label: 'Missions' },
            { key: 'approvals', label: 'Approvals' },
            { key: 'history', label: 'History' },
          ]}
        />
      )}
      {isLoading && <LoadingState label="Loading person…" />}
      {data && (
        <>
          {/* Screen 04: the identity hero — portrait + stable facts gathered on
              one opaque surface with the living thread. Components unchanged. */}
          <section id="person-section-identity" className="ph-hero" aria-label="Identity">
          <PersonPhotoControl
            personId={data.person.personId}
            name={data.person.fullName}
            photoUpdatedAt={data.person.photoUpdatedAt}
            canManage={me?.capabilities.canSubmitApproval ?? false}
          />
          <FactList
            items={[
              { label: 'Person ID', value: data.person.personId, mono: true, testId: 'person-id' },
              { label: 'In-game name', value: data.person.ign ?? null },
              { label: 'Team (display)', value: data.person.currentTeam ?? null },
              {
                label: 'Teams',
                value:
                  (teams.data?.members.filter((m) => m.isActive).length ?? 0) > 0 ? (
                    <span data-testid="person-teams">
                      {teams
                        .data!.members.filter((m) => m.isActive)
                        .map((m, i) => (
                          <span key={m.teamId}>
                            {i > 0 && ' · '}
                            <RecordLink to={`/teams/${m.teamId}`}>{m.teamId}</RecordLink>
                            {` (${m.role})`}
                          </span>
                        ))}
                    </span>
                  ) : null,
              },
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
          </section>
          <PersonV2Sections person={data.person} />
          <BeneficiarySection personId={data.person.personId} />
          <PersonActions personId={data.person.personId} personName={data.person.fullName} />
          {(credentials.data?.credentials.length ?? 0) > 0 && (
            <section id="person-section-credentials" className="record-section">
              <h2>Credentials</h2>
              <ComparisonTable label="Person credentials" testId="person-credentials">
                <thead>
                  <tr>
                    <th>Credential</th>
                    <th>Type</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {credentials.data!.credentials.map((c) => {
                    const badge = credentialStatusOf(credentialStatusOn(c, today));
                    return (
                      <tr key={c.credentialId}>
                        {/* Plain cell, deliberately: this id was never a link and
                            never mono in the Fluent original (`r.td` alone), so
                            neither RecordLink nor `.mono` is the honest port. */}
                        <td>{c.credentialId}</td>
                        <td>{c.credentialType}</td>
                        <td>{c.expiresOn ?? '—'}</td>
                        <td>
                          <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                        </td>
                        <td>
                          <CredentialFactsAction credential={c} personId={data.person.personId} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </ComparisonTable>
            </section>
          )}
          {(journeys.data?.journeys.length ?? 0) > 0 && (
            <section id="person-section-journeys" className="record-section">
              <h2>Journeys</h2>
              <ComparisonTable label="Person journeys" testId="person-journeys">
                <thead>
                  <tr>
                    <th>Journey</th>
                    <th>Type</th>
                    <th>Started</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {journeys.data!.journeys.map((j) => {
                    const badge = journeyStatusOf(j.status);
                    return (
                      <tr key={j.journeyId}>
                        <td>{j.journeyId}</td>
                        <td>{j.title ?? j.journeyType}</td>
                        {/* NEGATIVE CONTRACT: startedOn stays the raw ISO the
                            wire sends — formatDisplayDate must NOT be adopted
                            here; the frozen oracle pins the bytes. */}
                        <td>{j.startedOn}</td>
                        <td>
                          <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </ComparisonTable>
            </section>
          )}
          {canReadAgreements && (agreements.data?.agreements.length ?? 0) > 0 && (
            <section id="person-section-agreements" className="record-section">
              <h2>Agreements</h2>
              <ComparisonTable label="Person agreements" testId="person-agreements">
                <thead>
                  <tr>
                    <th>Agreement</th>
                    <th>Type</th>
                    <th>Ends</th>
                    {showValue && <th>Value</th>}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agreements.data!.agreements.map((a) => {
                    const badge = agreementRenewalStateOf(agreementRenewalStateOn(a, today));
                    return (
                      <tr key={a.agreementId}>
                        <td>
                          <RecordLink to={`/agreements/${a.agreementId}`}>{a.agreementId}</RecordLink>
                        </td>
                        <td>{a.agreementType}</td>
                        <td>{a.endsOn}</td>
                        {/* The Value column stays behind `showValue` — the
                            capability gate is the render gate AND the wire gate
                            (`usePersonAgreements(personId, canReadAgreements)`
                            above); neither may become a visual hide. */}
                        {showValue && <td>{formatUsdCents(a.valueUsdCents)}</td>}
                        <td>
                          <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </ComparisonTable>
            </section>
          )}
          {(missions.data?.missions.length ?? 0) > 0 && (
            <section id="person-section-missions" className="record-section">
              <h2>Missions</h2>
              <ComparisonTable label="Person missions" testId="person-missions">
                <thead>
                  <tr>
                    <th>Mission</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Membership</th>
                  </tr>
                </thead>
                <tbody>
                  {missions.data!.missions.map((m) => (
                    <tr key={m.missionId}>
                      <td>
                        <RecordLink to={`/missions/${m.missionId}`}>{m.missionId}</RecordLink>
                      </td>
                      <td>{m.missionName}</td>
                      <td>{m.role}</td>
                      <td>
                        <StatusBadge variant={m.isActive ? 'ready' : 'neutral'}>{m.isActive ? 'Active' : 'Removed'}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ComparisonTable>
            </section>
          )}
          {canViewApprovals && (approvals.data?.approvals.length ?? 0) > 0 && (
            <section id="person-section-approvals" className="record-section">
              <h2>Approvals</h2>
              <ComparisonTable label="Person approvals" testId="person-approvals">
                <thead>
                  <tr>
                    <th>Approval</th>
                    <th>Operation</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.data!.approvals.map((ap) => {
                    const badge = approvalStatusOf(ap.status);
                    return (
                      <tr key={ap.approvalId}>
                        <td>
                          <RecordLink to={`/approvals/${ap.approvalId}`}>{ap.approvalId}</RecordLink>
                        </td>
                        <td>{operationOf(ap.operationType)}</td>
                        <td>
                          <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </ComparisonTable>
            </section>
          )}
          <DocumentsSection ownerType="Person" ownerId={personId} canManage={me?.capabilities.canSubmitApproval ?? false} />

          <CommentThread subjectType="Person" subjectId={personId} />

          <section id="person-section-history" className="record-section">
            <h2>History</h2>
            {/* F04 (instance 21): a denied or failed history fetch surfaces —
                an empty timeline is a CLAIM about what happened here. */}
            {audit.isError ? (
              <ErrorState data-testid="person-audit-error" message="The history could not be loaded — what happened here may not be shown." correlationId={audit.error instanceof ApiError ? audit.error.correlationId : undefined} />
            ) : (
              <AuditTimeline entries={entries} testId="person-audit" />
            )}
          </section>
        </>
      )}
      </RecordPage>
    </TableworkPage>
  );
}
