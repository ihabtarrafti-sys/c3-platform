import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  agreementRenewalStateOn,
  AGREEMENT_TERM_KINDS,
  CURRENCY_CODES,
  MINOR_UNITS_PER_UNIT,
  isMonetaryTermKind,
  termLabelRequired,
  type AgreementTermKind,
  type CurrencyCode,
} from '@c3web/domain';
import { useAgreement, useAgreementAudit, useAgreements, useAgreementTerms, useEntities } from '../queries';
import { ApiError, type AgreementTermDto } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  TableworkPage,
  RecordBackLink,
  RecordPage,
  RecordLink,
  ComparisonTable,
  CommentThread,
  DocumentsSection,
  AuditTimeline,
  FactList,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  Field,
  Input,
  DateInput,
  Selector,
  GovernedAction,
  type DefItem,
  type SelectorOption,
  type TimelineEntry,
  positivePercentToBps,
  positiveAmountToMinor,
} from '../tablework';
import { agreementRenewalStateOf, agreementTermKindOf, auditActionOf, formatTermValue, formatUsdCents } from '../labels';

/**
 * AgreementDetailPage (Sprint 41) — one agreement, honestly split: the
 * MATERIAL lifecycle (renew / terminate) is governed and says so; the
 * NON-MATERIAL edit (code / type / notes) is immediate and recorded. Linked
 * addendums appear as first-class relationships, both directions.
 *
 * Pivot W2 Lane A: on the Tablework frame, behaviour/testids/copy verbatim.
 * Breadcrumbs do NOT port — the ContextHeader's working-from band replaces
 * them, and RecordBackLink (the kit's single `record-back-link`) keeps the
 * route back to the register that the crumb used to carry.
 */

/** NO-TOUCH: LOCAL calendar components, never toISOString. */
function localTodayIso(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DIALOG_FIELDS: React.CSSProperties = { display: 'flex', flexDirection: 'column', rowGap: '8px' };
const ROW_ACTIONS: React.CSSProperties = { display: 'flex', columnGap: '8px', flexWrap: 'wrap' };
const CURRENCY_OPTIONS: SelectorOption[] = CURRENCY_CODES.map((c) => ({ value: c, label: c }));
const TERM_KIND_OPTIONS: SelectorOption[] = AGREEMENT_TERM_KINDS.map((k) => ({ value: k, label: agreementTermKindOf(k) }));

export function AgreementDetailPage() {
  const { agreementId = '' } = useParams();
  return (
    <TableworkPage
      record={agreementId}
      section="Agreement"
      actions={<RecordBackLink to="/agreements">Agreements</RecordBackLink>}
    >
      <AgreementDetailRecord agreementId={agreementId} />
    </TableworkPage>
  );
}

function AgreementDetailRecord({ agreementId }: { agreementId: string }) {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canRead = me?.capabilities.canReadAgreements ?? false;
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const showValue = me?.capabilities.canViewFinancials ?? false;
  const canViewHistory = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  // THE WIRE LAW: every capability here stays the react-query `enabled` flag.
  const { data, isLoading, isError, error } = useAgreement(agreementId, canRead);
  const siblings = useAgreements(canRead);
  const entities = useEntities(canRead);
  const audit = useAgreementAudit(agreementId, canRead && canViewHistory);

  const [renewEndsOn, setRenewEndsOn] = useState('');
  const [terminateReason, setTerminateReason] = useState('');
  const [edit, setEdit] = useState<{ code: string; type: string; notes: string; link: string; linkLabel: string } | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['agreement', agreementId] });
    void qc.invalidateQueries({ queryKey: ['agreements'] });
    void qc.invalidateQueries({ queryKey: ['agreementAudit', agreementId] });
    void qc.invalidateQueries({ queryKey: ['approvals'] });
  };

  if (!canRead) {
    return (
      <RecordPage eyebrow="Agreement" title="Agreement">
        <EmptyState data-testid="agreements-denied" message="Agreements are unavailable for your role." />
      </RecordPage>
    );
  }

  if (isError) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <RecordPage eyebrow="Agreement" title={agreementId}>
        <ErrorState
          data-testid="agreement-error"
          message={is404 ? `No agreement ${agreementId} in your organization.` : 'Could not load this agreement.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      </RecordPage>
    );
  }

  const a = data?.agreement;
  const today = localTodayIso();
  const badge = a ? agreementRenewalStateOf(agreementRenewalStateOn(a, today)) : null;
  const addendums = (siblings.data?.agreements ?? []).filter((x) => x.linkedAgreementId === agreementId);
  const linkCandidates = (siblings.data?.agreements ?? []).filter((x) => x.agreementId !== agreementId);
  const editState =
    edit ?? {
      code: a?.agreementCode ?? '',
      type: a?.agreementType ?? '',
      notes: a?.notes ?? '',
      link: a?.linkedAgreementId ?? '',
      linkLabel: a?.linkedAgreementId ?? '',
    };
  const linkOptions: SelectorOption[] = [
    { value: '', label: 'Not linked' },
    ...linkCandidates.map((x) => ({ value: x.agreementId, label: `${x.agreementId} — ${x.agreementType}` })),
  ];
  const history: TimelineEntry[] = (audit.data?.events ?? []).map((e) => ({
    at: e.at,
    label: auditActionOf(e.action),
    actor: e.actor,
  }));

  async function run<T>(fn: () => Promise<T>, successMessage: (result: T) => string): Promise<void> {
    try {
      const result = await fn();
      notify('success', successMessage(result));
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  const actions =
    a && canSubmit && a.status === 'Active' ? (
      <>
        <GovernedAction
          triggerLabel="Edit…"
          triggerTestId={`edit-agreement-${a.agreementId}`}
          triggerAppearance="secondary"
          title={`Edit ${a.agreementId}?`}
          description="Code, type, and notes change immediately and are recorded. Dates and value are material terms — they move only through renewal or termination approvals."
          extra={
            <div style={DIALOG_FIELDS}>
              <Field label="Agreement code">
                <Input
                  value={editState.code}
                  onChange={(ev) => setEdit({ ...editState, code: ev.target.value })}
                  data-testid={`edit-agreement-code-${a.agreementId}`}
                />
              </Field>
              <Field label="Agreement type" required>
                <Input value={editState.type} onChange={(ev) => setEdit({ ...editState, type: ev.target.value })} />
              </Field>
              <Field label="Notes">
                <Input value={editState.notes} onChange={(ev) => setEdit({ ...editState, notes: ev.target.value })} />
              </Field>
              <Field label="Linked to (parent agreement)">
                <Selector
                  data-testid={`edit-agreement-link-${a.agreementId}`}
                  placeholder="Not linked"
                  value={editState.link}
                  // editState.linkLabel seeds to the bare parent ID (not the
                  // "ID — type" option text), exactly as the Fluent trigger read.
                  display={editState.linkLabel === '' ? 'Not linked' : editState.linkLabel}
                  options={linkOptions}
                  onSelect={(value, label) => setEdit({ ...editState, link: value, linkLabel: value ? label : '' })}
                />
              </Field>
            </div>
          }
          confirmLabel="Save changes"
          confirmDisabled={editState.type.trim() === ''}
          onConfirm={() =>
            run(
              () =>
                api.updateAgreement(a.agreementId, {
                  expectedVersion: a.version,
                  agreementCode: editState.code.trim() === '' ? null : editState.code.trim(),
                  agreementType: editState.type.trim(),
                  notes: editState.notes.trim() === '' ? null : editState.notes.trim(),
                  linkedAgreementId: editState.link === '' ? null : editState.link,
                }),
              () => `${a.agreementId} updated and recorded.`,
            ).then(() => setEdit(null))
          }
        />
        <GovernedAction
          triggerLabel="Renew…"
          triggerTestId={`renew-agreement-${a.agreementId}`}
          triggerAppearance="secondary"
          title={`Request renewing ${a.agreementId}?`}
          description={`The current term ends ${a.endsOn}. Renewal goes through approval; the term is unchanged until an owner executes it.`}
          extra={
            <Field label="New end date" required>
              <DateInput value={renewEndsOn} onChange={(ev) => setRenewEndsOn(ev.target.value)} data-testid={`renew-ends-${a.agreementId}`} />
            </Field>
          }
          confirmLabel="Submit for approval"
          confirmDisabled={!/^\d{4}-\d{2}-\d{2}$/.test(renewEndsOn) || renewEndsOn <= a.endsOn}
          onConfirm={() =>
            run(
              () => api.submitRenewAgreement({ agreementId: a.agreementId, newEndsOn: renewEndsOn }),
              (res) => `Submitted ${res.approval.approvalId} for approval. The term is unchanged until an owner executes it.`,
            ).then(() => setRenewEndsOn(''))
          }
        />
        <GovernedAction
          triggerLabel="Terminate…"
          triggerTestId={`terminate-agreement-${a.agreementId}`}
          triggerAppearance="secondary"
          title={`Request terminating ${a.agreementId}?`}
          description="Termination is permanent and goes through approval with a mandatory, recorded reason. The agreement stays active until an owner executes it."
          extra={
            <Field label="Reason" required>
              <Input value={terminateReason} onChange={(ev) => setTerminateReason(ev.target.value)} data-testid={`terminate-reason-${a.agreementId}`} />
            </Field>
          }
          confirmLabel="Submit for approval"
          confirmDisabled={terminateReason.trim() === ''}
          onConfirm={() =>
            run(
              () => api.submitTerminateAgreement({ agreementId: a.agreementId, reason: terminateReason.trim() }),
              (res) => `Submitted ${res.approval.approvalId} for approval. The agreement stays active until an owner executes it.`,
            ).then(() => setTerminateReason(''))
          }
        />
      </>
    ) : undefined;

  const title = a ? (a.agreementCode ?? a.agreementId) : isLoading ? 'Loading…' : agreementId;

  const facts: DefItem[] = a
    ? [
        { label: 'Agreement ID', value: a.agreementId, mono: true, testId: 'agreement-id' },
        { label: 'Code', value: a.agreementCode ?? null },
        {
          label: 'Person',
          value: a.personId ? (
            <RecordLink to={`/people/${a.personId}`}>{a.personId}</RecordLink>
          ) : (
            <span data-testid="agreement-no-person">— (entity-level)</span>
          ),
        },
        {
          label: 'Entity',
          value: a.entityId ? (
            <span data-testid="agreement-entity">
              {(entities.data?.entities ?? []).find((e) => e.entityId === a.entityId)?.name ?? a.entityId}
            </span>
          ) : null,
        },
        { label: 'Type', value: a.agreementType },
        {
          label: 'Linked to',
          value: a.linkedAgreementId ? (
            <RecordLink to={`/agreements/${a.linkedAgreementId}`} data-testid="agreement-parent-link">
              {a.linkedAgreementId}
            </RecordLink>
          ) : null,
        },
        // NEGATIVE contract: raw ISO stays. agreements.spec pins '2027-07-31'
        // and '2028-07-31' byte-for-byte — formatDisplayDate must NOT be used.
        { label: 'Starts on', value: a.startsOn },
        { label: 'Ends on', value: <span data-testid="agreement-ends">{a.endsOn}</span> },
        // formatUsdCents is symbol-first with a null -> '—' branch; formatMinor
        // is code-first and has no null branch. Not interchangeable.
        ...(showValue ? [{ label: 'Value', value: <span data-testid="agreement-value">{formatUsdCents(a.valueUsdCents)}</span> }] : []),
        { label: 'Notes', value: a.notes ?? null },
        {
          label: 'Status',
          value: (
            <StatusBadge variant={badge!.variant} data-testid="agreement-status">
              {badge!.label}
            </StatusBadge>
          ),
        },
      ]
    : [];

  return (
    <RecordPage eyebrow="Agreement" title={title} documentTitle={title} titleTestId="agreement-title" actions={actions}>
      {isLoading && <LoadingState label="Loading agreement…" />}
      {a && (
        <>
          <FactList items={facts} />

          {showValue && <AgreementTermsSection agreementId={a.agreementId} canManage={canSubmit && a.status === 'Active'} />}

          <DocumentsSection ownerType="Agreement" ownerId={a.agreementId} canManage={canSubmit && a.status === 'Active'} />

          {addendums.length > 0 && (
            <section className="record-section">
              <h2>Linked agreements</h2>
              <ComparisonTable label="Linked agreements" testId="agreement-addendums">
                <thead>
                  <tr>
                    <th>Agreement</th>
                    <th>Type</th>
                    <th>Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {addendums.map((x) => (
                    <tr key={x.agreementId}>
                      <td>
                        <RecordLink to={`/agreements/${x.agreementId}`}>{x.agreementId}</RecordLink>
                      </td>
                      <td>{x.agreementType}</td>
                      <td>{x.endsOn}</td>
                    </tr>
                  ))}
                </tbody>
              </ComparisonTable>
            </section>
          )}

          <CommentThread subjectType="Agreement" subjectId={agreementId} />

          {canViewHistory && (
            <section className="record-section">
              <h2>History</h2>
              <AuditTimeline entries={history} testId="agreement-audit" />
            </section>
          )}
        </>
      )}
    </RecordPage>
  );
}

// ── Finance S3: the agreement's financial terms ──────────────────────────────

type TermForm = { amount: string; currency: CurrencyCode; percent: string; label: string };

/**
 * ⚠️ These seed values go into BARE inputs and are parsed straight back out on
 * submit. Any formatting (thousands grouping, a '%' suffix, a currency code)
 * makes them unparseable on the way back.
 */
function formFromTerm(t: AgreementTermDto): TermForm {
  return {
    amount: t.amountMinor != null ? String(t.amountMinor / MINOR_UNITS_PER_UNIT) : '',
    currency: (t.currency ?? 'USD') as CurrencyCode,
    percent: t.percentBps != null ? String(t.percentBps / 100) : '',
    label: t.label ?? '',
  };
}

function percentValid(input: string): boolean {
  return positivePercentToBps(input) !== null;
}
function formInvalid(kind: AgreementTermKind, f: TermForm): boolean {
  if (isMonetaryTermKind(kind)) {
    return positiveAmountToMinor(f.amount) == null || (termLabelRequired(kind) && f.label.trim() === '');
  }
  return !percentValid(f.percent);
}

/**
 * The financial-terms surface — rendered only for canViewFinancials roles (the
 * parent gates on showValue; the API gates the endpoint too). Owner/operations
 * on an ACTIVE agreement may add / edit / remove terms (direct-audited).
 */
function AgreementTermsSection({ agreementId, canManage }: { agreementId: string; canManage: boolean }) {
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading } = useAgreementTerms(agreementId);
  const terms = data?.terms ?? [];

  const [addKind, setAddKind] = useState<AgreementTermKind>('Salary');
  const [add, setAdd] = useState<TermForm>({ amount: '', currency: 'USD', percent: '', label: '' });
  const [edits, setEdits] = useState<Record<string, TermForm>>({});

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['agreementTerms', agreementId] });
    void qc.invalidateQueries({ queryKey: ['agreementAudit', agreementId] });
    void qc.invalidateQueries({ queryKey: ['approvals'] });
  };

  async function run<T>(fn: () => Promise<T>, message: (result: T) => string): Promise<void> {
    try {
      const result = await fn();
      notify('success', message(result));
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  function valueFields(kind: AgreementTermKind, form: TermForm, setForm: (f: TermForm) => void, idPrefix: string) {
    const monetary = isMonetaryTermKind(kind);
    return (
      <div style={DIALOG_FIELDS}>
        {/* Amount+currency and percent are MUTUALLY EXCLUSIVE render branches.
            Sending both is a 400 — never merge them into one always-rendered
            block gated only by disabled/hidden. */}
        {monetary ? (
          <>
            <Field label="Amount" required>
              <Input type="number" value={form.amount} onChange={(ev) => setForm({ ...form, amount: ev.target.value })} data-testid={`${idPrefix}-amount`} />
            </Field>
            <Field label="Currency" required>
              <Selector
                data-testid={`${idPrefix}-currency`}
                value={form.currency}
                options={CURRENCY_OPTIONS}
                onSelect={(value) => setForm({ ...form, currency: (value || 'USD') as CurrencyCode })}
              />
            </Field>
          </>
        ) : (
          <Field label="Share of prize (%)" required>
            <Input type="number" value={form.percent} onChange={(ev) => setForm({ ...form, percent: ev.target.value })} data-testid={`${idPrefix}-percent`} />
          </Field>
        )}
        <Field label={termLabelRequired(kind) ? 'Trigger' : monetary ? 'Condition / note (optional)' : 'Label (optional)'} required={termLabelRequired(kind)}>
          <Input value={form.label} onChange={(ev) => setForm({ ...form, label: ev.target.value })} data-testid={`${idPrefix}-label`} />
        </Field>
      </div>
    );
  }

  /**
   * ⚠️ The `!` assertions are safe ONLY because every call site passes
   * `confirmDisabled={formInvalid(kind, form)}` — that is what proves the
   * parser returned a value. Re-wiring or dropping that disabled prop sends
   * `amountMinor: null` on a governed approval.
   */
  function bodyFrom(kind: AgreementTermKind, f: TermForm) {
    return isMonetaryTermKind(kind)
      ? { amountMinor: positiveAmountToMinor(f.amount)!, currency: f.currency, label: f.label.trim() || null }
      : { percentBps: positivePercentToBps(f.percent)!, label: f.label.trim() || null };
  }

  return (
    <section className="record-section" data-testid="agreement-terms-panel">
      <div className="record-section-head">
        <h2>Financial terms</h2>
        {canManage && (
          <GovernedAction
            triggerLabel="Add term…"
            triggerTestId="add-term"
            triggerAppearance="secondary"
            title="Request adding a financial term"
            description="Term money is material, so it goes through approval — nothing is added until an owner executes it. Salary is monthly; bonuses and milestones are one-off amounts; prize shares are a percentage."
            extra={
              <div style={DIALOG_FIELDS}>
                <Field label="Term type" required>
                  <Selector
                    data-testid="add-term-kind"
                    value={addKind}
                    options={TERM_KIND_OPTIONS}
                    onSelect={(value) => setAddKind((value || 'Salary') as AgreementTermKind)}
                  />
                </Field>
                {valueFields(addKind, add, setAdd, 'add-term')}
              </div>
            }
            confirmLabel="Submit for approval"
            confirmDisabled={formInvalid(addKind, add)}
            onConfirm={() =>
              run(
                () => api.submitAddAgreementTerm({ agreementId, kind: addKind, ...bodyFrom(addKind, add) }),
                (r) => `Submitted ${r.approval.approvalId} for approval — the term is added once an owner executes it.`,
              ).then(() => setAdd({ amount: '', currency: 'USD', percent: '', label: '' }))
            }
          />
        )}
      </div>

      {isLoading && <LoadingState label="Loading terms…" />}
      {!isLoading && terms.length === 0 && <EmptyState data-testid="agreement-terms-empty" message="No financial terms recorded yet." />}
      {terms.length > 0 && (
        <ComparisonTable label="Financial terms" testId="agreement-terms">
          <thead>
            <tr>
              <th>Type</th>
              <th>Amount</th>
              <th>Detail</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => {
              const ef = edits[t.termId] ?? formFromTerm(t);
              const setEf = (f: TermForm) => setEdits({ ...edits, [t.termId]: f });
              return (
                <tr key={t.termId}>
                  <td data-testid={`term-kind-${t.termId}`}>{agreementTermKindOf(t.kind)}</td>
                  {/* formatTermValue -> formatMoney (code-first, U+00A0) or
                      formatPercentBps. agreements.spec pins "AED 5,000.00" and
                      "7.5%" — no whitespace normalizing, no reordering. */}
                  <td data-testid={`term-value-${t.termId}`}>{formatTermValue(t)}</td>
                  <td>{t.label ?? '—'}</td>
                  {canManage && (
                    <td>
                      <div style={ROW_ACTIONS}>
                        <GovernedAction
                          triggerLabel="Edit…"
                          triggerTestId={`edit-term-${t.termId}`}
                          triggerAppearance="secondary"
                          title={`Request changing this ${agreementTermKindOf(t.kind).toLowerCase()} term`}
                          description="This is a change to material money — it goes through approval and is unchanged until an owner executes it."
                          extra={valueFields(t.kind, ef, setEf, `edit-term-${t.termId}`)}
                          confirmLabel="Submit for approval"
                          confirmDisabled={formInvalid(t.kind, ef)}
                          onConfirm={() =>
                            run(
                              () => api.submitUpdateAgreementTerm({ agreementId, termId: t.termId, ...bodyFrom(t.kind, ef) }),
                              (r) => `Submitted ${r.approval.approvalId} for approval — the change applies once an owner executes it.`,
                            ).then(() =>
                              // NO-TOUCH: the delete-on-success spread.
                              setEdits((prev) => {
                                const { [t.termId]: _drop, ...rest } = prev;
                                return rest;
                              }),
                            )
                          }
                        />
                        <GovernedAction
                          triggerLabel="Remove…"
                          triggerTestId={`remove-term-${t.termId}`}
                          triggerAppearance="secondary"
                          title="Request removing this financial term?"
                          description="Removing material money goes through approval — the term stays on the agreement until an owner executes it."
                          confirmLabel="Submit for approval"
                          onConfirm={() =>
                            run(
                              () => api.submitRemoveAgreementTerm({ agreementId, termId: t.termId }),
                              (r) => `Submitted ${r.approval.approvalId} for approval — the term is removed once an owner executes it.`,
                            )
                          }
                        />
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </ComparisonTable>
      )}
    </section>
  );
}
