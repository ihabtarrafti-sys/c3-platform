import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Dropdown, Field, Input, Option, Text, makeStyles } from '@fluentui/react-components';
import { journeyTransitionsFrom, type JourneyStatus, type JourneyTransition } from '@c3web/domain';
import type { JourneyDto } from '../api';
import { useJourneys, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { journeyStatusOf } from '../labels';

/**
 * Journeys (Sprint 37) — the lifecycle register. Initiation is GOVERNED (an
 * approval an owner must execute); the transitions are DIRECT-BUT-AUDITED —
 * their dialogs say so honestly: the effect is immediate and recorded.
 */

const TRANSITION_LABEL: Record<JourneyTransition, { button: string; title: (id: string) => string; description: string }> = {
  suspend: {
    button: 'Suspend…',
    title: (id) => `Suspend ${id}?`,
    description: 'This takes effect immediately and is recorded in the journey history. The journey can be resumed later.',
  },
  resume: {
    button: 'Resume…',
    title: (id) => `Resume ${id}?`,
    description: 'This takes effect immediately and is recorded in the journey history.',
  },
  complete: {
    button: 'Complete…',
    title: (id) => `Complete ${id}?`,
    description: 'This closes the journey permanently, takes effect immediately, and is recorded. A completed journey cannot be reopened.',
  },
  cancel: {
    button: 'Cancel…',
    title: (id) => `Cancel ${id}?`,
    description: 'Cancelling closes the journey permanently and requires a reason, which is recorded in the journey history.',
  },
};

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', rowGap: '10px', maxWidth: '440px', padding: '16px', marginBottom: '20px' },
  formIntro: { fontSize: '13px', color: 'var(--c3-ink-70)' },
  personSelect: { minWidth: '260px' },
  actionsCell: { display: 'flex', columnGap: '8px', flexWrap: 'wrap' },
});

export function JourneysPage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useJourneys();
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const canOperate = me?.capabilities.canOperateJourneys ?? false;
  const people = usePeople(canSubmit);

  const [showForm, setShowForm] = useState(false);
  const [personId, setPersonId] = useState('');
  const [personLabel, setPersonLabel] = useState('');
  const [journeyType, setJourneyType] = useState('');
  const [title, setTitle] = useState('');
  const [startedOn, setStartedOn] = useState('');
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});

  async function submitInitiate() {
    try {
      const res = await api.submitInitiateJourney({
        personId,
        journeyType,
        title: title || undefined,
        startedOn,
      } as Parameters<typeof api.submitInitiateJourney>[0]);
      notify('success', `Submitted ${res.approval.approvalId} for approval. The journey is not initiated until an owner executes it.`);
      setShowForm(false);
      setPersonId('');
      setPersonLabel('');
      setJourneyType('');
      setTitle('');
      setStartedOn('');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
      throw err instanceof Error ? err : new Error('Submission failed.');
    }
  }

  async function runTransition(j: JourneyDto, action: JourneyTransition) {
    const reason = action === 'cancel' ? cancelReasons[j.journeyId]?.trim() : undefined;
    try {
      const res = await api.transitionJourney(j.journeyId, action, j.version, reason);
      notify('success', `${j.journeyId} is now ${journeyStatusOf(res.journey.status).label}. Recorded in the journey history.`);
      void qc.invalidateQueries({ queryKey: ['journeys'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Transition failed.');
      throw err instanceof Error ? err : new Error('Transition failed.');
    }
  }

  const ready = personId !== '' && journeyType.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(startedOn);

  const addAction = canSubmit ? (
    <Button appearance="primary" onClick={() => setShowForm((v) => !v)} data-testid="initiate-journey-toggle">
      {showForm ? 'Cancel' : 'Initiate Journey'}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title="Journeys" context={data ? `${data.journeys.length} in this view` : undefined} actions={addAction} />

      {canSubmit && showForm && (
        <Card className={s.form}>
          <Text className={s.formIntro}>
            New journeys go through approval — an owner must review and execute before the journey begins.
          </Text>
          <Field label="Person" required>
            <Dropdown
              className={s.personSelect}
              placeholder="Select a person"
              value={personLabel}
              selectedOptions={personId ? [personId] : []}
              onOptionSelect={(_, d) => {
                if (d.optionValue) {
                  setPersonId(d.optionValue);
                  setPersonLabel(d.optionText ?? d.optionValue);
                }
              }}
              data-testid="initiate-journey-person"
            >
              {(people.data?.people ?? []).map((p) => (
                <Option key={p.personId} value={p.personId} text={`${p.fullName} (${p.personId})`}>
                  {`${p.fullName} (${p.personId})`}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label="Journey type" required>
            <Input value={journeyType} onChange={(_, d) => setJourneyType(d.value)} data-testid="initiate-journey-type" />
          </Field>
          <Field label="Title">
            <Input value={title} onChange={(_, d) => setTitle(d.value)} data-testid="initiate-journey-title" />
          </Field>
          <Field label="Starts on" required>
            <Input type="date" value={startedOn} onChange={(_, d) => setStartedOn(d.value)} data-testid="initiate-journey-started" />
          </Field>
          <div>
            <GovernedAction
              triggerLabel="Submit for approval"
              triggerTestId="initiate-journey-submit"
              triggerDisabled={!ready}
              title="Submit this journey request for approval?"
              description="Once submitted, this request can’t be edited. It goes to an approver for review; approval and execution are separate steps."
              confirmLabel="Submit for approval"
              onConfirm={submitInitiate}
            />
          </div>
        </Card>
      )}

      {isLoading && <LoadingState label="Loading journeys…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load journeys.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.journeys.length === 0 && (
        <EmptyState
          data-testid="journeys-empty"
          message="No journeys yet."
          action={
            canSubmit ? (
              <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="journeys-empty-add">
                Initiate Journey
              </Button>
            ) : undefined
          }
        />
      )}
      {data && data.journeys.length > 0 && (
        <>
          <table className={r.table} data-testid="journeys-table" aria-label="Journeys register">
            <thead>
              <tr>
                <th className={r.th}>Journey</th>
                <th className={r.th}>Person</th>
                <th className={r.th}>Type</th>
                <th className={r.th}>Started</th>
                <th className={r.th}>Ended</th>
                <th className={r.th}>Status</th>
                {canOperate && <th className={r.th}>Lifecycle</th>}
              </tr>
            </thead>
            <tbody>
              {data.journeys.map((j) => {
                const badge = journeyStatusOf(j.status);
                const actions = journeyTransitionsFrom(j.status as JourneyStatus);
                return (
                  <tr key={j.journeyId} className={r.row} data-testid={`journey-row-${j.journeyId}`}>
                    <td className={r.td}>{j.journeyId}</td>
                    <td className={r.td}>
                      <Link className={r.idLink} to={`/people/${j.personId}`}>
                        {j.personId}
                      </Link>
                    </td>
                    <td className={`${r.td} ${r.name}`}>{j.title ?? j.journeyType}</td>
                    <td className={r.td}>{j.startedOn}</td>
                    <td className={r.td}>{j.endedOn ?? '—'}</td>
                    <td className={r.td}>
                      <StatusBadge variant={badge.variant} data-testid={`journey-status-${j.journeyId}`}>
                        {badge.label}
                      </StatusBadge>
                    </td>
                    {canOperate && (
                      <td className={r.td}>
                        <div className={s.actionsCell}>
                          {actions.map((action) => (
                            <GovernedAction
                              key={action}
                              triggerLabel={TRANSITION_LABEL[action].button}
                              triggerTestId={`transition-${action}-${j.journeyId}`}
                              triggerAppearance="secondary"
                              title={TRANSITION_LABEL[action].title(j.journeyId)}
                              description={TRANSITION_LABEL[action].description}
                              extra={
                                action === 'cancel' ? (
                                  <Field label="Reason" required>
                                    <Input
                                      value={cancelReasons[j.journeyId] ?? ''}
                                      onChange={(_, d) => setCancelReasons((c) => ({ ...c, [j.journeyId]: d.value }))}
                                      data-testid={`cancel-reason-${j.journeyId}`}
                                    />
                                  </Field>
                                ) : undefined
                              }
                              confirmLabel={action === 'cancel' ? 'Cancel journey' : TRANSITION_LABEL[action].button.replace('…', '')}
                              confirmDisabled={action === 'cancel' && !(cancelReasons[j.journeyId] ?? '').trim()}
                              onConfirm={() => runTransition(j, action)}
                            />
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={r.count}>
            {data.journeys.length} {data.journeys.length === 1 ? 'journey' : 'journeys'}
          </div>
        </>
      )}
    </div>
  );
}
