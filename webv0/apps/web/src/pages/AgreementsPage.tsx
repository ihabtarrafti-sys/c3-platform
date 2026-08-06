import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
  RecheckingTruthPanel,
  Field,
  Input,
  DateInput,
  Selector,
  FormDrawer,
  GovernedAction,
  isCurrentMoneyWitness,
  moneyActionsAvailable,
  moneyWitnessOf,
  type SelectorOption,
  type WitnessState,
} from '../tablework';
import { agreementRenewalStateOf, formatUsdCents } from '../labels';
import { useForegroundRewitness } from '../tablework/useForegroundRewitness';

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

export interface AgreementsRegisterProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly requestKey?: string | number;
  readonly onTruthChange?: (truth: WitnessState) => void;
  readonly linkToAgreement?: (agreementId: string) => string;
  readonly linkToPerson?: (personId: string) => string;
}

export function AgreementsRegister({
  enabled = true,
  foreground = true,
  requestKey,
  onTruthChange,
  linkToAgreement = (agreementId) => `/agreements/${agreementId}`,
  linkToPerson = (personId) => `/people/${personId}`,
}: AgreementsRegisterProps = {}) {
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
  const queryEnabled = enabled && canRead;
  const composerEnabled = enabled && canRead && canSubmit;
  const query = useAgreements(queryEnabled);
  const people = usePeople(composerEnabled);
  const entities = useEntities(composerEnabled);
  const rewitnessing = useForegroundRewitness({ foreground, enabled: queryEnabled, refetch: query.refetch, requestKey });
  const peopleRewitnessing = useForegroundRewitness({ foreground, enabled: composerEnabled, refetch: people.refetch, requestKey });
  const entitiesRewitnessing = useForegroundRewitness({ foreground, enabled: composerEnabled, refetch: entities.refetch, requestKey });
  const truth = useMemo(
    () =>
      moneyWitnessOf(
        {
          included: canRead,
          data: query.data,
          error: query.error,
          isLoading: query.isLoading,
          isFetching: query.isFetching || rewitnessing,
          dataUpdatedAt: query.dataUpdatedAt,
        },
        {
          isEmpty: (view) => view.agreements.length === 0,
          omittedReason: 'AGREEMENTS_UNAVAILABLE',
          recheckMessage: 'The agreement register is being checked again.',
        },
      ),
    [canRead, query.data, query.dataUpdatedAt, query.error, query.isFetching, query.isLoading, rewitnessing],
  );
  const peopleTruth = useMemo(
    () =>
      moneyWitnessOf(
        {
          included: composerEnabled,
          data: people.data,
          error: people.error,
          isLoading: people.isLoading,
          isFetching: people.isFetching || peopleRewitnessing,
          dataUpdatedAt: people.dataUpdatedAt,
        },
        {
          isEmpty: (view) => view.people.length === 0,
          omittedReason: 'AGREEMENT_COMPOSER_NOT_INCLUDED',
          recheckMessage: 'The agreement person choices are being checked again.',
        },
      ),
    [composerEnabled, people.data, people.dataUpdatedAt, people.error, people.isFetching, people.isLoading, peopleRewitnessing],
  );
  const entitiesTruth = useMemo(
    () =>
      moneyWitnessOf(
        {
          included: composerEnabled,
          data: entities.data,
          error: entities.error,
          isLoading: entities.isLoading,
          isFetching: entities.isFetching || entitiesRewitnessing,
          dataUpdatedAt: entities.dataUpdatedAt,
        },
        {
          isEmpty: (view) => view.entities.length === 0,
          omittedReason: 'AGREEMENT_COMPOSER_NOT_INCLUDED',
          recheckMessage: 'The agreement Entity choices are being checked again.',
        },
      ),
    [composerEnabled, entities.data, entities.dataUpdatedAt, entities.error, entities.isFetching, entities.isLoading, entitiesRewitnessing],
  );
  const canCompose = moneyActionsAvailable(canSubmit && enabled, truth, foreground, [peopleTruth, entitiesTruth]);
  const today = localTodayIso();

  useEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

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
  const activeEntities = (isCurrentMoneyWitness(entitiesTruth) ? entities.data?.entities ?? [] : []).filter((e) => e.isActive);
  const entityName = (id: string | null): string => {
    if (!id) return '—';
    const e = (isCurrentMoneyWitness(entitiesTruth) ? entities.data?.entities ?? [] : []).find((x) => x.entityId === id);
    return e ? e.name : id;
  };

  const rows = useMemo(() => {
    const all = (query.data?.agreements ?? []).map((a) => ({ ...a, renewalState: agreementRenewalStateOn(a, today) }));
    return filter === 'all' ? all : all.filter((a) => a.renewalState === filter);
  }, [query.data, filter, today]);

  useLayoutEffect(() => {
    if (!canCompose) setShowForm(false);
  }, [canCompose]);

  async function submitCreate() {
    if (!canCompose) {
      notify('error', 'The agreement register and its authoring choices must be current before a request can be submitted.');
      return;
    }
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

  const addAction = canCompose ? (
    <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="add-agreement-toggle">
      Add agreement
    </button>
  ) : undefined;

  const personOptions: SelectorOption[] = [
    { value: '', label: 'No person — entity-level' },
    ...(isCurrentMoneyWitness(peopleTruth) ? people.data?.people ?? [] : []).map((p) => ({ value: p.personId, label: `${p.fullName} (${p.personId})` })),
  ];
  const entityOptions: SelectorOption[] = [
    { value: '', label: 'Not assigned' },
    ...activeEntities.map((e) => ({ value: e.entityId, label: `${e.name} (${e.jurisdiction})` })),
  ];
  const linkOptions: SelectorOption[] = [
    { value: '', label: 'Not linked' },
    ...(isCurrentMoneyWitness(truth) ? query.data?.agreements ?? [] : []).map((a) => ({ value: a.agreementId, label: `${a.agreementId} — ${a.agreementType}` })),
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
        count={isCurrentMoneyWitness(truth) ? `${rows.length} in this view` : undefined}
        actions={addAction}
        filters={filters}
        filtersLabel="Renewal window filter"
      >
        {canSubmit && isCurrentMoneyWitness(truth) && !canCompose && (
          <p className="boundary-note" data-testid="agreement-composer-unavailable">
            Agreement authoring is unavailable until the People and Entity choices have a current witness.
          </p>
        )}
        <RecheckingTruthPanel
          state={truth}
          rechecking={rewitnessing || (query.isFetching && query.error == null)}
          emptyLabel={filter === 'all' ? 'No agreements yet.' : 'Nothing in this renewal window.'}
          testids={{
            loading: 'agreements-loading',
            empty: 'agreements-empty',
            denied: 'agreements-denied',
            failed: 'agreements-error',
            stale: 'agreements-stale',
          }}
        >
        {/* M2 — the count is stated ONCE, in CollectionFrame's header. The old
            r.count footer repeated it; no testid, no spec asserted its text. */}
        {rows.length > 0 && (
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
                      <RecordLink to={linkToAgreement(a.agreementId)} data-testid={`agreement-link-${a.agreementId}`}>
                        {a.agreementId}
                      </RecordLink>
                    </td>
                    <td>{a.agreementCode ?? '—'}</td>
                    <td data-testid={`agreement-person-${a.agreementId}`}>
                      {a.personId ? <RecordLink to={linkToPerson(a.personId)}>{a.personId}</RecordLink> : '—'}
                    </td>
                    <td data-testid={`agreement-entity-${a.agreementId}`}>{entityName(a.entityId)}</td>
                    <td>{a.agreementType}</td>
                    {/* NEGATIVE contract: the oracle pins raw ISO here
                        ('2027-07-31'). formatDisplayDate must NOT be adopted. */}
                    <td>{a.endsOn}</td>
                    {showValue && (
                      <td data-testid={`agreement-value-${a.agreementId}`}>
                        {/* formatUsdCents is the canonical code-first formatter
                            with a null -> '—' branch; raw formatMoney has no
                            null branch, so the wrapper remains intentional. */}
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
        </RecheckingTruthPanel>
      </CollectionFrame>

      {canCompose && (
        <FormDrawer
          open={showForm && canCompose}
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
