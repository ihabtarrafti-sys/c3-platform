import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseDecimalToMinor } from '@c3web/domain';
import { Dropdown, Field, Input, Option, makeStyles } from '@fluentui/react-components';
import { useMissions } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { GovernedAction } from './GovernedAction';

/**
 * PersonActions (Sprint 42 W3) — the person page's WRITE side: start any
 * governed flow FROM the person, pre-filled with them. No person pickers —
 * the person IS the context. Same approval pipeline, same honest copy; the
 * hub removes navigation friction, never governance.
 */

const useStyles = makeStyles({
  row: { display: 'flex', columnGap: '8px', flexWrap: 'wrap', marginTop: '16px' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '8px' },
  select: { minWidth: '240px' },
});

export function PersonActions({ personId, personName }: { personId: string; personName: string }) {
  const s = useStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const showValue = me?.capabilities.canViewFinancials ?? false;
  const missions = useMissions();

  const [cred, setCred] = useState({ type: '', issuer: '', issued: '', expires: '' });
  const [jrn, setJrn] = useState({ type: '', title: '', started: '' });
  const [agr, setAgr] = useState({ type: '', code: '', starts: '', ends: '', value: '' });
  const [msn, setMsn] = useState({ missionId: '', missionLabel: '', role: '' });

  if (!canSubmit) return null;

  async function submit<T extends { approval: { approvalId: string } }>(fn: () => Promise<T>, what: string): Promise<void> {
    try {
      const res = await fn();
      notify('success', `Submitted ${res.approval.approvalId} for approval — ${what}. Nothing changes until an owner executes it.`);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['personApprovals', personId] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
      throw err instanceof Error ? err : new Error('Submission failed.');
    }
  }

  const isoOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const activeMissions = (missions.data?.missions ?? []).filter((m) => m.isActive);

  return (
    <div className={s.row} data-testid="person-actions">
      <GovernedAction
        triggerLabel="Add credential…"
        triggerTestId="person-add-credential"
        triggerAppearance="secondary"
        title={`Request a credential for ${personName}?`}
        description="This goes to an approver for review; the credential is not created until an owner executes it."
        extra={
          <div className={s.fields}>
            <Field label="Credential type" required>
              <Input value={cred.type} onChange={(_, d) => setCred({ ...cred, type: d.value })} data-testid="person-cred-type" />
            </Field>
            <Field label="Issuer">
              <Input value={cred.issuer} onChange={(_, d) => setCred({ ...cred, issuer: d.value })} />
            </Field>
            <Field label="Issued on" required>
              <Input type="date" value={cred.issued} onChange={(_, d) => setCred({ ...cred, issued: d.value })} data-testid="person-cred-issued" />
            </Field>
            <Field label="Expires on">
              <Input type="date" value={cred.expires} onChange={(_, d) => setCred({ ...cred, expires: d.value })} data-testid="person-cred-expires" />
            </Field>
          </div>
        }
        confirmLabel="Submit for approval"
        confirmDisabled={cred.type.trim() === '' || !isoOk(cred.issued)}
        onConfirm={() =>
          submit(
            () =>
              api.submitAddCredential({
                personId,
                credentialType: cred.type.trim(),
                issuer: cred.issuer.trim() || undefined,
                issuedOn: cred.issued,
                expiresOn: cred.expires || undefined,
              } as Parameters<typeof api.submitAddCredential>[0]),
            `credential for ${personId}`,
          ).then(() => setCred({ type: '', issuer: '', issued: '', expires: '' }))
        }
      />

      <GovernedAction
        triggerLabel="Start journey…"
        triggerTestId="person-start-journey"
        triggerAppearance="secondary"
        title={`Request a journey for ${personName}?`}
        description="This goes to an approver for review; the journey does not begin until an owner executes it."
        extra={
          <div className={s.fields}>
            <Field label="Journey type" required>
              <Input value={jrn.type} onChange={(_, d) => setJrn({ ...jrn, type: d.value })} data-testid="person-journey-type" />
            </Field>
            <Field label="Title">
              <Input value={jrn.title} onChange={(_, d) => setJrn({ ...jrn, title: d.value })} />
            </Field>
            <Field label="Starts on" required>
              <Input type="date" value={jrn.started} onChange={(_, d) => setJrn({ ...jrn, started: d.value })} data-testid="person-journey-started" />
            </Field>
          </div>
        }
        confirmLabel="Submit for approval"
        confirmDisabled={jrn.type.trim() === '' || !isoOk(jrn.started)}
        onConfirm={() =>
          submit(
            () =>
              api.submitInitiateJourney({
                personId,
                journeyType: jrn.type.trim(),
                title: jrn.title.trim() || undefined,
                startedOn: jrn.started,
              } as Parameters<typeof api.submitInitiateJourney>[0]),
            `journey for ${personId}`,
          ).then(() => setJrn({ type: '', title: '', started: '' }))
        }
      />

      <GovernedAction
        triggerLabel="Add agreement…"
        triggerTestId="person-add-agreement"
        triggerAppearance="secondary"
        title={`Request an agreement for ${personName}?`}
        description="This goes to an approver for review; the agreement does not exist until an owner executes it."
        extra={
          <div className={s.fields}>
            <Field label="Agreement type" required hint='e.g. "Player Contract", "NDA"'>
              <Input value={agr.type} onChange={(_, d) => setAgr({ ...agr, type: d.value })} data-testid="person-agreement-type" />
            </Field>
            <Field label="Agreement code">
              <Input value={agr.code} onChange={(_, d) => setAgr({ ...agr, code: d.value })} />
            </Field>
            <Field label="Starts on" required>
              <Input type="date" value={agr.starts} onChange={(_, d) => setAgr({ ...agr, starts: d.value })} data-testid="person-agreement-starts" />
            </Field>
            <Field label="Ends on" required>
              <Input type="date" value={agr.ends} onChange={(_, d) => setAgr({ ...agr, ends: d.value })} data-testid="person-agreement-ends" />
            </Field>
            {showValue && (
              <Field label="Value (USD)">
                <Input type="number" value={agr.value} onChange={(_, d) => setAgr({ ...agr, value: d.value })} />
              </Field>
            )}
          </div>
        }
        confirmLabel="Submit for approval"
        // M-02: exact-decimal law — a malformed/over-precise value disables
        // Submit (never a silent round, never a silently dropped value).
        confirmDisabled={
          agr.type.trim() === '' ||
          !isoOk(agr.starts) ||
          !isoOk(agr.ends) ||
          agr.ends < agr.starts ||
          (agr.value.trim() !== '' && parseDecimalToMinor(agr.value) === null)
        }
        onConfirm={() =>
          submit(
            () =>
              api.submitAddAgreement({
                personId,
                agreementType: agr.type.trim(),
                agreementCode: agr.code.trim() || undefined,
                startsOn: agr.starts,
                endsOn: agr.ends,
                valueUsdCents: agr.value.trim() === '' ? undefined : parseDecimalToMinor(agr.value)!,
              } as Parameters<typeof api.submitAddAgreement>[0]),
            `agreement for ${personId}`,
          ).then(() => setAgr({ type: '', code: '', starts: '', ends: '', value: '' }))
        }
      />

      <GovernedAction
        triggerLabel="Add to mission…"
        triggerTestId="person-add-to-mission"
        triggerAppearance="secondary"
        title={`Request adding ${personName} to a mission?`}
        description="This goes to an approver for review; the roster is unchanged until an owner executes it."
        extra={
          <div className={s.fields}>
            <Field label="Mission" required>
              <Dropdown
                className={s.select}
                placeholder="Select a mission"
                value={msn.missionLabel}
                selectedOptions={msn.missionId ? [msn.missionId] : []}
                onOptionSelect={(_, d) => {
                  if (d.optionValue) setMsn({ ...msn, missionId: d.optionValue, missionLabel: d.optionText ?? d.optionValue });
                }}
                data-testid="person-mission-pick"
              >
                {activeMissions.map((m) => (
                  <Option key={m.missionId} value={m.missionId} text={`${m.missionId} — ${m.name}`}>
                    {`${m.missionId} — ${m.name}`}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Mission role" required>
              <Input value={msn.role} onChange={(_, d) => setMsn({ ...msn, role: d.value })} data-testid="person-mission-role" />
            </Field>
          </div>
        }
        confirmLabel="Submit for approval"
        confirmDisabled={msn.missionId === '' || msn.role.trim() === ''}
        onConfirm={() =>
          submit(
            () => api.submitAddMissionParticipant({ missionId: msn.missionId, personId, role: msn.role.trim() }),
            `${personId} onto ${msn.missionId}`,
          ).then(() => setMsn({ missionId: '', missionLabel: '', role: '' }))
        }
      />
    </div>
  );
}
