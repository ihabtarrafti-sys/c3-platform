import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { journeyTransitionsFrom, type JourneyStatus, type JourneyTransition } from '@c3web/domain';
import type { JourneyDto } from '../api';
import { useJourneys, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  RecordLink,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  Field,
  Input,
  DateInput,
  Selector,
  FormDrawer,
  GovernedAction,
} from '../tablework';
import { journeyStatusOf } from '../labels';

/**
 * Journeys (Sprint 37) — the lifecycle register. Initiation is GOVERNED (an
 * approval an owner must execute); the transitions are DIRECT-BUT-AUDITED —
 * their dialogs say so honestly: the effect is immediate and recorded.
 *
 * Tablework conversion (pivot W2, Lane C). The load-bearing subtlety here is
 * `showLifecycle`: a capability × ENGINE composite (canOperateJourneys AND at
 * least one row with a legal transition) decides whether the whole Lifecycle
 * column exists. The header and body conditionals must stay in LOCKSTEP —
 * a header standing over uniformly empty cells is exactly the defect polish
 * wave #10 fixed on this screen. Dates stay raw ISO (journeys.spec matches
 * /\d{4}-\d{2}-\d{2}/ on the row).
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

/** The row's lifecycle buttons — flex-start, never the flex-end panel rhythm. */

export function JourneysPage() {
  return (
    <TableworkPage record="Journeys" section="Register" wide>
      <JourneysRegister />
    </TableworkPage>
  );
}

function JourneysRegister() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useJourneys();
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const canOperate = me?.capabilities.canOperateJourneys ?? false;
  // Polish wave #10: the Lifecycle column exists only when some row actually
  // has lifecycle actions — a header over uniformly empty cells reads dead.
  const showLifecycle =
    canOperate && (data?.journeys.some((j) => journeyTransitionsFrom(j.status as JourneyStatus).length > 0) ?? false);
  // The wire law: the capability IS the `enabled` flag.
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
    <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="initiate-journey-toggle">
      Initiate journey
    </button>
  ) : undefined;

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title="Journeys"
        count={data ? `${data.journeys.length} in this view` : undefined}
        actions={addAction}
      >
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
                <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="journeys-empty-add">
                  Initiate journey
                </button>
              ) : undefined
            }
          />
        )}
        {/* M2: the count lives ONCE, in the CollectionFrame header. */}
        {data && data.journeys.length > 0 && (
          <ComparisonTable label="Journeys register" testId="journeys-table">
            <thead>
              <tr>
                <th>Journey</th>
                <th>Person</th>
                <th>Type</th>
                <th>Started</th>
                <th>Ended</th>
                <th>Status</th>
                {/* LOCKSTEP with the body cell below — one composite, two sites. */}
                {showLifecycle && <th>Lifecycle</th>}
              </tr>
            </thead>
            <tbody>
              {data.journeys.map((j) => {
                const badge = journeyStatusOf(j.status);
                const actions = journeyTransitionsFrom(j.status as JourneyStatus);
                return (
                  <tr key={j.journeyId} data-testid={`journey-row-${j.journeyId}`}>
                    <td>{j.journeyId}</td>
                    <td>
                      <RecordLink to={`/people/${j.personId}`}>{j.personId}</RecordLink>
                    </td>
                    <td>{j.title ?? j.journeyType}</td>
                    {/* Raw ISO both sides — journeys.spec matches the row on
                        /\d{4}-\d{2}-\d{2}/ once the end date is stamped. */}
                    <td>{j.startedOn}</td>
                    <td>{j.endedOn ?? '—'}</td>
                    <td>
                      <StatusBadge variant={badge.variant} data-testid={`journey-status-${j.journeyId}`}>
                        {badge.label}
                      </StatusBadge>
                    </td>
                    {showLifecycle && (
                      <td>
                        <div className="row-actions">
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
                                      onChange={(e) => setCancelReasons((c) => ({ ...c, [j.journeyId]: e.target.value }))}
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
          </ComparisonTable>
        )}
      </CollectionFrame>

      {canSubmit && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow="Initiate journey"
          mode="governed"
          intro="New journeys go through approval — an owner must review and execute before the journey begins."
          footer={
            <GovernedAction
              triggerLabel="Submit for approval"
              triggerTestId="initiate-journey-submit"
              triggerDisabled={!ready}
              title="Submit this journey request for approval?"
              description="It goes to an approver for review; you can edit it until review starts, then it’s frozen. Approval and execution are separate steps."
              confirmLabel="Submit for approval"
              onConfirm={submitInitiate}
            />
          }
        >
          <Field label="Person" required>
            <Selector
              data-testid="initiate-journey-person"
              // KIT-GAP WORKAROUND (provisional — remove when the gap closes).
              // GAP: `Selector` exposes no width/size affordance.
              //   `.tw-root .selector` hard-codes `min-width: 12rem` (192px) and
              //   there is no prop and no CSS custom property to vary it, so a
              //   picker that is not 12rem wide cannot be expressed through the
              //   kit — and a person picker must hold "Full Name (PER-0001)".
              // WORKAROUND: an inline `style` ridden in through Selector's
              //   `React.HTMLAttributes<HTMLDivElement>` rest-spread onto its
              //   wrapper div, carrying the Fluent-era width this control had
              //   before the conversion.
              // CLASS: additive — a `size`/`width` prop (or a
              //   `--selector-min-width` custom property) that defaults to
              //   today's 12rem leaves every already-converted Selector
              //   rendering exactly as it does now.
              style={{ minWidth: '260px' }}
              placeholder="Select a person"
              value={personId}
              display={personId ? personLabel : undefined}
              options={(people.data?.people ?? []).map((p) => ({
                value: p.personId,
                label: `${p.fullName} (${p.personId})`,
              }))}
              onSelect={(value, label) => {
                setPersonId(value);
                setPersonLabel(label);
              }}
            />
          </Field>
          <Field label="Journey type" required>
            <Input value={journeyType} onChange={(e) => setJourneyType(e.target.value)} data-testid="initiate-journey-type" />
          </Field>
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="initiate-journey-title" />
          </Field>
          <Field label="Starts on" required>
            <DateInput value={startedOn} onChange={(e) => setStartedOn(e.target.value)} data-testid="initiate-journey-started" />
          </Field>
        </FormDrawer>
      )}
    </>
  );
}
