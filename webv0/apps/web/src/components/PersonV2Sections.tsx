import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Input, makeStyles } from '@fluentui/react-components';
import type { PersonDto } from '@c3web/api-contracts';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { GovernedAction } from './GovernedAction';
import { DefinitionList } from './DefinitionList';

/**
 * PersonV2Sections — S11: the PIF record made visible and maintainable.
 *
 *  - Identity card: names, DOB (PII), nationalities. Changes are GOVERNED
 *    ("Request identity change…" submits to the pipeline; nothing changes
 *    until an owner executes).
 *  - PII block (owner/ops/hr only — the API omits the fields structurally
 *    for everyone else, so this section simply has nothing to show).
 *  - Operational details: position, joining date, contacts — DIRECT-audited
 *    ("Edit details…"), version-guarded.
 *  - Lifecycle: Deactivate…/Reactivate… are GOVERNED requests with a
 *    mandatory reason (feeds the future Departure workflow).
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
  row: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '10px' },
  two: { display: 'flex', gap: '10px', '> *': { flexGrow: 1 } },
});

const show = (v: string | null | undefined) => (v === undefined ? undefined : (v ?? null));

export function PersonV2Sections({ person }: { person: PersonDto }) {
  const s = useStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const canEditOps = me?.capabilities.canManageMissions ?? false;
  const piiVisible = me?.capabilities.canViewPersonPII ?? false;

  const [idPatch, setIdPatch] = useState({ fullName: '', firstName: '', lastName: '', dateOfBirth: '', nationality: '', otherNats: '' });
  const [ops, setOps] = useState({
    position: person.position ?? '',
    dateOfJoining: person.dateOfJoining ?? '',
    phone: person.phone ?? '',
    email: person.email ?? '',
    addressLine1: person.addressLine1 ?? '',
    addressLine2: person.addressLine2 ?? '',
    addressCity: person.addressCity ?? '',
    addressCountry: person.addressCountry ?? '',
    notes: person.notes ?? '',
  });
  const [lifecycleReason, setLifecycleReason] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['person', person.personId] });
    void qc.invalidateQueries({ queryKey: ['people'] });
    void qc.invalidateQueries({ queryKey: ['personAudit', person.personId] });
    void qc.invalidateQueries({ queryKey: ['approvals'] });
    void qc.invalidateQueries({ queryKey: ['personApprovals', person.personId] });
  };

  async function run<T>(fn: () => Promise<T>, ok: (r: T) => string): Promise<void> {
    try {
      const r = await fn();
      notify('success', ok(r));
      refresh();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The request failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  const sparse = (o: Record<string, string>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (v.trim() !== '') out[k] = v.trim();
    return out;
  };

  const identityPatchBody = (): Record<string, unknown> => {
    const p = sparse({
      fullName: idPatch.fullName,
      firstName: idPatch.firstName,
      lastName: idPatch.lastName,
      dateOfBirth: idPatch.dateOfBirth,
      nationality: idPatch.nationality,
    });
    if (idPatch.otherNats.trim() !== '') {
      p.otherNationalities = idPatch.otherNats.split(',').map((x) => x.trim()).filter(Boolean);
    }
    return p;
  };

  const opsPatchBody = (): Record<string, unknown> => ({
    position: ops.position.trim() || null,
    dateOfJoining: ops.dateOfJoining || null,
    phone: ops.phone.trim() || null,
    email: ops.email.trim() || null,
    addressLine1: ops.addressLine1.trim() || null,
    addressLine2: ops.addressLine2.trim() || null,
    addressCity: ops.addressCity.trim() || null,
    addressCountry: ops.addressCountry.trim() || null,
    notes: ops.notes.trim() || null,
  });

  return (
    <>
      <div className={s.section} data-testid="person-identity-card">
        <h2 className={s.h2}>Identity</h2>
        <DefinitionList
          items={[
            { label: 'First name', value: show(person.firstName) ?? null, testId: 'person-first-name' },
            { label: 'Last name', value: show(person.lastName) ?? null, testId: 'person-last-name' },
            ...(piiVisible ? [{ label: 'Date of birth', value: person.dateOfBirth ?? null, testId: 'person-dob' }] : []),
            { label: 'Nationality', value: person.nationality ?? null },
            {
              label: 'Other nationalities',
              value: person.otherNationalities.length > 0 ? person.otherNationalities.join(' · ') : null,
              testId: 'person-other-nationalities',
            },
            { label: 'Position', value: person.position ?? null, testId: 'person-position' },
            { label: 'Joined', value: person.dateOfJoining ?? null },
          ]}
        />
      </div>

      {piiVisible && (
        <div className={s.section} data-testid="person-pii-block">
          <h2 className={s.h2}>Contact & address (PII)</h2>
          <DefinitionList
            items={[
              { label: 'Phone', value: person.phone ?? null, testId: 'person-phone' },
              { label: 'Email', value: person.email ?? null, testId: 'person-email' },
              {
                label: 'Address',
                value:
                  [person.addressLine1, person.addressLine2, person.addressCity, person.addressCountry].filter(Boolean).join(', ') || null,
                testId: 'person-address',
              },
            ]}
          />
        </div>
      )}

      <div className={s.row} data-testid="person-v2-actions">
        {canSubmit && (
          <GovernedAction
            triggerLabel="Request identity change…"
            triggerTestId="person-identity-request"
            triggerAppearance="secondary"
            title={`Request an identity change for ${person.fullName}?`}
            description="Names, date of birth and nationalities are compliance facts — the change goes to an approver and nothing changes until an owner executes it. Fill only the fields you want to change."
            extra={
              <div className={s.fields}>
                <Field label="Full name (display)">
                  <Input value={idPatch.fullName} onChange={(_, d) => setIdPatch({ ...idPatch, fullName: d.value })} data-testid="identity-fullname" />
                </Field>
                <div className={s.two}>
                  <Field label="First name">
                    <Input value={idPatch.firstName} onChange={(_, d) => setIdPatch({ ...idPatch, firstName: d.value })} data-testid="identity-first" />
                  </Field>
                  <Field label="Last name">
                    <Input value={idPatch.lastName} onChange={(_, d) => setIdPatch({ ...idPatch, lastName: d.value })} data-testid="identity-last" />
                  </Field>
                </div>
                <Field label="Date of birth">
                  <Input type="date" value={idPatch.dateOfBirth} onChange={(_, d) => setIdPatch({ ...idPatch, dateOfBirth: d.value })} data-testid="identity-dob" />
                </Field>
                <Field label="Nationality">
                  <Input value={idPatch.nationality} onChange={(_, d) => setIdPatch({ ...idPatch, nationality: d.value })} data-testid="identity-nationality" />
                </Field>
                <Field label="Other nationalities (comma-separated)">
                  <Input value={idPatch.otherNats} onChange={(_, d) => setIdPatch({ ...idPatch, otherNats: d.value })} data-testid="identity-other-nats" />
                </Field>
              </div>
            }
            confirmLabel="Submit for approval"
            confirmDisabled={Object.keys(identityPatchBody()).length === 0}
            onConfirm={() =>
              run(
                () => api.submitPersonIdentity(person.personId, { patch: identityPatchBody() }),
                (r) => `Submitted ${r.approval.approvalId} — identity change for ${person.personId}. Nothing changes until an owner executes it.`,
              ).then(() => setIdPatch({ fullName: '', firstName: '', lastName: '', dateOfBirth: '', nationality: '', otherNats: '' }))
            }
          />
        )}

        {canEditOps && (
          <GovernedAction
            triggerLabel="Edit details…"
            triggerTestId="person-edit-operational"
            triggerAppearance="secondary"
            title={`Edit operational details for ${person.fullName}?`}
            description="Position, joining date, contacts and notes apply immediately and are audited (before → after)."
            extra={
              <div className={s.fields}>
                <div className={s.two}>
                  <Field label="Position">
                    <Input value={ops.position} onChange={(_, d) => setOps({ ...ops, position: d.value })} data-testid="ops-position" />
                  </Field>
                  <Field label="Date of joining">
                    <Input type="date" value={ops.dateOfJoining} onChange={(_, d) => setOps({ ...ops, dateOfJoining: d.value })} data-testid="ops-joined" />
                  </Field>
                </div>
                <div className={s.two}>
                  <Field label="Phone">
                    <Input value={ops.phone} onChange={(_, d) => setOps({ ...ops, phone: d.value })} data-testid="ops-phone" />
                  </Field>
                  <Field label="Email">
                    <Input value={ops.email} onChange={(_, d) => setOps({ ...ops, email: d.value })} data-testid="ops-email" />
                  </Field>
                </div>
                <Field label="Address line 1">
                  <Input value={ops.addressLine1} onChange={(_, d) => setOps({ ...ops, addressLine1: d.value })} data-testid="ops-address1" />
                </Field>
                <Field label="Address line 2">
                  <Input value={ops.addressLine2} onChange={(_, d) => setOps({ ...ops, addressLine2: d.value })} />
                </Field>
                <div className={s.two}>
                  <Field label="City">
                    <Input value={ops.addressCity} onChange={(_, d) => setOps({ ...ops, addressCity: d.value })} data-testid="ops-city" />
                  </Field>
                  <Field label="Country">
                    <Input value={ops.addressCountry} onChange={(_, d) => setOps({ ...ops, addressCountry: d.value })} data-testid="ops-country" />
                  </Field>
                </div>
                <Field label="Notes">
                  <Input value={ops.notes} onChange={(_, d) => setOps({ ...ops, notes: d.value })} />
                </Field>
              </div>
            }
            confirmLabel="Save changes"
            onConfirm={() =>
              run(
                () => api.updatePersonOperational(person.personId, { expectedVersion: person.version, patch: opsPatchBody() }),
                () => `Saved — operational details updated for ${person.personId} (audited).`,
              )
            }
          />
        )}

        {canSubmit && person.isActive && (
          <GovernedAction
            triggerLabel="Deactivate…"
            triggerTestId="person-deactivate-request"
            triggerAppearance="secondary"
            title={`Request deactivation of ${person.fullName}?`}
            description="A person leaving is a governance event — this goes to an approver; the person stays active until an owner executes it."
            extra={
              <Field label="Reason" required>
                <Input value={lifecycleReason} onChange={(_, d) => setLifecycleReason(d.value)} data-testid="lifecycle-reason" />
              </Field>
            }
            confirmLabel="Submit for approval"
            confirmDisabled={lifecycleReason.trim() === ''}
            onConfirm={() =>
              run(
                () => api.submitDeactivatePerson(person.personId, lifecycleReason.trim()),
                (r) => `Submitted ${r.approval.approvalId} — deactivation of ${person.personId}.`,
              ).then(() => setLifecycleReason(''))
            }
          />
        )}

        {canSubmit && !person.isActive && (
          <GovernedAction
            triggerLabel="Reactivate…"
            triggerTestId="person-reactivate-request"
            triggerAppearance="secondary"
            title={`Request reactivation of ${person.fullName}?`}
            description="This goes to an approver; the person stays inactive until an owner executes it."
            extra={
              <Field label="Reason" required>
                <Input value={lifecycleReason} onChange={(_, d) => setLifecycleReason(d.value)} data-testid="lifecycle-reason" />
              </Field>
            }
            confirmLabel="Submit for approval"
            confirmDisabled={lifecycleReason.trim() === ''}
            onConfirm={() =>
              run(
                () => api.submitReactivatePerson(person.personId, lifecycleReason.trim()),
                (r) => `Submitted ${r.approval.approvalId} — reactivation of ${person.personId}.`,
              ).then(() => setLifecycleReason(''))
            }
          />
        )}
      </div>
    </>
  );
}
