import { useEffect, useState } from 'react';
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
  Field,
  Input,
  Selector,
  FormDrawer,
  GovernedAction,
  RecordLink,
  type WitnessState,
} from '../tablework';
import { RecheckingTruthPanel } from '../tablework/RecheckingTruthPanel';
import { memberRegisterTruthOf } from '../tablework/SeatsStanding';

/**
 * Members (Sprint 35 tenant-admin) — the organization's access register.
 * EVERY change is a governed request: submitting creates an approval that an
 * an authorized actor (never the requester) reviews and executes. Nothing on this page
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

function RolePicker({ value, onChange, testId }: { value: string; onChange: (r: string) => void; testId: string }) {
  return (
    <Selector
      data-testid={testId}
      width="compact"
      value={value}
      options={ROLE_OPTIONS}
      onSelect={(v) => onChange(v)}
    />
  );
}

export type SeatingReviewAvailability = 'available' | 'unavailable' | 'unknown';

/**
 * The Members register can prove a distinct active owner and it can prove the
 * one-member bootstrap dead end. It cannot prove that another non-owner lacks
 * delegated review standing, so that middle case deliberately stays unknown.
 */
export function deriveSeatingReviewAvailability(
  members: readonly MemberDto[] | undefined,
  requesterUserId: string | undefined,
  registerProven: boolean,
): SeatingReviewAvailability {
  if (!registerProven || !members || !requesterUserId) return 'unknown';
  const activeOthers = members.filter((member) => member.isActive && member.userId !== requesterUserId);
  if (activeOthers.some((member) => member.role === 'owner')) return 'available';
  return activeOthers.length === 0 ? 'unavailable' : 'unknown';
}

/** A successful empty register contradicts the authenticated member-bearing
 * session. It remains visible as witnessed truth, but never becomes a
 * bootstrap write surface. */
export function membersRegisterActionsAvailable(canChange: boolean, truth: WitnessState): boolean {
  return canChange && truth.kind === 'verified';
}

export function SeatingRequestHandoff({
  approvalId,
  requestedRole,
  displayName,
  email,
  reviewAvailability,
}: {
  approvalId: string;
  requestedRole: MemberDto['role'];
  displayName: string;
  email: string;
  reviewAvailability: SeatingReviewAvailability;
}) {
  const completionTruth =
    reviewAvailability === 'available' ? (
      <>A different authorized actor must review and execute this request.</>
    ) : reviewAvailability === 'unavailable' ? (
      <strong data-testid="seating-request-blocked">
        The current register has no other active member who can review and execute it.
      </strong>
    ) : (
      <>C3 cannot confirm distinct review and execution standing from the Members register alone.</>
    );

  return (
    <section className="consequence seating-handoff" data-testid="seating-request-handoff" aria-label="Seat request submitted">
      <small>Seating relay · {approvalId}</small>
      <h2>No access yet</h2>
      <p>{displayName} · {email} · Requested role: {requestedRole}.</p>
      <p>{completionTruth}</p>
      <p>
        <RecordLink to={`/approvals/${approvalId}`}>Open approval →</RecordLink>
      </p>
    </section>
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
  const { data, dataUpdatedAt, isLoading, isFetching, error } = useMembers(canRead);

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<string>('visitor');
  const [oid, setOid] = useState('');
  const [issuerTid, setIssuerTid] = useState('');
  const [changeRoleTo, setChangeRoleTo] = useState<Record<string, string>>({});
  const [seatingHandoff, setSeatingHandoff] = useState<{
    approvalId: string;
    requestedRole: MemberDto['role'];
    displayName: string;
    email: string;
  } | null>(null);

  const membersTruth = memberRegisterTruthOf({
    canRead,
    data,
    error,
    isLoading,
    isFetching,
    dataUpdatedAt,
  });
  // An authenticated session with a proven-empty Members register is an
  // invariant anomaly, not a bootstrap invitation. Keep it readable and
  // fail closed on every governed write.
  const actionsCurrent = membersRegisterActionsAvailable(canChange, membersTruth);
  const rechecking = data !== undefined && error == null && isFetching;

  useEffect(() => {
    if (!actionsCurrent) setShowForm(false);
  }, [actionsCurrent]);

  async function submitChange(
    payload: Parameters<typeof api.submitMemberChange>[0],
    summary: string,
    onSubmitted?: (approvalId: string) => void,
  ) {
    try {
      const res = await api.submitMemberChange(payload);
      notify('success', `Submitted ${res.approval.approvalId} for approval — ${summary}. Nothing changes until an authorized actor executes it.`);
      onSubmitted?.(res.approval.approvalId);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
      throw err instanceof Error ? err : new Error('Submission failed.');
    }
  }

  async function submitProvision() {
    const requestedRole = role as MemberDto['role'];
    const requestedDisplayName = displayName.trim();
    const requestedEmail = email.trim();
    const identity = IS_ENTRA
      ? { provider: 'entra' as const, issuerTenantId: issuerTid.trim(), subject: oid.trim() }
      : { provider: 'dev' as const, issuerTenantId: 'dev', subject: requestedEmail.toLowerCase() };
    await submitChange(
      { operationType: 'ProvisionMember', input: { email: requestedEmail, displayName: requestedDisplayName, role: requestedRole, identity } },
      `provision ${requestedEmail}`,
      (approvalId) => setSeatingHandoff({ approvalId, requestedRole, displayName: requestedDisplayName, email: requestedEmail }),
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
  const reviewAvailability = deriveSeatingReviewAvailability(
    data?.members,
    me?.userId,
    membersTruth.kind === 'verified',
  );

  const addAction = actionsCurrent ? (
    <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="provision-member-toggle">
      Provision Member
    </button>
  ) : undefined;

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title="Members"
        count={membersTruth.kind === 'verified' ? `${data?.members.length ?? 0} in this organization` : undefined}
        actions={addAction}
      >
        <RecheckingTruthPanel
          state={membersTruth}
          rechecking={rechecking}
          emptyLabel="No Members rows are recorded in this verified access-register view."
          testids={{
            loading: 'members-loading',
            verified: 'members-verified',
            empty: 'members-empty',
            denied: 'members-denied',
            failed: 'members-failed',
            stale: 'members-stale',
          }}
        >
          {seatingHandoff && (
            <SeatingRequestHandoff {...seatingHandoff} reviewAvailability={reviewAvailability} />
          )}
          {data && data.members.length > 0 && (
          <ComparisonTable label="Members register" testId="members-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                {actionsCurrent && <th>Request change</th>}
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
                    {actionsCurrent && (
                      <td>
                        {isSelf ? (
                          // Enforced by NOT RENDERING — you may never request a
                          // change to your own access.
                          <span className="record-quiet">Your own access — changes require another member.</span>
                        ) : (
                          <div className="row-actions">
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
        </RecheckingTruthPanel>
      </CollectionFrame>

      {actionsCurrent && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow="Provision member"
          mode="governed"
          intro="Member changes go through approval — a different authorized actor must review and execute before access changes."
          footer={
            <GovernedAction
              triggerLabel="Submit for approval"
              triggerTestId="provision-submit"
              triggerDisabled={!provisionReady}
              title="Request this member provision?"
              description="Submitting creates an approval request. The member is not provisioned until a different authorized actor reviews and executes it."
              confirmLabel="Submit for approval"
              onConfirm={submitProvision}
            />
          }
        >
          {reviewAvailability === 'unavailable' && (
            <section className="consequence seating-availability" data-testid="seating-no-reviewer">
              <small>Separation of duties</small>
              <strong>No other active member can complete this request</strong>
              <span>
                You may record the request, but it cannot be reviewed or executed from the current Members register.
              </span>
            </section>
          )}
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
