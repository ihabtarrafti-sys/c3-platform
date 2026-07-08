import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Field, Input, Option, makeStyles } from '@fluentui/react-components';
import { credentialStatusOn } from '@c3web/domain';
import { useCredentials, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { FormPanel } from '../components/FormPanel';
import { credentialStatusOf } from '../labels';

/**
 * Credentials (Sprint 36) — the second governed register. Every change is a
 * governed request (submit → owner review → execute); the STATUS column is a
 * pure read-side derivation from the plain expiry date (Active / Expires soon
 * / Expired / Inactive) — display-only, no scheduler.
 */

/** Local calendar "today" — built from LOCAL components; never toISOString. */
function localTodayIso(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const useStyles = makeStyles({
  personSelect: { minWidth: '260px' },
});

export function CredentialsPage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useCredentials();
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const people = usePeople(canSubmit);

  const [showForm, setShowForm] = useState(false);
  const [personId, setPersonId] = useState('');
  const [personLabel, setPersonLabel] = useState('');
  const [credentialType, setCredentialType] = useState('');
  const [issuer, setIssuer] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');

  const today = localTodayIso();

  async function submit() {
    try {
      const res = await api.submitAddCredential({
        personId,
        credentialType,
        issuer: issuer || undefined,
        issuedOn,
        expiresOn: expiresOn || undefined,
      } as Parameters<typeof api.submitAddCredential>[0]);
      notify('success', `Submitted ${res.approval.approvalId} for approval. The credential is not created until an owner executes it.`);
      setShowForm(false);
      setPersonId('');
      setPersonLabel('');
      setCredentialType('');
      setIssuer('');
      setIssuedOn('');
      setExpiresOn('');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
      throw err instanceof Error ? err : new Error('Submission failed.');
    }
  }

  async function submitDeactivate(credentialId: string, ownerPersonId: string) {
    try {
      const res = await api.submitDeactivateCredential({ credentialId, personId: ownerPersonId });
      notify('success', `Submitted ${res.approval.approvalId} for approval — deactivate ${credentialId}. Nothing changes until an owner executes it.`);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
      throw err instanceof Error ? err : new Error('Submission failed.');
    }
  }

  const ready = personId !== '' && credentialType.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(issuedOn);

  const addAction = canSubmit ? (
    <Button appearance="primary" onClick={() => setShowForm((v) => !v)} data-testid="add-credential-toggle">
      {showForm ? 'Cancel' : 'Add Credential'}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title="Credentials" context={data ? `${data.credentials.length} in this view` : undefined} actions={addAction} />

      {canSubmit && showForm && (
        <FormPanel
          eyebrow="Add credential"
          mode="governed"
          intro="New credential requests go through approval — an owner must review and execute before the credential exists."
          footer={
            <GovernedAction
              triggerLabel="Submit for approval"
              triggerTestId="add-credential-submit"
              triggerDisabled={!ready}
              title="Submit this credential request for approval?"
              description="Once submitted, this request can’t be edited. It goes to an approver for review; approval and execution are separate steps."
              confirmLabel="Submit for approval"
              onConfirm={submit}
            />
          }
        >
          <Field label="Person" required>
            <Dropdown
              className={s.personSelect}
              placeholder="Select a person"
              value={personLabel}
              selectedOptions={personId ? [personId] : []}
              onOptionSelect={(_, d) => {
                if (d.optionValue) {
                  setPersonId(d.optionValue);
                  setPersonLabel(d.optionText ?? d.optionValue);
                }
              }}
              data-testid="add-credential-person"
            >
              {(people.data?.people ?? []).map((p) => (
                <Option key={p.personId} value={p.personId} text={`${p.fullName} (${p.personId})`}>
                  {`${p.fullName} (${p.personId})`}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label="Credential type" required>
            <Input value={credentialType} onChange={(_, d) => setCredentialType(d.value)} data-testid="add-credential-type" />
          </Field>
          <Field label="Issuer">
            <Input value={issuer} onChange={(_, d) => setIssuer(d.value)} data-testid="add-credential-issuer" />
          </Field>
          <Field label="Issued on" required>
            <Input type="date" value={issuedOn} onChange={(_, d) => setIssuedOn(d.value)} data-testid="add-credential-issued" />
          </Field>
          <Field label="Expires on" hint="Leave empty for a non-expiring credential.">
            <Input type="date" value={expiresOn} onChange={(_, d) => setExpiresOn(d.value)} data-testid="add-credential-expires" />
          </Field>
        </FormPanel>
      )}

      {isLoading && <LoadingState label="Loading credentials…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load credentials.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.credentials.length === 0 && (
        <EmptyState
          data-testid="credentials-empty"
          message="No credentials yet."
          action={
            canSubmit ? (
              <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="credentials-empty-add">
                Add Credential
              </Button>
            ) : undefined
          }
        />
      )}
      {data && data.credentials.length > 0 && (
        <>
          <table className={r.table} data-testid="credentials-table" aria-label="Credentials register">
            <thead>
              <tr>
                <th className={r.th}>Credential</th>
                <th className={r.th}>Person</th>
                <th className={r.th}>Type</th>
                <th className={r.th}>Issuer</th>
                <th className={r.th}>Expires</th>
                <th className={r.th}>Status</th>
                {canSubmit && <th className={r.th}>Request change</th>}
              </tr>
            </thead>
            <tbody>
              {data.credentials.map((c) => {
                const derived = credentialStatusOn(c, today);
                const badge = credentialStatusOf(derived);
                return (
                  <tr key={c.credentialId} className={r.row} data-testid={`credential-row-${c.credentialId}`}>
                    <td className={`${r.td}`}>{c.credentialId}</td>
                    <td className={r.td}>
                      <Link className={r.idLink} to={`/people/${c.personId}`}>
                        {c.personId}
                      </Link>
                    </td>
                    <td className={`${r.td} ${r.name}`}>{c.credentialType}</td>
                    <td className={r.td}>{c.issuer ?? '—'}</td>
                    <td className={r.td}>{c.expiresOn ?? '—'}</td>
                    <td className={r.td}>
                      <StatusBadge variant={badge.variant} data-testid={`credential-status-${c.credentialId}`}>
                        {badge.label}
                      </StatusBadge>
                    </td>
                    {canSubmit && (
                      <td className={r.td}>
                        {c.isActive ? (
                          <GovernedAction
                            triggerLabel="Deactivate…"
                            triggerTestId={`deactivate-credential-${c.credentialId}`}
                            triggerAppearance="secondary"
                            title={`Request deactivation of ${c.credentialId}?`}
                            description="Submitting creates an approval request; the credential is deactivated only when an owner executes it."
                            confirmLabel="Submit for approval"
                            onConfirm={() => submitDeactivate(c.credentialId, c.personId)}
                          />
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={r.count}>
            {data.credentials.length} {data.credentials.length === 1 ? 'credential' : 'credentials'}
          </div>
        </>
      )}
    </div>
  );
}
