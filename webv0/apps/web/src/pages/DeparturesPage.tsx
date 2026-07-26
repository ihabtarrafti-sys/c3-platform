import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { DepartureWithReadinessDto } from '@c3web/api-contracts';
import { useDepartures, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  WorkSurface,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  Field,
  Input,
  Textarea,
  Checkbox,
  Selector,
  GovernedAction,
} from '../tablework';

/**
 * Departure workflow (Track B) — the offboarding twin of onboarding, on the
 * Tablework frame (pivot W2; the Fluent page's behaviour, testids, and copy
 * verbatim). Start a departure for a person, then work the derived readiness
 * checklist: everything still open across their agreements / roster /
 * credentials / kit, each closed from its own record. Complete hands them to
 * the governed DeactivatePerson when asked. Owner/operations. The cockpit
 * carries a "departure incomplete" signal.
 */

export function DeparturesPage() {
  return (
    <TableworkPage record="Departures" section="Workflow">
      <DeparturesWorkflow />
    </TableworkPage>
  );
}

function DeparturesWorkflow() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canViewSituation ?? false;

  // THE WIRE LAW: BOTH queries are capability-gated — and the second one is the
  // PII people roster. The capability IS the `enabled` flag; hoisting either to
  // always-on and hiding the result visually would ship the roster to a browser
  // that must not receive it, and no testid assertion would catch it.
  const { data, isLoading, isError, error } = useDepartures(canManage);
  const people = usePeople(canManage);
  const [personId, setPersonId] = useState('');
  const [reason, setReason] = useState('');
  const [starting, setStarting] = useState(false);
  // NO-TOUCH (existing behaviour that looks like a bug): ONE `deactivate` and
  // ONE `note`, shared across every open card. Making them per-card is a
  // behaviour change wearing a refactor's clothes — carried as-is.
  const [deactivate, setDeactivate] = useState(false);
  const [note, setNote] = useState('');

  const departingIds = useMemo(() => new Set((data?.departures ?? []).filter((d) => d.departure.status === 'InProgress').map((d) => d.departure.personId)), [data]);
  const eligible = useMemo(() => (people.data?.people ?? []).filter((p) => p.isActive && !departingIds.has(p.personId)), [people.data, departingIds]);

  if (!canManage) {
    return (
      <CollectionFrame title="Departures">
        <EmptyState data-testid="departures-denied" message="Departures are available to owners and operations." />
      </CollectionFrame>
    );
  }

  async function start(): Promise<void> {
    if (!personId || !reason.trim()) return notify('error', 'Pick a person and give a reason.');
    setStarting(true);
    try {
      await api.initiateDeparture(personId, reason.trim());
      notify('success', 'Departure started.');
      setPersonId(''); setReason('');
      await refresh();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not start the departure.');
    } finally {
      setStarting(false);
    }
  }
  async function refresh(): Promise<void> {
    await qc.invalidateQueries({ queryKey: ['departures'] });
    await qc.invalidateQueries({ queryKey: ['situation'] });
  }
  async function complete(d: DepartureWithReadinessDto): Promise<void> {
    try {
      const res = await api.completeDeparture(d.departure.departureId, d.departure.version, deactivate, note.trim() || null);
      notify('success', res.deactivationApprovalId ? `Departure completed — deactivation ${res.deactivationApprovalId} awaits an owner.` : 'Departure completed.');
      setDeactivate(false); setNote('');
      await refresh();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not complete.');
    }
  }
  async function cancel(d: DepartureWithReadinessDto): Promise<void> {
    try {
      await api.cancelDeparture(d.departure.departureId, d.departure.version, note.trim() || null);
      notify('success', 'Departure cancelled.');
      setNote('');
      await refresh();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not cancel.');
    }
  }

  const rows = data?.departures ?? [];
  const open = rows.filter((d) => d.departure.status === 'InProgress');
  const closed = rows.filter((d) => d.departure.status !== 'InProgress');

  return (
    <CollectionFrame
      kicker="The twin of onboarding"
      title="Departures"
      scope={
        <>
          When someone leaves, start a departure and work the checklist: agreements to terminate, roster spots to clear,
          credentials to deactivate, kit to return — each closed from its own record. Complete it to close the loop (and
          optionally send the person through the governed deactivation).
        </>
      }
    >
      {/*
        // KIT-GAP WORKAROUND (provisional — remove when the gap closes).
        // GAP: this is an inline CREATE form (pick a person, give a reason, start),
        //   and the kit has no inline-form-row primitive or slot for one.
        //   CollectionFrame has a `filters` slot but these are not filters, and
        //   FormDrawer is the only form container — a drawer, wrong for a
        //   permanently-visible row. The one layout class that produces the row is
        //   `collection-filters`, which is CollectionFrame's OWN filter row.
        // WORKAROUND: hand-roll a <div className="collection-filters"> in the
        //   frame's children and borrow the filter row's flex/gap rule for a form.
        // CLASS: additive — a FormRow primitive, or an optional `create` slot on
        //   CollectionFrame, is a new export; no converted screen changes.
      */}
      <div className="collection-filters">
        <Field label="Person">
          <Selector
            data-testid="departure-person"
            placeholder="Select a person…"
            value={personId}
            display={personId ? (eligible.find((p) => p.personId === personId)?.fullName ?? '') : undefined}
            options={eligible.map((p) => ({ value: p.personId, label: `${p.fullName} (${p.personId})` }))}
            onSelect={(value) => setPersonId(value)}
          />
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="End of contract, transfer…" data-testid="departure-reason" />
        </Field>
        <button className="primary-action" type="button" onClick={() => void start()} disabled={starting} data-testid="departure-start">{starting ? 'Starting…' : 'Start departure'}</button>
      </div>

      {isLoading && <LoadingState label="Loading departures…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load departures.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && rows.length === 0 && <EmptyState data-testid="departures-empty" message="No departures — no one is offboarding." />}

      {open.map((d) => (
        // KIT-GAP WORKAROUND (provisional — remove when the gap closes).
        // GAP: the kit has no CARD primitive — a padded, vertically-rhythmed panel
        //   with a heading, a body and an action foot. WorkSurface supplies the
        //   material (tier/opacity) but no layout at all, and the only class that
        //   supplies the padding + grid + gap is `collection-frame`, which belongs
        //   to CollectionFrame. CollectionFrame itself cannot be nested here: it
        //   renders an <h1> and OVERWRITES document.title via usePageTitle.
        // WORKAROUND: WorkSurface + the borrowed `collection-frame` class.
        // CLASS: additive — a RecordCard primitive (or lifting the layout out of
        //   `collection-frame` into a class CollectionFrame also uses) is a new
        //   export that leaves every converted frame rendering identically.
        <WorkSurface as="article" tier="elevated" className="collection-frame" key={d.departure.departureId} data-testid={`departure-${d.departure.departureId}`}>
          <header className="surface-heading">
            <div>
              <h2>{d.personName}</h2>
              <p><span className="record-row-meta">{d.departure.departureId} · {d.departure.personId}</span></p>
              {/* Dates stay raw ISO — formatDisplayDate is a NEGATIVE contract. */}
              <p>{d.departure.reason} · started {d.departure.initiatedOn} by {d.departure.initiatedBy}</p>
            </div>
            <StatusBadge variant="pending">In progress</StatusBadge>
          </header>

          {/*
            // KIT-GAP WORKAROUND (provisional — remove when the gap closes).
            // GAP: no SUB-SECTION heading primitive, and no global heading reset in
            //   tablework.css (see CalendarPage for the full statement of this gap).
            // WORKAROUND: a <p className="eyebrow"> standing in for a heading — the
            //   checklist group carries none in the accessibility tree.
            // CLASS: additive — a SectionHeading primitive is a new export.
          */}
          <p className="eyebrow">Still open · {d.openItems.length}</p>
          {d.openItems.length === 0 ? (
            <p className="record-quiet success" data-testid={`departure-clear-${d.departure.departureId}`}>Everything is closed — ready to complete.</p>
          ) : (
            <div className="record-rows">
              {d.openItems.map((it) => (
                <div className="record-row-item" key={`${it.kind}-${it.id}`}>
                  <span className="record-row-meta">{it.kind}</span>
                  <span className="record-row-name">{it.label}</span>
                  <span className="record-row-spacer" />
                  <Link className="mini-action" to={it.route} data-testid={`departure-item-${it.id}`}>Open →</Link>
                </div>
              ))}
            </div>
          )}

          <div className="panel-actions">
            <GovernedAction
              triggerLabel="Complete…"
              triggerTestId={`departure-complete-${d.departure.departureId}`}
              triggerAppearance="primary"
              title={`Complete ${d.personName}'s departure?`}
              description={d.openItems.length > 0 ? `${d.openItems.length} item(s) are still open — you can complete anyway, but they will remain.` : 'Everything is closed. This finishes the offboarding record.'}
              extra={
                <>
                  <Checkbox label="Also send the person through governed deactivation" checked={deactivate} onChange={(checked) => setDeactivate(checked)} data-testid={`departure-deact-${d.departure.departureId}`} />
                  <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                </>
              }
              confirmLabel="Complete departure"
              onConfirm={() => complete(d)}
            />
            <GovernedAction
              triggerLabel="Cancel…"
              triggerTestId={`departure-cancel-${d.departure.departureId}`}
              triggerAppearance="secondary"
              title={`Cancel ${d.personName}'s departure?`}
              description="They are staying — this closes the departure record without offboarding."
              confirmLabel="Cancel departure"
              onConfirm={() => cancel(d)}
            />
          </div>
        </WorkSurface>
      ))}

      {closed.length > 0 && (
        <div>
          {/*
            // KIT-GAP WORKAROUND (provisional — remove when the gap closes).
            // GAP: no SUB-SECTION heading primitive, and ComparisonTable takes no
            //   visible caption (see CalendarPage for the full statement).
            // WORKAROUND: a <p className="eyebrow"> above the table, standing in for
            //   the caption the table cannot render.
            // CLASS: additive — a `caption` prop on ComparisonTable, or a
            //   SectionHeading primitive, is a new export.
          */}
          <p className="eyebrow">Closed</p>
          <ComparisonTable label="Closed departures" testId="departures-closed">
            <tbody>
              {closed.map((d) => (
                <tr key={d.departure.departureId}>
                  <td>
                    {d.personName} <span className="record-row-meta">{d.departure.departureId}</span>
                  </td>
                  <td>{d.departure.reason}</td>
                  <td><StatusBadge variant={d.departure.status === 'Completed' ? 'ready' : 'neutral'}>{d.departure.status}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </ComparisonTable>
        </div>
      )}
    </CollectionFrame>
  );
}
