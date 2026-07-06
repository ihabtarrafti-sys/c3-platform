import { useParams } from 'react-router-dom';
import { makeStyles } from '@fluentui/react-components';
import { usePerson, usePersonAudit } from '../queries';
import { ApiError } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { DefinitionList } from '../components/DefinitionList';
import { StatusBadge } from '../components/StatusBadge';
import { AuditTimeline, type TimelineEntry } from '../components/AuditTimeline';
import { ErrorState, LoadingState } from '../components/states';
import { auditActionOf } from '../labels';

const useStyles = makeStyles({
  section: { marginTop: '32px' },
  h2: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, color: 'var(--c3-command-black)', margin: '0 0 12px' },
});

export function PersonProfilePage() {
  const s = useStyles();
  const { personId = '' } = useParams();
  const { data, isLoading, isError, error } = usePerson(personId);
  const audit = usePersonAudit(personId);

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
          <div className={s.section}>
            <h2 className={s.h2}>History</h2>
            <AuditTimeline entries={entries} testId="person-audit" />
          </div>
        </>
      )}
    </div>
  );
}
