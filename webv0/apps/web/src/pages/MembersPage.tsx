import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MemberDto } from '../api';
import { useMembers } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { IS_ENTRA } from '../auth';
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  Field,
  Input,
  Selector,
  FormDrawer,
  GovernedAction,
} from '../tablework';

/**
 * Members (Sprint 35 tenant-admin) — the organization's access register.
 * EVERY change is a governed request: submitting creates an approval that an
 * owner (never the requester) reviews and executes. Nothing on this page
 * mutates access directly; the notice copy says so on each action.
 *
 * Identity fields: production (entra build) binds the immutable Entra
 * (tenant id, object id) key — collected from the Entra profile exactly as the
 * onboarding runbook documents. The dev build binds the dev-IdP key (email).
 *
 * Tablework conversion (pivot W2, Lane C). EMAIL IS BAKED INTO THE TESTIDS
 * (`member-row-${email}` and the four row triggers) — members.spec addresses
 * every row and every action by address, so none of them may be re-keyed to
 * userId however much tidier that would read. `isSelf` (no row actions on your
 * own access) stays enforced by NOT RENDERING the actions, and the denial
 * keeps its own `members-denied` testid: denied is not empty.
 */
const ROLES = ['owner', 'operations', 'legal', 'finance', 'hr', 'management', 'visitor'] as const;

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: r }));

/** The row's governed triggers — flex-start, never the flex-end panel rhythm. */
const ACTIONS_CELL: React.CSSProperties = { display: 'flex', columnGap: 'var(--c3-space-2)', flexWrap: 'wrap' };

function RolePicker({ value, onChange, testId }: { value: string; onChange: (r: string) => void; testId: string }) {
  return (
    <Selector
      data-testid={testId}
      style={{ minWidth: '160px' }}
      value={value}
      options={ROLE_OPTIONS}
      onSelect={(v) => onChange(v)}
    />
  );
}

export function MembersPage() {
  return (
    <TableworkPage record="Members" section="Register" wide>
      <MembersRegister />
    </TableworkPage>
  );
}

function MembersRegister() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canRead = me?.capabilities.canReadMembers ?? false;
  const canChange = me?.capabilities.canSubmitMemberChange ?? false;
  // The wire law: the capability IS the `enabled` flag — the access register
  // never reaches a browser without standing to read it.
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
      <CollectionFrame title="Members">
        <EmptyState data-testid="members-denied" message="Organization members are not available for your role." />
      </CollectionFrame>
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
    <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="provision-member-toggle">
      Provision Member
    </button>
  ) : undefined;

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title="Members"
        count={data ? `${data.members.length} in this organization` : undefined}
        actions={addAction}
      >
        {isLoading && <LoadingState label="Loading members…" />}
        {isError && (
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not load members.'}
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
          />
        )}
        {/* No empty branch: this register has never had one (an organization
            always has at least the reader), and inventing one would add an
            unasserted surface. M2: the count lives ONCE, in the header. */}
        {data && data.members.length > 0 && (
          <ComparisonTable label="Members register" testId="members-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                {canChange && <th>Request change</th>}
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const isSelf = m.email === me?.identity?.toLowerCase();
                const toRole = changeRoleTo[m.userId] ?? m.role;
                return (
                  <tr key={m.userId} data-testid={`member-row-${m.email}`}>
                    <td>{m.displayName}</td>
                    <td>{m.email}</td>
                    <td>{m.role}</td>
                    <td>
                      <StatusBadge variant={m.isActive ? 'ready' : 'neutral'}>{m.isActive ? 'Active' : 'Inactive'}</StatusBadge>
                    </td>
                    {canChange && (
                      <td>
                        {isSelf ? (
                          // Enforced by NOT RENDERING — you may never request a
                          // change to your own access.
                          <span className="record-quiet">Your own access — changes require another member.</span>
                        ) : (
                          <div style={ACTIONS_CELL}>
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
          </ComparisonTable>
        )}
      </CollectionFrame>

      {canChange && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow="Provision member"
          mode="governed"
          intro="Member changes go through approval — an owner must review and execute before access changes."
          footer={
            <GovernedAction
              triggerLabel="Submit for approval"
              triggerTestId="provision-submit"
              triggerDisabled={!provisionReady}
              title="Request this member provision?"
              description="Submitting creates an approval request. The member is not provisioned until an owner (other than you) approves and executes it."
              confirmLabel="Submit for approval"
              onConfirm={submitProvision}
            />
          }
        >
          <Field label="Email" required>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} data-testid="provision-email" />
          </Field>
          <Field label="Display name" required>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="provision-name" />
          </Field>
          <Field label="Role" required>
            <RolePicker value={role} onChange={setRole} testId="provision-role" />
          </Field>
          {IS_ENTRA && (
            <>
              <Field label="Entra Object ID (oid)" required hint="From the user's Entra profile — the immutable identity key.">
                <Input value={oid} onChange={(e) => setOid(e.target.value)} data-testid="provision-oid" />
              </Field>
              <Field label="Entra tenant ID" required hint="The issuing tenant (B2B guests carry this organization's tenant id).">
                <Input value={issuerTid} onChange={(e) => setIssuerTid(e.target.value)} data-testid="provision-tid" />
              </Field>
            </>
          )}
        </FormDrawer>
      )}
    </>
  );
}
