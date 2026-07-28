import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { agreementRenewalStateOn, type AgreementRenewalState } from '@c3web/domain';
import { useAgreements, useEntities, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  amountToMinorAllowingZero,
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
  type SelectorOption,
} from '../tablework';
import { agreementRenewalStateOf, formatUsdCents } from '../labels';

/**
 * Agreements (Sprint 41) — contracts, NDAs, addendums, MOUs in one governed
 * register, on the Tablework frame (pivot W2 Lane A; behaviour, testids and
 * copy verbatim). Role-differentiated: hr/visitor never reach this page (nav is
 * hidden and the page fails closed); legal sees no financial column. The
 * 30/60/90 renewal windows are DERIVED filters over the same truthful list.
 */

/** NO-TOUCH: LOCAL calendar components, never toISOString. */
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


export function AgreementsPage() {
  return (
    <TableworkPage record="Agreements" section="Register" wide>
      <AgreementsRegister />
    </TableworkPage>
  );
}

function AgreementsRegister() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canRead = me?.capabilities.canReadAgreements ?? false;
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const showValue = me?.capabilities.canViewFinancials ?? false;
  // THE WIRE LAW: each capability IS the react-query `enabled` flag and stays
  // the `enabled` flag — a role that may not read agreements never receives
  // the register, and the composer's people/entities lists are fetched only
  // for a role that can actually submit.
  const { data, isLoading, isError, error } = useAgreements(canRead);
  const people = usePeople(canRead && canSubmit);
  const entities = useEntities(canRead && canSubmit);
  const today = localTodayIso();

  const [filter, setFilter] = useState<'all' | AgreementRenewalState>('all');
  const [showForm, setShowForm] = useState(false);
  const [personId, setPersonId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [agreementType, setAgreementType] = useState('');
  const [agreementCode, setAgreementCode] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [valueUsd, setValueUsd] = useState('');
  const [linkedId, setLinkedId] = useState('');
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
      <CollectionFrame title="Agreements">
        <EmptyState data-testid="agreements-denied" message="Agreements are unavailable for your role." />
      </CollectionFrame>
    );
  }

  async function submitCreate() {
    try {
      // M-02: exact-decimal law — a malformed value is a refusal, not a rounded guess.
      //
      // ⚠️ MONEY: consolidated onto the kit's zero-ALLOWING policy below. The
      // standing warning survives with sharper aim: `positiveAmountToMinor`
      // (zero-REJECTING) is NOT a valid substitute here — this screen accepts
      // 0 deliberately, and the two parsers differ exactly there.
      //
      // ⚠️ The guard below is STRICT `=== null` on purpose. `parsedCents` is
      // `undefined` when the field is empty (no value stated — legitimate, and
      // the norm for entity-level agreements), and `null` only when the input is
      // malformed. Loosening this to `== null` would refuse every value-less
      // agreement.
      //
      // F-1 CALL-SITE MIGRATION COMPLETE (the marker that stood here is
      // CLOSED — the ledger's last pair): the zero-allowing parse now rides
      // the kit's NAMED policy. Behaviour-identical by construction (the kit
      // export IS the domain parser, verbatim), and the two invariants the
      // standing table protects are UNTOUCHED here at the call site:
      //   - `undefined` ("no value stated", the trim()==='' branch) vs `null`
      //     ("malformed") — the parser never sees the empty string;
      //   - `=== null` (never `== null`, never falsy) — a 0.00 value LIVES.
      const parsedCents = valueUsd.trim() === '' ? undefined : amountToMinorAllowingZero(valueUsd);
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
      setPersonId(''); setEntityId(''); setAgreementType(''); setAgreementCode('');
      setStartsOn(''); setEndsOn(''); setValueUsd(''); setLinkedId('');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
      throw err instanceof Error ? err : new Error('Submission failed.');
    }
  }

  // THE ANCHOR RULE: a person, an entity, or both — never neither.
  // ⚠️ The value check is a LAX `Number()` on purpose: readiness must not be
  // stricter than the submit-time parser, or Submit disables itself with no
  // message. Tightening it here would silently strand the user.
  const ready =
    (personId !== '' || entityId !== '') &&
    agreementType.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(startsOn) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endsOn) &&
    endsOn >= startsOn &&
    (valueUsd.trim() === '' || !Number.isNaN(Number(valueUsd)));

  const addAction = canSubmit ? (
    <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="add-agreement-toggle">
      Add agreement
    </button>
  ) : undefined;

  const personOptions: SelectorOption[] = [
    { value: '', label: 'No person — entity-level' },
    ...(people.data?.people ?? []).map((p) => ({ value: p.personId, label: `${p.fullName} (${p.personId})` })),
  ];
  const entityOptions: SelectorOption[] = [
    { value: '', label: 'Not assigned' },
    ...activeEntities.map((e) => ({ value: e.entityId, label: `${e.name} (${e.jurisdiction})` })),
  ];
  const linkOptions: SelectorOption[] = [
    { value: '', label: 'Not linked' },
    ...(data?.agreements ?? []).map((a) => ({ value: a.agreementId, label: `${a.agreementId} — ${a.agreementType}` })),
  ];

  const filters = (
    <>
      {FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          className={filter === f.key ? 'primary-action' : 'secondary-action'}
          aria-pressed={filter === f.key}
          onClick={() => setFilter(f.key)}
          data-testid={`agreements-filter-${f.key}`}
        >
          {f.label}
        </button>
      ))}
    </>
  );

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title="Agreements"
        count={data ? `${rows.length} in this view` : undefined}
        actions={addAction}
        filters={filters}
        filtersLabel="Renewal window filter"
      >
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
                <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="agreements-empty-add">
                  Add agreement
                </button>
              ) : undefined
            }
          />
        )}
        {/* M2 — the count is stated ONCE, in CollectionFrame's header. The old
            r.count footer repeated it; no testid, no spec asserted its text. */}
        {data && rows.length > 0 && (
          <ComparisonTable label="Agreements register" testId="agreements-table">
            <thead>
              <tr>
                <th>Agreement</th>
                <th>Code</th>
                <th>Person</th>
                <th>Entity</th>
                <th>Type</th>
                <th>Ends</th>
                {showValue && <th>Value</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const badge = agreementRenewalStateOf(a.renewalState);
                return (
                  <tr key={a.agreementId} data-testid={`agreement-row-${a.agreementId}`}>
                    <td>
                      <RecordLink to={`/agreements/${a.agreementId}`} data-testid={`agreement-link-${a.agreementId}`}>
                        {a.agreementId}
                      </RecordLink>
                    </td>
                    <td>{a.agreementCode ?? '—'}</td>
                    <td data-testid={`agreement-person-${a.agreementId}`}>
                      {a.personId ? <RecordLink to={`/people/${a.personId}`}>{a.personId}</RecordLink> : '—'}
                    </td>
                    <td data-testid={`agreement-entity-${a.agreementId}`}>{entityName(a.entityId)}</td>
                    <td>{a.agreementType}</td>
                    {/* NEGATIVE contract: the oracle pins raw ISO here
                        ('2027-07-31'). formatDisplayDate must NOT be adopted. */}
                    <td>{a.endsOn}</td>
                    {showValue && (
                      <td data-testid={`agreement-value-${a.agreementId}`}>
                        {/* formatUsdCents is symbol-first ("$250,000.00") with a
                            null -> '—' branch. formatMinor is code-first and has
                            no null branch — they are NOT interchangeable. */}
                        {formatUsdCents(a.valueUsdCents)}
                      </td>
                    )}
                    <td>
                      <StatusBadge variant={badge.variant} data-testid={`agreement-status-${a.agreementId}`}>
                        {badge.label}
                      </StatusBadge>
                    </td>
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
            <Selector
              data-testid="add-agreement-person"
              placeholder="Select a person"
              value={personId}
              options={personOptions}
              onSelect={(value) => setPersonId(value)}
            />
          </Field>
          {activeEntities.length > 0 && (
            <Field label="Under entity" hint="Which of your legal entities this agreement sits under. Required when no person is selected.">
              <Selector
                data-testid="add-agreement-entity"
                placeholder="Not assigned"
                value={entityId}
                options={entityOptions}
                onSelect={(value) => setEntityId(value)}
              />
            </Field>
          )}
          <Field label="Agreement type" required hint='e.g. "Player Contract", "NDA", "Addendum"'>
            <Input value={agreementType} onChange={(e) => setAgreementType(e.target.value)} data-testid="add-agreement-type" />
          </Field>
          <Field label="Agreement code">
            <Input value={agreementCode} onChange={(e) => setAgreementCode(e.target.value)} data-testid="add-agreement-code" />
          </Field>
          <Field label="Linked to (parent agreement)">
            <Selector
              data-testid="add-agreement-link"
              placeholder="Not linked"
              value={linkedId}
              options={linkOptions}
              onSelect={(value) => setLinkedId(value)}
            />
          </Field>
          <Field label="Starts on" required>
            <DateInput value={startsOn} onChange={(e) => setStartsOn(e.target.value)} data-testid="add-agreement-starts" />
          </Field>
          <Field label="Ends on" required>
            <DateInput value={endsOn} onChange={(e) => setEndsOn(e.target.value)} data-testid="add-agreement-ends" />
          </Field>
          {showValue && (
            <Field label="Value (USD)">
              <Input type="number" value={valueUsd} onChange={(e) => setValueUsd(e.target.value)} data-testid="add-agreement-value" />
            </Field>
          )}
        </FormDrawer>
      )}
    </>
  );
}
