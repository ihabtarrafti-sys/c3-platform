import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { makeStyles } from '@fluentui/react-components';
import type { BeneficiaryDto, CredentialDto } from '@c3web/api-contracts';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { usePersonBeneficiaries } from '../queries';
import { Field, Input, GovernedAction, StatusBadge } from '../tablework';
import { useRegisterStyles } from './registerStyles';

/**
 * S12 person-page surfaces:
 *
 *  - BeneficiarySection (finance-gated reads; GOVERNED writes): the payment-
 *    ROUTING registry. THE STANDING LAW: no account numbers, no IBANs — the
 *    API refuses digit runs, and the bank form downloads with those columns
 *    intentionally blank for completion outside C3.
 *  - CredentialFactsAction: per-credential governed facts change (dates,
 *    document number, country, kind) — compliance facts ride the pipeline;
 *    issuer/notes move fast through the direct PATCH.
 */

const useStyles = makeStyles({
  section: { marginTop: '24px' },
  h2: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-muted)',
    marginBottom: '8px',
  },
  row: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '10px' },
  two: { display: 'flex', gap: '10px', '> *': { flexGrow: 1 } },
  law: { fontSize: '12px', color: 'var(--c3-ink-quiet)', marginTop: '6px' },
});

function useSubmitToast() {
  const { notify } = useNotify();
  const qc = useQueryClient();
  return async function run<T extends { approval: { approvalId: string } }>(fn: () => Promise<T>, what: string, personId: string) {
    try {
      const r = await fn();
      notify('success', `Submitted ${r.approval.approvalId} — ${what}. Nothing changes until an owner executes it.`);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['personApprovals', personId] });
      void qc.invalidateQueries({ queryKey: ['personBeneficiaries', personId] });
      void qc.invalidateQueries({ queryKey: ['personCredentials', personId] });
    } catch (err) {
      const notifyErr = err instanceof ApiError ? err.message : 'Submission failed.';
      notify('error', notifyErr);
      throw err instanceof Error ? err : new Error('failed');
    }
  };
}

export function CredentialFactsAction({ credential, personId }: { credential: CredentialDto; personId: string }) {
  const { me } = useSession();
  const s = useStyles();
  const run = useSubmitToast();
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const [f, setF] = useState({ kind: '', documentNumber: '', issuingCountry: '', issuedOn: '', expiresOn: '' });
  if (!canSubmit || !credential.isActive) return null;

  const patch = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    if (f.kind.trim()) p.kind = f.kind.trim();
    if (f.documentNumber.trim()) p.documentNumber = f.documentNumber.trim();
    if (f.issuingCountry.trim()) p.issuingCountry = f.issuingCountry.trim();
    if (f.issuedOn) p.issuedOn = f.issuedOn;
    if (f.expiresOn) p.expiresOn = f.expiresOn;
    return p;
  };

  return (
    <GovernedAction
      triggerLabel="Facts…"
      triggerTestId={`cred-facts-${credential.credentialId}`}
      triggerAppearance="secondary"
      title={`Request a facts change for ${credential.credentialId}?`}
      description="Dates, document number, issuing country and kind are compliance facts — the change goes to an approver. Fill only what changes."
      extra={
        <div className="form-sheet-fields">
          <div className={s.two}>
            <Field label="Kind (Passport / NationalID / Visa / License / Other)">
              <Input value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} data-testid="cred-facts-kind" />
            </Field>
            <Field label="Issuing country">
              <Input value={f.issuingCountry} onChange={(e) => setF({ ...f, issuingCountry: e.target.value })} data-testid="cred-facts-country" />
            </Field>
          </div>
          <Field label="Document number (PII — owner/ops/hr only)">
            <Input value={f.documentNumber} onChange={(e) => setF({ ...f, documentNumber: e.target.value })} data-testid="cred-facts-number" />
          </Field>
          <div className={s.two}>
            <Field label="Issued on">
              <Input type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} data-testid="cred-facts-issued" />
            </Field>
            <Field label="Expires on">
              <Input type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} data-testid="cred-facts-expires" />
            </Field>
          </div>
        </div>
      }
      confirmLabel="Submit for approval"
      confirmDisabled={Object.keys(patch()).length === 0}
      onConfirm={() =>
        run(() => api.submitCredentialFacts(credential.credentialId, { patch: patch() }), `facts change for ${credential.credentialId}`, personId).then(() =>
          setF({ kind: '', documentNumber: '', issuingCountry: '', issuedOn: '', expiresOn: '' }),
        )
      }
    />
  );
}

export function BeneficiarySection({ personId }: { personId: string }) {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const run = useSubmitToast();
  const canView = me?.capabilities.canViewFinancials ?? false;
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const { data } = usePersonBeneficiaries(personId, canView);
  const [b, setB] = useState({ label: '', bankName: '', bankCountry: '', currency: '', paymentType: '', entityId: '' });
  const [retireFor, setRetireFor] = useState<BeneficiaryDto | null>(null);
  const [retireReason, setRetireReason] = useState('');

  if (!canView) return null;
  const rows = data?.beneficiaries ?? [];

  async function downloadForm() {
    try {
      const { blob, fileName } = await api.downloadBankForm(personId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Download failed.');
    }
  }

  const valid = b.label.trim() !== '' && b.bankName.trim() !== '' && b.bankCountry.trim() !== '' && /^[A-Za-z]{3}$/.test(b.currency.trim());

  return (
    <div className={s.section} data-testid="beneficiary-section">
      <h2 className={s.h2}>Beneficiaries (payment routing)</h2>
      <p className={s.law}>
        Labels, banks and currencies only — account numbers and IBANs never enter C3. The bank form downloads with
        those columns blank, to be completed by hand.
      </p>
      {rows.length > 0 && (
        <table className={r.table} data-testid="beneficiary-table" aria-label="Beneficiaries">
          <thead>
            <tr>
              <th className={r.th}>ID</th>
              <th className={r.th}>Label</th>
              <th className={r.th}>Bank</th>
              <th className={r.th}>Currency</th>
              <th className={r.th}>Status</th>
              <th className={r.th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.beneficiaryId} className={r.row} data-testid={`beneficiary-row-${x.beneficiaryId}`}>
                <td className={r.td}>{x.beneficiaryId}</td>
                <td className={`${r.td} ${r.name}`}>{x.label}</td>
                <td className={r.td}>{`${x.bankName} (${x.bankCountry})`}</td>
                <td className={r.td}>{x.currency}</td>
                <td className={r.td}>
                  <StatusBadge variant={x.status === 'Registered' ? 'ready' : x.status === 'Retired' ? 'neutral' : 'pending'}>
                    {x.status}
                  </StatusBadge>
                </td>
                <td className={r.td}>
                  {canSubmit && x.status !== 'Retired' && (
                    retireFor?.beneficiaryId === x.beneficiaryId ? (
                      <span style={{ display: 'inline-flex', gap: 8 }}>
                        <Input
                          placeholder="Reason (mandatory)"
                          value={retireReason}
                          onChange={(e) => setRetireReason(e.target.value)}
                          data-testid="beneficiary-retire-reason"
                        />
                        <button
                          className="primary-action"
                          type="button"
                          disabled={retireReason.trim() === ''}
                          data-testid="beneficiary-retire-confirm"
                          onClick={() =>
                            void run(
                              () => api.submitRetireBeneficiary(x.beneficiaryId, retireReason.trim()),
                              `retirement of ${x.beneficiaryId}`,
                              personId,
                            ).then(() => {
                              setRetireFor(null);
                              setRetireReason('');
                            })
                          }
                        >
                          Submit
                        </button>
                        <button className="secondary-action" type="button" onClick={() => setRetireFor(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button className="mini-action" type="button" onClick={() => setRetireFor(x)} data-testid={`beneficiary-retire-${x.beneficiaryId}`}>
                        Retire…
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={s.row}>
        {canSubmit && (
          <GovernedAction
            triggerLabel="Request beneficiary…"
            triggerTestId="beneficiary-add"
            triggerAppearance="secondary"
            title="Request a new beneficiary?"
            description="Payment-routing facts get dual control — this goes to an approver. Account numbers and IBANs are refused by law; use the org's label for the route."
            extra={
              <div className="form-sheet-fields">
                <div className={s.two}>
                  <Field label="Label" required>
                    <Input value={b.label} onChange={(e) => setB({ ...b, label: e.target.value })} data-testid="beneficiary-label" />
                  </Field>
                  <Field label="Currency (ISO)" required>
                    <Input value={b.currency} onChange={(e) => setB({ ...b, currency: e.target.value })} data-testid="beneficiary-currency" />
                  </Field>
                </div>
                <div className={s.two}>
                  <Field label="Bank name" required>
                    <Input value={b.bankName} onChange={(e) => setB({ ...b, bankName: e.target.value })} data-testid="beneficiary-bank" />
                  </Field>
                  <Field label="Bank country" required>
                    <Input value={b.bankCountry} onChange={(e) => setB({ ...b, bankCountry: e.target.value })} data-testid="beneficiary-country" />
                  </Field>
                </div>
                <div className={s.two}>
                  <Field label="Payment type">
                    <Input value={b.paymentType} onChange={(e) => setB({ ...b, paymentType: e.target.value })} />
                  </Field>
                  <Field label="Registered with (ENT-XXXX)">
                    <Input value={b.entityId} onChange={(e) => setB({ ...b, entityId: e.target.value })} />
                  </Field>
                </div>
              </div>
            }
            confirmLabel="Submit for approval"
            confirmDisabled={!valid}
            onConfirm={() =>
              run(
                () =>
                  api.submitAddBeneficiary({
                    personId,
                    label: b.label.trim(),
                    bankName: b.bankName.trim(),
                    bankCountry: b.bankCountry.trim(),
                    currency: b.currency.trim().toUpperCase(),
                    paymentType: b.paymentType.trim() || undefined,
                    registeredWithEntityId: b.entityId.trim() || undefined,
                  }),
                `beneficiary "${b.label.trim()}"`,
                personId,
              ).then(() => setB({ label: '', bankName: '', bankCountry: '', currency: '', paymentType: '', entityId: '' }))
            }
          />
        )}
        {rows.some((x) => x.status !== 'Retired') && (
          <button className="secondary-action" type="button" onClick={() => void downloadForm()} data-testid="beneficiary-bank-form">
            Bank form (xlsx)
          </button>
        )}
      </div>
    </div>
  );
}
