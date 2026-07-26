import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { credentialStatusOn } from '@c3web/domain';
import { useCredentials, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
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
} from '../tablework';
import { credentialStatusOf } from '../labels';

/**
 * Credentials (Sprint 36) — the second governed register. Every change is a
 * governed request (submit → owner review → execute); the STATUS column is a
 * pure read-side derivation from the plain expiry date (Active / Expires soon
 * / Expired / Inactive) — display-only, no scheduler.
 *
 * Tablework conversion (pivot W2, Lane C). Two things the conversion must NOT
 * touch: `credentialStatusOn` (the derivation engine) and the RAW ISO expiry —
 * `credentials.spec` asserts `2031-12-30` byte-for-byte, so `formatDisplayDate`
 * is a NEGATIVE contract here. The person picker becomes the kit `Selector`
 * because the oracle drives its real `role="option"` rows.
 */

/** Local calendar "today" — built from LOCAL components; never toISOString. */
function localTodayIso(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function CredentialsPage() {
  return (
    <TableworkPage record="Credentials" section="Register" wide>
      <CredentialsRegister />
    </TableworkPage>
  );
}

function CredentialsRegister() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useCredentials();
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  // The wire law: the capability IS the `enabled` flag — the roster only
  // travels to a browser that may compose a request.
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
    <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="add-credential-toggle">
      Add credential
    </button>
  ) : undefined;

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title="Credentials"
        count={data ? `${data.credentials.length} in this view` : undefined}
        actions={addAction}
      >
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
                <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="credentials-empty-add">
                  Add credential
                </button>
              ) : undefined
            }
          />
        )}
        {/* M2: the count lives ONCE, in the CollectionFrame header. The old
            footer repeat carried no testid and no spec asserted it. */}
        {data && data.credentials.length > 0 && (
          <ComparisonTable label="Credentials register" testId="credentials-table">
            <thead>
              <tr>
                <th>Credential</th>
                <th>Person</th>
                <th>Type</th>
                <th>Issuer</th>
                <th>Expires</th>
                <th>Status</th>
                {canSubmit && <th>Request change</th>}
              </tr>
            </thead>
            <tbody>
              {data.credentials.map((c) => {
                const derived = credentialStatusOn(c, today);
                const badge = credentialStatusOf(derived);
                return (
                  <tr key={c.credentialId} data-testid={`credential-row-${c.credentialId}`}>
                    <td>{c.credentialId}</td>
                    <td>
                      <RecordLink to={`/people/${c.personId}`}>{c.personId}</RecordLink>
                    </td>
                    <td>{c.credentialType}</td>
                    <td>{c.issuer ?? '—'}</td>
                    {/* RAW ISO, byte-for-byte — credentials.spec pins the date. */}
                    <td>{c.expiresOn ?? '—'}</td>
                    <td>
                      <StatusBadge variant={badge.variant} data-testid={`credential-status-${c.credentialId}`}>
                        {badge.label}
                      </StatusBadge>
                    </td>
                    {/* Header and body conditionals stay in lockstep. */}
                    {canSubmit && (
                      <td>
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
          </ComparisonTable>
        )}
      </CollectionFrame>

      {canSubmit && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow="Add credential"
          mode="governed"
          intro="New credential requests go through approval — an owner must review and execute before the credential exists."
          footer={
            <GovernedAction
              triggerLabel="Submit for approval"
              triggerTestId="add-credential-submit"
              triggerDisabled={!ready}
              title="Submit this credential request for approval?"
              description="It goes to an approver for review; you can edit it until review starts, then it’s frozen. Approval and execution are separate steps."
              confirmLabel="Submit for approval"
              onConfirm={submit}
            />
          }
        >
          <Field label="Person" required>
            <Selector
              data-testid="add-credential-person"
              width="wide"
              placeholder="Select a person"
              value={personId}
              display={personId ? personLabel : undefined}
              options={(people.data?.people ?? []).map((p) => ({
                value: p.personId,
                label: `${p.fullName} (${p.personId})`,
              }))}
              onSelect={(value, label) => {
                setPersonId(value);
                setPersonLabel(label);
              }}
            />
          </Field>
          <Field label="Credential type" required>
            <Input value={credentialType} onChange={(e) => setCredentialType(e.target.value)} data-testid="add-credential-type" />
          </Field>
          <Field label="Issuer">
            <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} data-testid="add-credential-issuer" />
          </Field>
          <Field label="Issued on" required>
            <DateInput value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} data-testid="add-credential-issued" />
          </Field>
          <Field label="Expires on" hint="Leave empty for a non-expiring credential.">
            <DateInput value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} data-testid="add-credential-expires" />
          </Field>
        </FormDrawer>
      )}
    </>
  );
}
