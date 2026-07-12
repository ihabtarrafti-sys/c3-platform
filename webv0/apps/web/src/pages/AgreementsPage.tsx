import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Field, Input, Option, makeStyles } from '@fluentui/react-components';
import { agreementRenewalStateOn, parseDecimalToMinor, type AgreementRenewalState } from '@c3web/domain';
import { useAgreements, useEntities, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { FormDrawer } from '../components/FormDrawer';
import { agreementRenewalStateOf, formatUsdCents } from '../labels';

/**
 * Agreements (Sprint 41) — contracts, NDAs, addendums, MOUs in one governed
 * register. Role-differentiated: hr/visitor never reach this page (nav is
 * hidden and the page fails closed); legal sees no financial column. The
 * 30/60/90 renewal windows are DERIVED filters over the same truthful list.
 */

function localTodayIso(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const FILTERS: Array<{ key: 'all' | AgreementRenewalState; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'Due30', label: 'Due in 30' },
  { key: 'Due60', label: 'Due in 60' },
  { key: 'Due90', label: 'Due in 90' },
  { key: 'Expired', label: 'Expired' },
];

const useStyles = makeStyles({
  personSelect: { minWidth: '260px' },
  filters: { display: 'flex', columnGap: '8px', flexWrap: 'wrap', marginBottom: '16px' },
});

export function AgreementsPage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canRead = me?.capabilities.canReadAgreements ?? false;
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const showValue = me?.capabilities.canViewFinancials ?? false;
  const { data, isLoading, isError, error } = useAgreements(canRead);
  const people = usePeople(canRead && canSubmit);
  const entities = useEntities(canRead && canSubmit);
  const today = localTodayIso();

  const [filter, setFilter] = useState<'all' | AgreementRenewalState>('all');
  const [showForm, setShowForm] = useState(false);
  const [personId, setPersonId] = useState('');
  const [personLabel, setPersonLabel] = useState('');
  const [entityId, setEntityId] = useState('');
  const [entityLabel, setEntityLabel] = useState('');
  const [agreementType, setAgreementType] = useState('');
  const [agreementCode, setAgreementCode] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [valueUsd, setValueUsd] = useState('');
  const [linkedId, setLinkedId] = useState('');
  const [linkedLabel, setLinkedLabel] = useState('');
  const activeEntities = (entities.data?.entities ?? []).filter((e) => e.isActive);
  const entityName = (id: string | null): string => {
    if (!id) return '—';
    const e = (entities.data?.entities ?? []).find((x) => x.entityId === id);
    return e ? e.name : id;
  };

  const rows = useMemo(() => {
    const all = (data?.agreements ?? []).map((a) => ({ ...a, renewalState: agreementRenewalStateOn(a, today) }));
    return filter === 'all' ? all : all.filter((a) => a.renewalState === filter);
  }, [data, filter, today]);

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Agreements" />
        <EmptyState data-testid="agreements-denied" message="Agreements are unavailable for your role." />
      </div>
    );
  }

  async function submitCreate() {
    try {
      // M-02: exact-decimal law — a malformed value is a refusal, not a rounded guess.
      const parsedCents = valueUsd.trim() === '' ? undefined : parseDecimalToMinor(valueUsd);
      if (parsedCents === null) {
        notify('error', 'The value must be a plain amount with at most 2 decimals (e.g. 2500 or 2500.50).');
        return;
      }
      const cents = parsedCents;
      const res = await api.submitAddAgreement({
        personId: personId || undefined,
        entityId: entityId || undefined,
        agreementType: agreementType.trim(),
        agreementCode: agreementCode.trim() || undefined,
        linkedAgreementId: linkedId || undefined,
        startsOn,
        endsOn,
        valueUsdCents: cents,
      } as Parameters<typeof api.submitAddAgreement>[0]);
      notify('success', `Submitted ${res.approval.approvalId} for approval. The agreement is not created until an owner executes it.`);
      setShowForm(false);
      setPersonId(''); setPersonLabel(''); setEntityId(''); setEntityLabel(''); setAgreementType(''); setAgreementCode('');
      setStartsOn(''); setEndsOn(''); setValueUsd(''); setLinkedId(''); setLinkedLabel('');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
      throw err instanceof Error ? err : new Error('Submission failed.');
    }
  }

  // THE ANCHOR RULE: a person, an entity, or both — never neither.
  const ready =
    (personId !== '' || entityId !== '') &&
    agreementType.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(startsOn) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endsOn) &&
    endsOn >= startsOn &&
    (valueUsd.trim() === '' || !Number.isNaN(Number(valueUsd)));

  const addAction = canSubmit ? (
    <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="add-agreement-toggle">
      Add Agreement
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader kicker="Register" title="Agreements" context={data ? `${rows.length} in this view` : undefined} actions={addAction} />

      {canSubmit && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow="New agreement"
          mode="governed"
          intro="New agreements go through approval — an owner must review and execute before the agreement exists."
          footer={
            <GovernedAction
              triggerLabel="Submit for approval"
              triggerTestId="add-agreement-submit"
              triggerDisabled={!ready}
              title="Submit this agreement request for approval?"
              description="It goes to an approver for review; you can edit it until review starts, then it’s frozen. Approval and execution are separate steps."
              confirmLabel="Submit for approval"
              onConfirm={submitCreate}
            />
          }
        >
          <Field label="Person" hint="Optional for entity-level agreements (sponsorships, partnership fees) — anchor to an entity below instead.">
            <Dropdown
              className={s.personSelect}
              placeholder="Select a person"
              value={personLabel}
              selectedOptions={personId ? [personId] : []}
              onOptionSelect={(_, d) => {
                setPersonId(d.optionValue ?? '');
                setPersonLabel(d.optionValue ? (d.optionText ?? '') : '');
              }}
              data-testid="add-agreement-person"
            >
              <Option value="" text="No person — entity-level">
                No person — entity-level
              </Option>
              {(people.data?.people ?? []).map((p) => (
                <Option key={p.personId} value={p.personId} text={`${p.fullName} (${p.personId})`}>
                  {`${p.fullName} (${p.personId})`}
                </Option>
              ))}
            </Dropdown>
          </Field>
          {activeEntities.length > 0 && (
            <Field label="Under entity" hint="Which of your legal entities this agreement sits under. Required when no person is selected.">
              <Dropdown
                className={s.personSelect}
                placeholder="Not assigned"
                value={entityLabel}
                selectedOptions={entityId ? [entityId] : []}
                onOptionSelect={(_, d) => {
                  setEntityId(d.optionValue ?? '');
                  setEntityLabel(d.optionValue ? (d.optionText ?? '') : '');
                }}
                data-testid="add-agreement-entity"
              >
                <Option value="" text="Not assigned">
                  Not assigned
                </Option>
                {activeEntities.map((e) => (
                  <Option key={e.entityId} value={e.entityId} text={`${e.name} (${e.jurisdiction})`}>
                    {`${e.name} (${e.jurisdiction})`}
                  </Option>
                ))}
              </Dropdown>
            </Field>
          )}
          <Field label="Agreement type" required hint='e.g. "Player Contract", "NDA", "Addendum"'>
            <Input value={agreementType} onChange={(_, d) => setAgreementType(d.value)} data-testid="add-agreement-type" />
          </Field>
          <Field label="Agreement code">
            <Input value={agreementCode} onChange={(_, d) => setAgreementCode(d.value)} data-testid="add-agreement-code" />
          </Field>
          <Field label="Linked to (parent agreement)">
            <Dropdown
              className={s.personSelect}
              placeholder="Not linked"
              value={linkedLabel}
              selectedOptions={linkedId ? [linkedId] : []}
              onOptionSelect={(_, d) => {
                setLinkedId(d.optionValue ?? '');
                setLinkedLabel(d.optionValue ? (d.optionText ?? '') : '');
              }}
              data-testid="add-agreement-link"
            >
              <Option value="" text="Not linked">
                Not linked
              </Option>
              {(data?.agreements ?? []).map((a) => (
                <Option key={a.agreementId} value={a.agreementId} text={`${a.agreementId} — ${a.agreementType}`}>
                  {`${a.agreementId} — ${a.agreementType}`}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label="Starts on" required>
            <Input type="date" value={startsOn} onChange={(_, d) => setStartsOn(d.value)} data-testid="add-agreement-starts" />
          </Field>
          <Field label="Ends on" required>
            <Input type="date" value={endsOn} onChange={(_, d) => setEndsOn(d.value)} data-testid="add-agreement-ends" />
          </Field>
          {showValue && (
            <Field label="Value (USD)">
              <Input type="number" value={valueUsd} onChange={(_, d) => setValueUsd(d.value)} data-testid="add-agreement-value" />
            </Field>
          )}
        </FormDrawer>
      )}

      <div className={s.filters} role="group" aria-label="Renewal window filter">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="small"
            appearance={filter === f.key ? 'primary' : 'secondary'}
            onClick={() => setFilter(f.key)}
            data-testid={`agreements-filter-${f.key}`}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {isLoading && <LoadingState label="Loading agreements…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load agreements.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && rows.length === 0 && (
        <EmptyState
          data-testid="agreements-empty"
          message={filter === 'all' ? 'No agreements yet.' : 'Nothing in this renewal window.'}
          action={
            canSubmit && filter === 'all' ? (
              <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="agreements-empty-add">
                Add Agreement
              </Button>
            ) : undefined
          }
        />
      )}
      {data && rows.length > 0 && (
        <>
          <table className={r.table} data-testid="agreements-table" aria-label="Agreements register">
            <thead>
              <tr>
                <th className={r.th}>Agreement</th>
                <th className={r.th}>Code</th>
                <th className={r.th}>Person</th>
                <th className={r.th}>Entity</th>
                <th className={r.th}>Type</th>
                <th className={r.th}>Ends</th>
                {showValue && <th className={r.th}>Value</th>}
                <th className={r.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const badge = agreementRenewalStateOf(a.renewalState);
                return (
                  <tr key={a.agreementId} className={r.row} data-testid={`agreement-row-${a.agreementId}`}>
                    <td className={r.td}>
                      <Link className={r.idLink} to={`/agreements/${a.agreementId}`} data-testid={`agreement-link-${a.agreementId}`}>
                        {a.agreementId}
                      </Link>
                    </td>
                    <td className={r.td}>{a.agreementCode ?? '—'}</td>
                    <td className={r.td} data-testid={`agreement-person-${a.agreementId}`}>
                      {a.personId ? (
                        <Link className={r.idLink} to={`/people/${a.personId}`}>
                          {a.personId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={r.td} data-testid={`agreement-entity-${a.agreementId}`}>{entityName(a.entityId)}</td>
                    <td className={`${r.td} ${r.name}`}>{a.agreementType}</td>
                    <td className={r.td}>{a.endsOn}</td>
                    {showValue && (
                      <td className={r.td} data-testid={`agreement-value-${a.agreementId}`}>
                        {formatUsdCents(a.valueUsdCents)}
                      </td>
                    )}
                    <td className={r.td}>
                      <StatusBadge variant={badge.variant} data-testid={`agreement-status-${a.agreementId}`}>
                        {badge.label}
                      </StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={r.count}>
            {rows.length} {rows.length === 1 ? 'agreement' : 'agreements'}
          </div>
        </>
      )}
    </div>
  );
}
