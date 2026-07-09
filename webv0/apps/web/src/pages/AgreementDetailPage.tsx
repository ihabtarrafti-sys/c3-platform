import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Dropdown, Field, Input, Option, makeStyles } from '@fluentui/react-components';
import {
  agreementRenewalStateOn,
  AGREEMENT_TERM_KINDS,
  CURRENCY_CODES,
  MINOR_UNITS_PER_UNIT,
  isMonetaryTermKind,
  termLabelRequired,
  percentToBps,
  type AgreementTermKind,
  type CurrencyCode,
} from '@c3web/domain';
import { useAgreement, useAgreementAudit, useAgreements, useAgreementTerms } from '../queries';
import { ApiError, type AgreementTermDto } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { DefinitionList } from '../components/DefinitionList';
import { StatusBadge } from '../components/StatusBadge';
import { AuditTimeline, type TimelineEntry } from '../components/AuditTimeline';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { agreementRenewalStateOf, agreementTermKindOf, auditActionOf, formatTermValue, formatUsdCents } from '../labels';

/**
 * AgreementDetailPage (Sprint 41) — one agreement, honestly split: the
 * MATERIAL lifecycle (renew / terminate) is governed and says so; the
 * NON-MATERIAL edit (code / type / notes) is immediate and recorded. Linked
 * addendums appear as first-class relationships, both directions.
 */

function localTodayIso(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const useStyles = makeStyles({
  section: { marginTop: '32px' },
  h2: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, color: 'var(--c3-command-black)', margin: '0 0 12px' },
  h2Row: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', columnGap: '12px', flexWrap: 'wrap' },
  headerActions: { display: 'flex', columnGap: '8px', flexWrap: 'wrap' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '8px' },
});

export function AgreementDetailPage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { agreementId = '' } = useParams();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canRead = me?.capabilities.canReadAgreements ?? false;
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const showValue = me?.capabilities.canViewFinancials ?? false;
  const canViewHistory = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const { data, isLoading, isError, error } = useAgreement(agreementId, canRead);
  const siblings = useAgreements(canRead);
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
      <div>
        <PageHeader title="Agreement" />
        <EmptyState data-testid="agreements-denied" message="Agreements are unavailable for your role." />
      </div>
    );
  }

  if (isError) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <div>
        <PageHeader title="Agreement" breadcrumbs={<Breadcrumbs crumbs={[{ label: 'Agreements', to: '/agreements' }, { label: agreementId }]} />} />
        <ErrorState
          data-testid="agreement-error"
          message={is404 ? `No agreement ${agreementId} in your organization.` : 'Could not load this agreement.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      </div>
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
      <div className={s.headerActions}>
        <GovernedAction
          triggerLabel="Edit…"
          triggerTestId={`edit-agreement-${a.agreementId}`}
          triggerAppearance="secondary"
          title={`Edit ${a.agreementId}?`}
          description="Code, type, and notes change immediately and are recorded. Dates and value are material terms — they move only through renewal or termination approvals."
          extra={
            <div className={s.fields}>
              <Field label="Agreement code">
                <Input value={editState.code} onChange={(_, d) => setEdit({ ...editState, code: d.value })} data-testid={`edit-agreement-code-${a.agreementId}`} />
              </Field>
              <Field label="Agreement type" required>
                <Input value={editState.type} onChange={(_, d) => setEdit({ ...editState, type: d.value })} />
              </Field>
              <Field label="Notes">
                <Input value={editState.notes} onChange={(_, d) => setEdit({ ...editState, notes: d.value })} />
              </Field>
              <Field label="Linked to (parent agreement)">
                <Dropdown
                  placeholder="Not linked"
                  value={editState.linkLabel}
                  selectedOptions={editState.link ? [editState.link] : []}
                  onOptionSelect={(_, d) =>
                    setEdit({ ...editState, link: d.optionValue ?? '', linkLabel: d.optionValue ? (d.optionText ?? '') : '' })
                  }
                  data-testid={`edit-agreement-link-${a.agreementId}`}
                >
                  <Option value="" text="Not linked">
                    Not linked
                  </Option>
                  {linkCandidates.map((x) => (
                    <Option key={x.agreementId} value={x.agreementId} text={`${x.agreementId} — ${x.agreementType}`}>
                      {`${x.agreementId} — ${x.agreementType}`}
                    </Option>
                  ))}
                </Dropdown>
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
              <Input type="date" value={renewEndsOn} onChange={(_, d) => setRenewEndsOn(d.value)} data-testid={`renew-ends-${a.agreementId}`} />
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
              <Input value={terminateReason} onChange={(_, d) => setTerminateReason(d.value)} data-testid={`terminate-reason-${a.agreementId}`} />
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
      </div>
    ) : undefined;

  const title = a ? (a.agreementCode ?? a.agreementId) : isLoading ? 'Loading…' : agreementId;

  return (
    <div>
      <PageHeader
        title={title}
        titleTestId="agreement-title"
        breadcrumbs={<Breadcrumbs crumbs={[{ label: 'Agreements', to: '/agreements' }, { label: title }]} />}
        actions={actions}
      />
      {isLoading && <LoadingState label="Loading agreement…" />}
      {a && (
        <>
          <DefinitionList
            items={[
              { label: 'Agreement ID', value: a.agreementId, mono: true, testId: 'agreement-id' },
              { label: 'Code', value: a.agreementCode ?? null },
              {
                label: 'Person',
                value: (
                  <Link className={r.idLink} to={`/people/${a.personId}`}>
                    {a.personId}
                  </Link>
                ),
              },
              { label: 'Type', value: a.agreementType },
              {
                label: 'Linked to',
                value: a.linkedAgreementId ? (
                  <Link className={r.idLink} to={`/agreements/${a.linkedAgreementId}`} data-testid="agreement-parent-link">
                    {a.linkedAgreementId}
                  </Link>
                ) : null,
              },
              { label: 'Starts on', value: a.startsOn },
              { label: 'Ends on', value: <span data-testid="agreement-ends">{a.endsOn}</span> },
              ...(showValue
                ? [{ label: 'Value', value: <span data-testid="agreement-value">{formatUsdCents(a.valueUsdCents)}</span> }]
                : []),
              { label: 'Notes', value: a.notes ?? null },
              {
                label: 'Status',
                value: (
                  <StatusBadge variant={badge!.variant} data-testid="agreement-status">
                    {badge!.label}
                  </StatusBadge>
                ),
              },
            ]}
          />

          {showValue && (
            <AgreementTermsSection agreementId={a.agreementId} canManage={canSubmit && a.status === 'Active'} />
          )}

          {addendums.length > 0 && (
            <div className={s.section}>
              <h2 className={s.h2}>Linked agreements</h2>
              <table className={r.table} data-testid="agreement-addendums" aria-label="Linked agreements">
                <thead>
                  <tr>
                    <th className={r.th}>Agreement</th>
                    <th className={r.th}>Type</th>
                    <th className={r.th}>Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {addendums.map((x) => (
                    <tr key={x.agreementId} className={r.row}>
                      <td className={r.td}>
                        <Link className={r.idLink} to={`/agreements/${x.agreementId}`}>
                          {x.agreementId}
                        </Link>
                      </td>
                      <td className={`${r.td} ${r.name}`}>{x.agreementType}</td>
                      <td className={r.td}>{x.endsOn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canViewHistory && (
            <div className={s.section}>
              <h2 className={s.h2}>History</h2>
              <AuditTimeline entries={history} testId="agreement-audit" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Finance S3: the agreement's financial terms ──────────────────────────────

type TermForm = { amount: string; currency: CurrencyCode; percent: string; label: string };

function formFromTerm(t: AgreementTermDto): TermForm {
  return {
    amount: t.amountMinor != null ? String(t.amountMinor / MINOR_UNITS_PER_UNIT) : '',
    currency: (t.currency ?? 'USD') as CurrencyCode,
    percent: t.percentBps != null ? String(t.percentBps / 100) : '',
    label: t.label ?? '',
  };
}

/** Major-units string → integer minor units; null when not a positive number. */
function amountToMinor(input: string): number | null {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * MINOR_UNITS_PER_UNIT);
}
function percentValid(input: string): boolean {
  const n = Number.parseFloat(input);
  return Number.isFinite(n) && n > 0 && n <= 100;
}
function formInvalid(kind: AgreementTermKind, f: TermForm): boolean {
  if (isMonetaryTermKind(kind)) {
    return amountToMinor(f.amount) == null || (termLabelRequired(kind) && f.label.trim() === '');
  }
  return !percentValid(f.percent);
}

/**
 * The financial-terms surface — rendered only for canViewFinancials roles (the
 * parent gates on showValue; the API gates the endpoint too). Owner/operations
 * on an ACTIVE agreement may add / edit / remove terms (direct-audited).
 */
function AgreementTermsSection({ agreementId, canManage }: { agreementId: string; canManage: boolean }) {
  const s = useStyles();
  const r = useRegisterStyles();
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
  };

  async function run(fn: () => Promise<unknown>, message: string): Promise<void> {
    try {
      await fn();
      notify('success', message);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  function valueFields(kind: AgreementTermKind, form: TermForm, setForm: (f: TermForm) => void, idPrefix: string) {
    const monetary = isMonetaryTermKind(kind);
    return (
      <div className={s.fields}>
        {monetary ? (
          <>
            <Field label="Amount" required>
              <Input type="number" value={form.amount} onChange={(_, d) => setForm({ ...form, amount: d.value })} data-testid={`${idPrefix}-amount`} />
            </Field>
            <Field label="Currency" required>
              <Dropdown
                value={form.currency}
                selectedOptions={[form.currency]}
                onOptionSelect={(_, d) => setForm({ ...form, currency: (d.optionValue ?? 'USD') as CurrencyCode })}
                data-testid={`${idPrefix}-currency`}
              >
                {CURRENCY_CODES.map((c) => (
                  <Option key={c} value={c} text={c}>
                    {c}
                  </Option>
                ))}
              </Dropdown>
            </Field>
          </>
        ) : (
          <Field label="Share of prize (%)" required>
            <Input type="number" value={form.percent} onChange={(_, d) => setForm({ ...form, percent: d.value })} data-testid={`${idPrefix}-percent`} />
          </Field>
        )}
        <Field label={termLabelRequired(kind) ? 'Trigger' : monetary ? 'Condition / note (optional)' : 'Label (optional)'} required={termLabelRequired(kind)}>
          <Input value={form.label} onChange={(_, d) => setForm({ ...form, label: d.value })} data-testid={`${idPrefix}-label`} />
        </Field>
      </div>
    );
  }

  function bodyFrom(kind: AgreementTermKind, f: TermForm) {
    return isMonetaryTermKind(kind)
      ? { amountMinor: amountToMinor(f.amount)!, currency: f.currency, label: f.label.trim() || null }
      : { percentBps: percentToBps(Number.parseFloat(f.percent)), label: f.label.trim() || null };
  }

  return (
    <div className={s.section} data-testid="agreement-terms-panel">
      <div className={s.h2Row}>
        <h2 className={s.h2}>Financial terms</h2>
        {canManage && (
          <GovernedAction
            triggerLabel="Add term…"
            triggerTestId="add-term"
            triggerAppearance="secondary"
            title="Add a financial term"
            description="Financial terms are recorded immediately and audited. Salary is monthly; bonuses and milestones are one-off amounts; prize shares are a percentage."
            extra={
              <div className={s.fields}>
                <Field label="Term type" required>
                  <Dropdown
                    value={agreementTermKindOf(addKind)}
                    selectedOptions={[addKind]}
                    onOptionSelect={(_, d) => setAddKind((d.optionValue ?? 'Salary') as AgreementTermKind)}
                    data-testid="add-term-kind"
                  >
                    {AGREEMENT_TERM_KINDS.map((k) => (
                      <Option key={k} value={k} text={agreementTermKindOf(k)}>
                        {agreementTermKindOf(k)}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                {valueFields(addKind, add, setAdd, 'add-term')}
              </div>
            }
            confirmLabel="Add term"
            confirmDisabled={formInvalid(addKind, add)}
            onConfirm={() =>
              run(() => api.addAgreementTerm(agreementId, { kind: addKind, ...bodyFrom(addKind, add) }), 'Term added and recorded.').then(() =>
                setAdd({ amount: '', currency: 'USD', percent: '', label: '' }),
              )
            }
          />
        )}
      </div>

      {isLoading && <LoadingState label="Loading terms…" />}
      {!isLoading && terms.length === 0 && (
        <EmptyState data-testid="agreement-terms-empty" message="No financial terms recorded yet." />
      )}
      {terms.length > 0 && (
        <table className={r.table} data-testid="agreement-terms" aria-label="Financial terms">
          <thead>
            <tr>
              <th className={r.th}>Type</th>
              <th className={r.th}>Amount</th>
              <th className={r.th}>Detail</th>
              {canManage && <th className={r.th} aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => {
              const ef = edits[t.termId] ?? formFromTerm(t);
              const setEf = (f: TermForm) => setEdits({ ...edits, [t.termId]: f });
              return (
                <tr key={t.termId} className={r.row}>
                  <td className={`${r.td} ${r.name}`} data-testid={`term-kind-${t.termId}`}>
                    {agreementTermKindOf(t.kind)}
                  </td>
                  <td className={r.td} data-testid={`term-value-${t.termId}`}>
                    {formatTermValue(t)}
                  </td>
                  <td className={r.td}>{t.label ?? '—'}</td>
                  {canManage && (
                    <td className={r.td}>
                      <div className={s.headerActions}>
                        <GovernedAction
                          triggerLabel="Edit…"
                          triggerTestId={`edit-term-${t.termId}`}
                          triggerAppearance="secondary"
                          title={`Edit this ${agreementTermKindOf(t.kind).toLowerCase()} term`}
                          description="The change is recorded immediately and audited."
                          extra={valueFields(t.kind, ef, setEf, `edit-term-${t.termId}`)}
                          confirmLabel="Save term"
                          confirmDisabled={formInvalid(t.kind, ef)}
                          onConfirm={() =>
                            run(
                              () => api.updateAgreementTerm(agreementId, t.termId, { expectedVersion: t.version, ...bodyFrom(t.kind, ef) }),
                              'Term updated and recorded.',
                            ).then(() =>
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
                          title="Remove this financial term?"
                          description="The term is removed from the agreement immediately. The removal is recorded and auditable."
                          confirmLabel="Remove term"
                          onConfirm={() => run(() => api.removeAgreementTerm(agreementId, t.termId, t.version), 'Term removed and recorded.')}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
