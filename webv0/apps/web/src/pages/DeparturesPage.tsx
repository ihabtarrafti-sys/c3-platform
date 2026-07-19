import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Dropdown, Field, Input, Option, Textarea, makeStyles } from '@fluentui/react-components';
import type { DepartureWithReadinessDto } from '@c3web/api-contracts';
import { useDepartures, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { StatusBadge } from '../components/StatusBadge';
import { GovernedAction } from '../components/GovernedAction';
import { useRegisterStyles } from '../components/registerStyles';

/**
 * Departure workflow (Track B) — the offboarding twin of onboarding. Start a
 * departure for a person, then work the derived readiness checklist: everything
 * still open across their agreements / roster / credentials / kit, each closed
 * from its own record. Complete hands them to the governed DeactivatePerson when
 * asked. Owner/operations. The cockpit carries a "departure incomplete" signal.
 */

const useStyles = makeStyles({
  intro: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-muted)', maxWidth: '680px', marginBottom: '16px' },
  starter: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px', marginBottom: '24px' },
  card: { border: '1px solid var(--c3-border-subtle)', borderRadius: 'var(--c3-radius-md, 14px)', padding: '16px 18px', marginBottom: '14px', display: 'flex', flexDirection: 'column', rowGap: '10px' },
  head: { display: 'flex', alignItems: 'baseline', columnGap: '10px' },
  name: { fontSize: '15px', fontWeight: 600, color: 'var(--c3-ink-default)' },
  depId: { fontFamily: 'var(--c3-font-mono)', fontSize: '11.5px', color: 'var(--c3-ink-quiet)' },
  meta: { fontSize: '12.5px', color: 'var(--c3-ink-muted)' },
  itemsTitle: { fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c3-ink-quiet)', fontFamily: 'var(--c3-font-mono)' },
  item: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--c3-ink-default)' },
  itemKind: { fontFamily: 'var(--c3-font-mono)', fontSize: '10.5px', letterSpacing: '0.06em', color: 'var(--c3-ink-quiet)', minWidth: '74px' },
  clear: { fontSize: '13px', color: 'var(--c3-state-success, #2ea043)' },
  actions: { display: 'flex', gap: '8px', marginTop: '4px' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '10px', minWidth: '320px' },
});

export function DeparturesPage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canViewSituation ?? false;

  const { data, isLoading, isError, error } = useDepartures(canManage);
  const people = usePeople(canManage);
  const [personId, setPersonId] = useState('');
  const [reason, setReason] = useState('');
  const [starting, setStarting] = useState(false);
  const [deactivate, setDeactivate] = useState(false);
  const [note, setNote] = useState('');

  const departingIds = useMemo(() => new Set((data?.departures ?? []).filter((d) => d.departure.status === 'InProgress').map((d) => d.departure.personId)), [data]);
  const eligible = useMemo(() => (people.data?.people ?? []).filter((p) => p.isActive && !departingIds.has(p.personId)), [people.data, departingIds]);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Departures" />
        <EmptyState data-testid="departures-denied" message="Departures are available to owners and operations." />
      </div>
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
    <div>
      <PageHeader kicker="The twin of onboarding" title="Departures" />
      <p className={s.intro}>
        When someone leaves, start a departure and work the checklist: agreements to terminate, roster spots to clear,
        credentials to deactivate, kit to return — each closed from its own record. Complete it to close the loop (and
        optionally send the person through the governed deactivation).
      </p>

      <div className={s.starter}>
        <Field label="Person">
          <Dropdown
            placeholder="Select a person…"
            value={eligible.find((p) => p.personId === personId)?.fullName ?? ''}
            selectedOptions={personId ? [personId] : []}
            onOptionSelect={(_, d) => setPersonId(d.optionValue ?? '')}
            data-testid="departure-person"
            style={{ minWidth: '240px' }}
          >
            {eligible.map((p) => <Option key={p.personId} value={p.personId} text={`${p.fullName} (${p.personId})`}>{p.fullName} ({p.personId})</Option>)}
          </Dropdown>
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(_, d) => setReason(d.value)} placeholder="End of contract, transfer…" data-testid="departure-reason" style={{ minWidth: '220px' }} />
        </Field>
        <Button appearance="primary" onClick={start} disabled={starting} data-testid="departure-start">{starting ? 'Starting…' : 'Start departure'}</Button>
      </div>

      {isLoading && <LoadingState label="Loading departures…" />}
      {isError && <ErrorState message={error instanceof ApiError ? error.message : 'Could not load departures.'} />}
      {data && rows.length === 0 && <EmptyState data-testid="departures-empty" message="No departures — no one is offboarding." />}

      {open.map((d) => (
        <div className={s.card} key={d.departure.departureId} data-testid={`departure-${d.departure.departureId}`}>
          <div className={s.head}>
            <span className={s.name}>{d.personName}</span>
            <span className={s.depId}>{d.departure.departureId} · {d.departure.personId}</span>
            <StatusBadge variant="pending">In progress</StatusBadge>
          </div>
          <div className={s.meta}>{d.departure.reason} · started {d.departure.initiatedOn} by {d.departure.initiatedBy}</div>

          <div className={s.itemsTitle}>Still open · {d.openItems.length}</div>
          {d.openItems.length === 0 ? (
            <div className={s.clear} data-testid={`departure-clear-${d.departure.departureId}`}>Everything is closed — ready to complete.</div>
          ) : (
            d.openItems.map((it) => (
              <div className={s.item} key={`${it.kind}-${it.id}`}>
                <span className={s.itemKind}>{it.kind}</span>
                <span>{it.label}</span>
                <Link className={s.meta} to={it.route} style={{ marginLeft: 'auto' }} data-testid={`departure-item-${it.id}`}>Open →</Link>
              </div>
            ))
          )}

          <div className={s.actions}>
            <GovernedAction
              triggerLabel="Complete…"
              triggerTestId={`departure-complete-${d.departure.departureId}`}
              triggerAppearance="primary"
              title={`Complete ${d.personName}'s departure?`}
              description={d.openItems.length > 0 ? `${d.openItems.length} item(s) are still open — you can complete anyway, but they will remain.` : 'Everything is closed. This finishes the offboarding record.'}
              extra={
                <div className={s.fields}>
                  <Checkbox label="Also send the person through governed deactivation" checked={deactivate} onChange={(_, dd) => setDeactivate(!!dd.checked)} data-testid={`departure-deact-${d.departure.departureId}`} />
                  <Field label="Note (optional)"><Textarea value={note} onChange={(_, dd) => setNote(dd.value)} /></Field>
                </div>
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
        </div>
      ))}

      {closed.length > 0 && (
        <>
          <div className={s.itemsTitle} style={{ marginTop: '24px', marginBottom: '10px' }}>Closed</div>
          <table className={r.table} data-testid="departures-closed" aria-label="Closed departures">
            <tbody>
              {closed.map((d) => (
                <tr key={d.departure.departureId} className={r.row}>
                  <td className={r.td}><span className={s.name} style={{ fontSize: '13.5px' }}>{d.personName}</span> <span className={s.depId}>{d.departure.departureId}</span></td>
                  <td className={r.td}><span className={s.meta}>{d.departure.reason}</span></td>
                  <td className={r.td}><StatusBadge variant={d.departure.status === 'Completed' ? 'ready' : 'neutral'}>{d.departure.status}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
