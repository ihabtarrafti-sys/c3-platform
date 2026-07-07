import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Dropdown, Field, Input, Option, Text, makeStyles } from '@fluentui/react-components';
import type { MemberDto } from '../api';
import { useMembers } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { IS_ENTRA } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';

/**
 * Members (Sprint 35 tenant-admin) — the organization's access register.
 * EVERY change is a governed request: submitting creates an approval that an
 * owner (never the requester) reviews and executes. Nothing on this page
 * mutates access directly; the notice copy says so on each action.
 *
 * Identity fields: production (entra build) binds the immutable Entra
 * (tenant id, object id) key — collected from the Entra profile exactly as the
 * onboarding runbook documents. The dev build binds the dev-IdP key (email).
 */
const ROLES = ['owner', 'operations', 'legal', 'finance', 'hr', 'management', 'visitor'] as const;

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', rowGap: '10px', maxWidth: '440px', padding: '16px', marginBottom: '20px' },
  formIntro: { fontSize: '13px', color: 'var(--c3-ink-70)' },
  actionsCell: { display: 'flex', columnGap: '8px', flexWrap: 'wrap' },
  roleSelect: { minWidth: '160px' },
});

function RolePicker({ value, onChange, testId }: { value: string; onChange: (r: string) => void; testId: string }) {
  const s = useStyles();
  return (
    <Dropdown
      className={s.roleSelect}
      value={value}
      selectedOptions={[value]}
      onOptionSelect={(_, d) => d.optionValue && onChange(d.optionValue)}
      data-testid={testId}
    >
      {ROLES.map((r) => (
        <Option key={r} value={r}>
          {r}
        </Option>
      ))}
    </Dropdown>
  );
}

export function MembersPage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canRead = me?.capabilities.canReadMembers ?? false;
  const canChange = me?.capabilities.canSubmitMemberChange ?? false;
  const { data, isLoading, isError, error } = useMembers(canRead);

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<string>('visitor');
  const [oid, setOid] = useState('');
  const [issuerTid, setIssuerTid] = useState('');
  const [changeRoleTo, setChangeRoleTo] = useState<Record<string, string>>({});

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Members" />
        <EmptyState data-testid="members-denied" message="Organization members are not available for your role." />
      </div>
    );
  }

  async function submitChange(payload: Parameters<typeof api.submitMemberChange>[0], summary: string) {
    try {
      const res = await api.submitMemberChange(payload);
      notify('success', `Submitted ${res.approval.approvalId} for approval — ${summary}. Nothing changes until an owner executes it.`);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
      throw err instanceof Error ? err : new Error('Submission failed.');
    }
  }

  async function submitProvision() {
    const identity = IS_ENTRA
      ? { provider: 'entra' as const, issuerTenantId: issuerTid.trim(), subject: oid.trim() }
      : { provider: 'dev' as const, issuerTenantId: 'dev', subject: email.trim().toLowerCase() };
    await submitChange(
      { operationType: 'ProvisionMember', input: { email: email.trim(), displayName: displayName.trim(), role: role as MemberDto['role'], identity } },
      `provision ${email.trim()}`,
    );
    setEmail('');
    setDisplayName('');
    setOid('');
    setIssuerTid('');
    setRole('visitor');
    setShowForm(false);
  }

  const provisionReady =
    email.trim() !== '' && displayName.trim() !== '' && (!IS_ENTRA || (oid.trim() !== '' && issuerTid.trim() !== ''));

  const addAction = canChange ? (
    <Button appearance="primary" onClick={() => setShowForm((v) => !v)} data-testid="provision-member-toggle">
      {showForm ? 'Cancel' : 'Provision Member'}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title="Members" context={data ? `${data.members.length} in this organization` : undefined} actions={addAction} />

      {canChange && showForm && (
        <Card className={s.form}>
          <Text className={s.formIntro}>
            Member changes go through approval — an owner must review and execute before access changes.
          </Text>
          <Field label="Email" required>
            <Input value={email} onChange={(_, d) => setEmail(d.value)} data-testid="provision-email" />
          </Field>
          <Field label="Display name" required>
            <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} data-testid="provision-name" />
          </Field>
          <Field label="Role" required>
            <RolePicker value={role} onChange={setRole} testId="provision-role" />
          </Field>
          {IS_ENTRA && (
            <>
              <Field label="Entra Object ID (oid)" required hint="From the user's Entra profile — the immutable identity key.">
                <Input value={oid} onChange={(_, d) => setOid(d.value)} data-testid="provision-oid" />
              </Field>
              <Field label="Entra tenant ID" required hint="The issuing tenant (B2B guests carry this organization's tenant id).">
                <Input value={issuerTid} onChange={(_, d) => setIssuerTid(d.value)} data-testid="provision-tid" />
              </Field>
            </>
          )}
          <div>
            <GovernedAction
              triggerLabel="Submit for approval"
              triggerTestId="provision-submit"
              triggerDisabled={!provisionReady}
              title="Request this member provision?"
              description="Submitting creates an approval request. The member is not provisioned until an owner (other than you) approves and executes it."
              confirmLabel="Submit for approval"
              onConfirm={submitProvision}
            />
          </div>
        </Card>
      )}

      {isLoading && <LoadingState label="Loading members…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load members.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.members.length > 0 && (
        <>
          <table className={r.table} data-testid="members-table" aria-label="Members register">
            <thead>
              <tr>
                <th className={r.th}>Member</th>
                <th className={r.th}>Email</th>
                <th className={r.th}>Role</th>
                <th className={r.th}>Status</th>
                {canChange && <th className={r.th}>Request change</th>}
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const isSelf = m.email === me?.identity?.toLowerCase();
                const toRole = changeRoleTo[m.userId] ?? m.role;
                return (
                  <tr key={m.userId} className={r.row} data-testid={`member-row-${m.email}`}>
                    <td className={`${r.td} ${r.name}`}>{m.displayName}</td>
                    <td className={r.td}>{m.email}</td>
                    <td className={r.td}>{m.role}</td>
                    <td className={r.td}>
                      <StatusBadge variant={m.isActive ? 'ready' : 'neutral'}>{m.isActive ? 'Active' : 'Inactive'}</StatusBadge>
                    </td>
                    {canChange && (
                      <td className={r.td}>
                        {isSelf ? (
                          <Text size={200}>Your own access — changes require another member.</Text>
                        ) : (
                          <div className={s.actionsCell}>
                            <GovernedAction
                              triggerLabel="Role…"
                              triggerTestId={`change-role-${m.email}`}
                              triggerAppearance="secondary"
                              title={`Request a role change for ${m.email}?`}
                              description="Submitting creates an approval request; the role changes only when an owner executes it."
                              extra={<RolePicker value={toRole} onChange={(v) => setChangeRoleTo((c) => ({ ...c, [m.userId]: v }))} testId={`change-role-picker-${m.email}`} />}
                              confirmLabel="Submit for approval"
                              confirmDisabled={toRole === m.role}
                              onConfirm={() =>
                                submitChange(
                                  { operationType: 'ChangeRole', input: { targetUserId: m.userId, email: m.email, toRole: toRole as MemberDto['role'] } },
                                  `change ${m.email} to ${toRole}`,
                                )
                              }
                            />
                            {m.isActive ? (
                              <GovernedAction
                                triggerLabel="Deactivate…"
                                triggerTestId={`deactivate-${m.email}`}
                                triggerAppearance="secondary"
                                title={`Request deactivation of ${m.email}?`}
                                description="Submitting creates an approval request. Access is revoked only when an owner executes it; revocation then applies from their next request."
                                confirmLabel="Submit for approval"
                                onConfirm={() =>
                                  submitChange(
                                    { operationType: 'DeactivateMember', input: { targetUserId: m.userId, email: m.email } },
                                    `deactivate ${m.email}`,
                                  )
                                }
                              />
                            ) : (
                              <GovernedAction
                                triggerLabel="Reactivate…"
                                triggerTestId={`reactivate-${m.email}`}
                                triggerAppearance="secondary"
                                title={`Request reactivation of ${m.email}?`}
                                description="Submitting creates an approval request; access is restored only when an owner executes it."
                                confirmLabel="Submit for approval"
                                onConfirm={() =>
                                  submitChange(
                                    { operationType: 'ReactivateMember', input: { targetUserId: m.userId, email: m.email } },
                                    `reactivate ${m.email}`,
                                  )
                                }
                              />
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={r.count}>
            {data.members.length} {data.members.length === 1 ? 'member' : 'members'}
          </div>
        </>
      )}
    </div>
  );
}
