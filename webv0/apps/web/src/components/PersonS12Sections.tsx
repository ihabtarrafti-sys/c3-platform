import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BeneficiaryDto, CredentialDto } from '@c3web/api-contracts';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { usePersonBeneficiaries } from '../queries';
import { Field, Input, GovernedAction, StatusBadge, ComparisonTable } from '../tablework';

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

/**
 * Tablework conversion (Wave 4, Lane A) — both Fluent sheets are gone: this
 * file's local `makeStyles` AND `./registerStyles`, whose ONLY importer this
 * was (the file is deleted with this commit). The mapping, kit class by kit
 * class, with nothing re-stated that the kit already owns:
 *
 *   LOCAL SHEET
 *     section → `.record-section`
 *     h2      → a PLAIN `<h2>` inside it, styled by `.record-section h2`.
 *               ⚠️ NOT `SectionHeading`: `.tw-root .record-section h2` (0,2,1)
 *               outranks `.tw-root .section-heading` (0,2,0), so nesting one
 *               here yields a 20px heading wearing the eyebrow's uppercase and
 *               letter-spacing — a mixture neither class intends.
 *     row     → `.row-actions` (the kit's flex-START trigger cluster)
 *     law     → `.record-quiet.record-note` — the quiet SENTENCE that stands
 *               BETWEEN blocks, which is exactly where this standing-law line sits
 *     fields  → DEAD in the Fluent original — never referenced. Deleted, not ported.
 *     two     → `.field-pair` (K2, marker chapter — closed).
 *
 *   registerStyles (`useRegisterStyles`)
 *     table / th / td / row → `ComparisonTable`, i.e. `.comparison-scroll` +
 *               `.data-grid` (+ its `th`, `td`, `tbody tr:hover` rules). The
 *               register's own panel chrome — surface fill, 1px border, radius,
 *               `--c3-e1` shadow, 14px tabular-nums — is NOT carried: in the kit
 *               a data grid is bare and the SURFACE around it carries the panel.
 *     mono / idLink / nameLink / count → had NO call site in the surviving
 *               consumer (this file). Deleted rather than ported; their kit
 *               answers, had they been live, are `.data-grid td.mono`,
 *               `RecordLink`, — (no kit answer for a sans name link) and
 *               `.collection-count`.
 *     name    → dropped. `color: --c3-ink-strong` on the Label cell has NO kit
 *               class: every converted register in the app renders its name
 *               column as a plain `<td>` at `--c3-ink-default`, so a per-cell
 *               emphasis here would be the only one of its kind.
 */

// K2 CLOSED (marker chapter): the two-up rows ride the kit's `.field-pair` —
// 2 equal tracks at the kit's 12px gap, byte-identical to the carried inline
// grid; the ≤30rem single-column collapse is the marker's own CLASS
// prescription, new at narrow widths only.

// K1 CLOSED (marker chapter): the retire editor rides the kit's
// `width="editor"` stop — EXACT 12rem, the Selector floor, byte-identical to
// the carried inline width. (The measured defect this replaced: at width:100%
// the input claimed 446px of the flex row and wrapped Submit/Cancel to a
// second line, inflating the cell to 470px.)

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
          <div className="field-pair">
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
          <div className="field-pair">
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
    <div className="record-section" data-testid="beneficiary-section">
      <h2>Beneficiaries (payment routing)</h2>
      <p className="record-quiet record-note">
        Labels, banks and currencies only — account numbers and IBANs never enter C3. The bank form downloads with
        those columns blank, to be completed by hand.
      </p>
      {rows.length > 0 && (
        // ⚠️ TESTID PLACEMENT MOVES: `ComparisonTable` puts `testId` on the outer
        // `.comparison-scroll` div, not on the <table> that carried it before.
        // Checked against the whole suite: `beneficiary-table` has ZERO
        // references in e2e/, and the suite's only structural descents are
        // `people-table` and `participants-table` — neither is here.
        <ComparisonTable label="Beneficiaries" testId="beneficiary-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Label</th>
              <th>Bank</th>
              <th>Currency</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.beneficiaryId} data-testid={`beneficiary-row-${x.beneficiaryId}`}>
                {/* Plain cells, deliberately: the beneficiary id was never mono
                    and never a link in the Fluent original (`r.td` alone), and
                    the Label's `--c3-ink-strong` has no kit class — every
                    converted register renders its name column plain. */}
                <td>{x.beneficiaryId}</td>
                <td>{x.label}</td>
                <td>{`${x.bankName} (${x.bankCountry})`}</td>
                <td>{x.currency}</td>
                <td>
                  <StatusBadge variant={x.status === 'Registered' ? 'ready' : x.status === 'Retired' ? 'neutral' : 'pending'}>
                    {x.status}
                  </StatusBadge>
                </td>
                <td>
                  {canSubmit && x.status !== 'Retired' && (
                    retireFor?.beneficiaryId === x.beneficiaryId ? (
                      // `.row-actions` — the kit's flex-START trigger cluster for
                      // controls INSIDE a table cell; its 8px gap is the original's.
                      <span className="row-actions">
                        <Input
                          placeholder="Reason (mandatory)"
                          value={retireReason}
                          onChange={(e) => setRetireReason(e.target.value)}
                          data-testid="beneficiary-retire-reason"
                          width="editor"
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
        </ComparisonTable>
      )}
      <div className="row-actions">
        {canSubmit && (
          <GovernedAction
            triggerLabel="Request beneficiary…"
            triggerTestId="beneficiary-add"
            triggerAppearance="secondary"
            title="Request a new beneficiary?"
            description="Payment-routing facts get dual control — this goes to an approver. Account numbers and IBANs are refused by law; use the org's label for the route."
            extra={
              <div className="form-sheet-fields">
                <div className="field-pair">
                  <Field label="Label" required>
                    <Input value={b.label} onChange={(e) => setB({ ...b, label: e.target.value })} data-testid="beneficiary-label" />
                  </Field>
                  <Field label="Currency (ISO)" required>
                    <Input value={b.currency} onChange={(e) => setB({ ...b, currency: e.target.value })} data-testid="beneficiary-currency" />
                  </Field>
                </div>
                <div className="field-pair">
                  <Field label="Bank name" required>
                    <Input value={b.bankName} onChange={(e) => setB({ ...b, bankName: e.target.value })} data-testid="beneficiary-bank" />
                  </Field>
                  <Field label="Bank country" required>
                    <Input value={b.bankCountry} onChange={(e) => setB({ ...b, bankCountry: e.target.value })} data-testid="beneficiary-country" />
                  </Field>
                </div>
                <div className="field-pair">
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
