import { useLayoutEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { ApprovalSummaryDto, MemberDto } from '@c3web/api-contracts';
import { ApiError } from '../api';
import { operationOf } from '../labels';
import { useApprovals, useMembers } from '../queries';
import { useSession } from '../session';
import { RecheckingTruthPanel } from './RecheckingTruthPanel';
import { StatusBadge, type StatusVariant } from './collections';
import { truthStateOf, type WitnessState } from './TruthPanel';
import { useForegroundRewitness } from './useForegroundRewitness';

const MEMBER_OPERATIONS = new Set([
  'ProvisionMember',
  'ChangeRole',
  'DeactivateMember',
  'ReactivateMember',
]);

interface MembersView {
  readonly members: readonly MemberDto[];
}

interface ApprovalsView {
  readonly approvals: readonly ApprovalSummaryDto[];
}

export interface SeatsStandingTruthFacts<T> {
  readonly canRead: boolean;
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

function registerTruthOf<T>(
  facts: SeatsStandingTruthFacts<T>,
  isEmpty: (data: T) => boolean,
  unavailableReason: string,
  recheckMessage: string,
): WitnessState {
  if (!facts.canRead) return { kind: 'denied', reasonClass: unavailableReason };
  if (facts.error instanceof ApiError && (facts.error.status === 401 || facts.error.status === 403)) {
    return { kind: 'denied', reasonClass: facts.error.code || unavailableReason };
  }

  const base = truthStateOf(
    {
      data: facts.data,
      error: facts.error,
      isLoading: facts.isLoading,
      dataUpdatedAt: facts.dataUpdatedAt,
    },
    isEmpty,
  );
  if (
    facts.isFetching &&
    facts.data !== undefined &&
    (base.kind === 'verified' || base.kind === 'proven-empty')
  ) {
    return {
      kind: 'stale',
      verifiedAt: new Date(facts.dataUpdatedAt > 0 ? facts.dataUpdatedAt : 0),
      message: recheckMessage,
    };
  }
  return base;
}

export function memberRegisterTruthOf(facts: SeatsStandingTruthFacts<MembersView>): WitnessState {
  return registerTruthOf(
    facts,
    (view) => view.members.length === 0,
    'MEMBERS_UNAVAILABLE',
    'The access register is being checked again.',
  );
}

export function seatingApprovalsOf(data: ApprovalsView | undefined): readonly ApprovalSummaryDto[] {
  return (data?.approvals ?? [])
    .filter((approval) => MEMBER_OPERATIONS.has(approval.operationType))
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}

export function seatingRelayTruthOf(facts: SeatsStandingTruthFacts<ApprovalsView>): WitnessState {
  return registerTruthOf(
    facts,
    (view) => seatingApprovalsOf(view).length === 0,
    'SEATING_RELAY_UNAVAILABLE',
    'The seating relay is being checked again.',
  );
}

const isComplete = (truth: WitnessState): truth is Extract<WitnessState, { kind: 'verified' | 'proven-empty' }> =>
  truth.kind === 'verified' || truth.kind === 'proven-empty';

const completeAt = (truth: Extract<WitnessState, { kind: 'verified' | 'proven-empty' }>): Date => truth.at;

/** Window chrome is the aggregate witness. The two sections keep independent
 * artifacts, but the module never says Verified while either included read is
 * loading, stale, denied, or failed. */
export function joinSeatsStandingTruth(
  members: WitnessState,
  relay: WitnessState,
  relayIncluded = true,
): WitnessState {
  const sources: ReadonlyArray<{ readonly label: string; readonly state: WitnessState }> = [
    { label: 'members', state: members },
    ...(relayIncluded ? [{ label: 'seating-relay', state: relay }] : []),
  ];
  const denied = sources.filter((source) => source.state.kind === 'denied');
  if (denied.length > 0) {
    return {
      kind: 'denied',
      reasonClass: denied
        .map((source) => `${source.label}:${source.state.kind === 'denied' ? source.state.reasonClass : 'denied'}`)
        .join(','),
    };
  }
  const failed = sources.filter((source) => source.state.kind === 'fetch-failed');
  if (failed.length > 0) {
    return {
      kind: 'fetch-failed',
      message: failed
        .map((source) => `${source.label}: ${source.state.kind === 'fetch-failed' ? source.state.message : 'The request failed.'}`)
        .join(' '),
    };
  }
  if (sources.some((source) => source.state.kind === 'loading')) return { kind: 'loading' };
  const stale = sources.filter((source) => source.state.kind === 'stale');
  if (stale.length > 0) {
    const verifiedAt = stale
      .map((source) => (source.state.kind === 'stale' ? source.state.verifiedAt : new Date(0)))
      .reduce((left, right) => (left.getTime() <= right.getTime() ? left : right));
    return {
      kind: 'stale',
      verifiedAt,
      message: `${stale.map((source) => source.label).join(' and ')} ${stale.length === 1 ? 'is' : 'are'} stale; current standing may be incomplete.`,
    };
  }
  const complete = sources.filter((source): source is { readonly label: string; readonly state: Extract<WitnessState, { kind: 'verified' | 'proven-empty' }> } => isComplete(source.state));
  if (complete.length !== sources.length) {
    return { kind: 'fetch-failed', message: 'A Seats & Standing source has no current witness.' };
  }
  const at = new Date(Math.min(...complete.map((source) => completeAt(source.state).getTime())));
  if (complete.every((source) => source.state.kind === 'proven-empty')) return { kind: 'proven-empty', at };
  return { kind: 'verified', at };
}

export interface SeatChangeStanding {
  readonly label: string;
  readonly step: string;
  readonly variant: StatusVariant;
  readonly unsettled: boolean;
}

/** Approved is intentionally pending here. Approval is not execution and no
 * membership claim may borrow the generic approval badge's ready treatment. */
export function seatChangeStandingOf(status: ApprovalSummaryDto['status']): SeatChangeStanding {
  switch (status) {
    case 'Submitted':
      return { label: 'Request recorded · no access change', step: '01 · Request', variant: 'pending', unsettled: true };
    case 'InReview':
      return { label: 'Review underway · no access change', step: '02 · Review', variant: 'pending', unsettled: true };
    case 'Approved':
      return { label: 'Approved — not executed', step: '03 · Approval', variant: 'pending', unsettled: true };
    case 'Executed':
      return { label: 'Execution recorded · check current standing', step: '04 · Execution', variant: 'ready', unsettled: false };
    case 'ExecutionFailed':
      return { label: 'Execution failed · register unchanged', step: '04 · Execution', variant: 'blocked', unsettled: true };
    case 'Rejected':
      return { label: 'Rejected · register unchanged', step: 'Closed', variant: 'blocked', unsettled: false };
    case 'Withdrawn':
      return { label: 'Withdrawn · register unchanged', step: 'Closed', variant: 'neutral', unsettled: false };
  }
}

export interface SeatsStandingProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly requestKey?: string | number;
  readonly membersHref?: string;
  readonly approvalsHref?: string;
  readonly onTruthChange?: (truth: WitnessState) => void;
}

export function SeatsStanding({
  enabled = true,
  foreground = true,
  requestKey,
  membersHref = '/members',
  approvalsHref = '/approvals',
  onTruthChange,
}: SeatsStandingProps = {}) {
  const { me } = useSession();
  const canReadMembers = me?.capabilities.canReadMembers ?? false;
  const canReadApprovals =
    (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  // This is a Members-owned surface. Approval standing without Members
  // standing keeps its own register; it does not create a relay-only partial
  // view under a route the actor cannot otherwise read.
  const relayIncluded = canReadMembers && canReadApprovals;
  const membersEnabled = enabled && canReadMembers;
  const approvalsEnabled = enabled && relayIncluded;
  const membersQuery = useMembers(membersEnabled);
  const approvalsQuery = useApprovals(approvalsEnabled);
  const membersRewitnessing = useForegroundRewitness({
    foreground,
    enabled: membersEnabled,
    refetch: membersQuery.refetch,
    requestKey,
  });
  const approvalsRewitnessing = useForegroundRewitness({
    foreground,
    enabled: approvalsEnabled,
    refetch: approvalsQuery.refetch,
    requestKey,
  });
  const membersTruth = useMemo(
    () =>
      memberRegisterTruthOf({
        canRead: canReadMembers,
        data: membersQuery.data,
        error: membersQuery.error,
        isLoading: membersQuery.isLoading,
        isFetching: membersQuery.isFetching || membersRewitnessing,
        dataUpdatedAt: membersQuery.dataUpdatedAt,
      }),
    [
      canReadMembers,
      membersQuery.data,
      membersQuery.dataUpdatedAt,
      membersQuery.error,
      membersQuery.isFetching,
      membersQuery.isLoading,
      membersRewitnessing,
    ],
  );
  const relayTruth = useMemo(
    () =>
      seatingRelayTruthOf({
        canRead: relayIncluded,
        data: relayIncluded ? approvalsQuery.data : undefined,
        error: approvalsQuery.error,
        isLoading: approvalsQuery.isLoading,
        isFetching: approvalsQuery.isFetching || approvalsRewitnessing,
        dataUpdatedAt: approvalsQuery.dataUpdatedAt,
      }),
    [
      approvalsQuery.data,
      approvalsQuery.dataUpdatedAt,
      approvalsQuery.error,
      approvalsQuery.isFetching,
      approvalsQuery.isLoading,
      approvalsRewitnessing,
      relayIncluded,
    ],
  );
  const truth = useMemo(
    () => joinSeatsStandingTruth(membersTruth, relayTruth, relayIncluded),
    [membersTruth, relayIncluded, relayTruth],
  );
  const membersRechecking =
    membersQuery.data !== undefined && membersQuery.error == null && (membersQuery.isFetching || membersRewitnessing);
  const relayRechecking =
    approvalsQuery.data !== undefined && approvalsQuery.error == null && (approvalsQuery.isFetching || approvalsRewitnessing);

  useLayoutEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  const members = [...(membersQuery.data?.members ?? [])].sort((left, right) => {
    const selfOrder = Number(right.userId === me?.userId) - Number(left.userId === me?.userId);
    if (selfOrder !== 0) return selfOrder;
    if (left.isActive !== right.isActive) return Number(right.isActive) - Number(left.isActive);
    return left.displayName.localeCompare(right.displayName);
  });
  const approvals = seatingApprovalsOf(relayIncluded ? approvalsQuery.data : undefined);
  const activeMembers = members.filter((member) => member.isActive);
  const inactiveMembers = members.length - activeMembers.length;
  const activeRoles = new Map<MemberDto['role'], number>();
  for (const member of activeMembers) activeRoles.set(member.role, (activeRoles.get(member.role) ?? 0) + 1);
  const roleSummary = [...activeRoles.entries()].sort(([left], [right]) => left.localeCompare(right));
  const unsettled = approvals.filter((approval) => seatChangeStandingOf(approval.status).unsettled).length;

  return (
    <section className="seats-standing" data-tablework="SeatsStanding" data-truth={truth.kind}>
      <header className="seats-standing-intro">
        <span className="seats-standing-seal" aria-hidden="true"><i /><i /><i /></span>
        <span>
          <small>Access register · independently witnessed</small>
          <strong>Seats &amp; Standing</strong>
          <p>Which memberships are active, which records are inactive, and the base tenant role each row currently holds.</p>
        </span>
      </header>

      <p className="seats-standing-boundary">
        Access is a recorded membership, not a personnel profile. A base tenant role is not effective delegated authority, presence, licensing, or team membership.
      </p>

      <div className={`seats-standing-grid${relayIncluded ? '' : ' is-register-only'}`}>
        <section className="seats-standing-register" aria-labelledby="seats-standing-register-title">
          <header>
            <span>
              <small>01 · Current access</small>
              <h2 id="seats-standing-register-title">Members register</h2>
            </span>
            <Link className="secondary-action" to={membersHref}>Open governed register</Link>
          </header>

          <RecheckingTruthPanel
            state={membersTruth}
            rechecking={membersRechecking}
            emptyLabel="No memberships were returned. This is a verified register result, not an admission claim."
            testids={{
              loading: 'seats-members-loading',
              verified: 'seats-members-verified',
              empty: 'seats-members-empty',
              denied: 'seats-members-denied',
              failed: 'seats-members-failed',
              stale: 'seats-members-stale',
            }}
          >
            <div className="seats-standing-members-body">
              <div className="seats-standing-counts" aria-label="Membership counts">
                <span><strong>{members.length}</strong><small>Membership records</small></span>
                <span><strong>{activeMembers.length}</strong><small>Active seats</small></span>
                <span><strong>{inactiveMembers}</strong><small>Inactive records</small></span>
                <span><strong>{roleSummary.length}</strong><small>Base roles in use</small></span>
              </div>

              <div className="seats-standing-roles" aria-label="Active base tenant role distribution">
                <small>Active base-role distribution</small>
                <span>
                  {roleSummary.map(([role, count]) => <i key={role}>{role} · {count}</i>)}
                </span>
              </div>

              <ul className="seats-standing-roster" aria-label="Members access register">
                {members.map((member) => (
                  <li key={member.userId} data-testid={`seat-member-${member.userId}`}>
                    <span className="seats-standing-seat" aria-hidden="true"><i /></span>
                    <span className="seats-standing-person">
                      <strong>{member.displayName}</strong>
                      <small>{member.email}</small>
                    </span>
                    <span className="seats-standing-role">
                      <small>Base tenant role</small>
                      <strong>{member.role}</strong>
                    </span>
                    <span className="seats-standing-state">
                      {member.userId === me?.userId ? <em>This session</em> : null}
                      <StatusBadge variant={member.isActive ? 'ready' : 'neutral'}>
                        {member.isActive ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </RecheckingTruthPanel>
        </section>

        {relayIncluded ? <section className="seats-standing-relay" aria-labelledby="seats-standing-relay-title">
          <header>
            <span>
              <small>02 · Governed change</small>
              <h2 id="seats-standing-relay-title">Seating Relay</h2>
            </span>
            <Link className="secondary-action" to={approvalsHref}>Open Approvals</Link>
          </header>

          <p className="seats-standing-relay-law">
            A request or approval does not create a seat. In this governed relay, execution is the first stage that can change the Members register.
          </p>

          <RecheckingTruthPanel
            state={relayTruth}
            rechecking={relayRechecking}
            emptyLabel="No governed seat-change approvals are recorded in this view."
            testids={{
              loading: 'seating-relay-loading',
              verified: 'seating-relay-verified',
              empty: 'seating-relay-empty',
              denied: 'seating-relay-denied',
              failed: 'seating-relay-failed',
              stale: 'seating-relay-stale',
            }}
          >
            <div className="seats-standing-relay-summary">
              <strong>{unsettled}</strong>
              <span>Unexecuted seat-change relays in this witnessed view</span>
            </div>
            <ol className="seats-standing-relays" aria-label="Seat-change approvals">
              {approvals.map((approval) => {
                const standing = seatChangeStandingOf(approval.status);
                return (
                  <li key={approval.approvalId} data-testid={`seating-relay-${approval.approvalId}`}>
                    <span className="seats-standing-relay-line" aria-hidden="true"><i /></span>
                    <span className="seats-standing-relay-copy">
                      <small>{standing.step} · {approval.approvalId}</small>
                      <strong>{operationOf(approval.operationType)}</strong>
                      <span>Submitted by {approval.submittedBy}</span>
                    </span>
                    <StatusBadge variant={standing.variant}>{standing.label}</StatusBadge>
                    <Link to={`/approvals/${approval.approvalId}`} aria-label={`Open ${approval.approvalId}`}>↗</Link>
                  </li>
                );
              })}
            </ol>
          </RecheckingTruthPanel>

          <p className="seats-standing-relay-note">
            Approval summaries are payload-free. This relay names operation, status, submitter, and record only; it does not guess the target member or requested role.
          </p>
        </section> : (
          <aside className="seats-standing-relay-omitted">
            <small>02 · Governed change</small>
            <strong>Seating Relay is not included in this view.</strong>
            <p>The Members register remains the current access witness. No approval history is requested or shown in this surface.</p>
          </aside>
        )}
      </div>

      <footer className="seats-standing-footer">
        Temporary delegation is a separate authority register and is not summarized here. People, Members, Teams, and licensing remain distinct truths.
      </footer>
    </section>
  );
}
