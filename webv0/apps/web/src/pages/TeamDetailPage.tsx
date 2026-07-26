import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatRoiBps, suggestPersonnelCode } from '@c3web/domain';
import { usePeople, useTeam, useTeamAudit, useTeamFinance, useTeamMembers } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
// The pivot (Wave 2, Lane B): the frozen kit carries API-identical ports of
// every cross-cutting piece this hub uses — the import path IS the conversion
// for StatusBadge/AuditTimeline/GovernedAction; FactList replaces
// DefinitionList (same items API); Breadcrumbs do NOT port — RecordBackLink in
// the ContextHeader's intent bar is the route back (ruling #5).
import {
  TableworkGate,
  TableworkPage,
  RecordBackLink,
  RecordPage,
  RecordLink,
  ComparisonTable,
  FactList,
  StatusBadge,
  AuditTimeline,
  EmptyState,
  ErrorState,
  LoadingState,
  Field,
  Input,
  Selector,
  GovernedAction,
  type DefItem,
  type TimelineEntry,
} from '../tablework';
import { auditActionOf, formatMinor } from '../labels';

/**
 * Team page (S7) — the roster (direct-audited membership, reactivation
 * pattern) and THE report: per-team P&L with ROI%, aggregated from the
 * missions tagged to this division. Honest-null one level up: one mission
 * that cannot blend (missing FX rate) means NO team total — culprits named,
 * never a partial sum.
 */

const KIND_LABEL: Record<string, string> = { GameDivision: 'Game division', Department: 'Department' };

export function TeamDetailPage() {
  // The session gate mounts BEFORE any query hook: an anonymous deep link in
  // Entra mode must land on the deliberate sign-in screen, not fire 401s into
  // acquireTokenRedirect. The band's record NAME comes from data, so the body
  // (not this wrapper) renders TableworkPage.
  const { teamId = '' } = useParams();
  return (
    <TableworkGate>
      <TeamDetailBody teamId={teamId} />
    </TableworkGate>
  );
}

function TeamDetailBody({ teamId }: { teamId: string }) {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageEntities ?? false;
  const canFinance = me?.capabilities.canViewFinancials ?? false;

  const team = useTeam(teamId);
  const members = useTeamMembers(teamId);
  // The capability IS the `enabled` flag: the per-team money view is never
  // fetched for a role without financial standing.
  const finance = useTeamFinance(teamId, canFinance);
  const audit = useTeamAudit(teamId);
  const people = usePeople();

  const [addPersonId, setAddPersonId] = useState('');
  const [addRole, setAddRole] = useState('Player');
  const [edit, setEdit] = useState<{ name: string; code: string; gameTitle: string } | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['team', teamId] });
    void qc.invalidateQueries({ queryKey: ['teams'] });
    void qc.invalidateQueries({ queryKey: ['teamMembers', teamId] });
    void qc.invalidateQueries({ queryKey: ['teamAudit', teamId] });
  };

  async function run(fn: () => Promise<unknown>, message: string): Promise<void> {
    try {
      await fn();
      notify('success', message);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  const t = team.data?.team;
  const activeMembers = (members.data?.members ?? []).filter((m) => m.isActive);
  const takenCodes = (people.data?.people ?? []).map((p) => p.personnelCode);
  const suggestion = t && addRole.trim() !== '' ? suggestPersonnelCode(t.code, addRole, takenCodes) : null;
  const addablePeople = (people.data?.people ?? []).filter((p) => p.isActive);

  const items: DefItem[] = t
    ? [
        { label: 'Code', value: <span data-testid="team-detail-code">{t.code}</span> },
        { label: 'Kind', value: KIND_LABEL[t.kind] ?? t.kind },
        { label: 'Game', value: t.gameTitle ?? null },
        {
          label: 'Status',
          value: (
            <StatusBadge variant={t.isActive ? 'ready' : 'neutral'} data-testid="team-detail-status">
              {t.isActive ? 'Active' : 'Inactive'}
            </StatusBadge>
          ),
        },
        { label: 'Active members', value: <span data-testid="team-member-count">{String(activeMembers.length)}</span> },
      ]
    : [];

  const entries: TimelineEntry[] = (audit.data?.events ?? []).map((e) => ({
    at: e.at,
    label: auditActionOf(e.action),
    actor: e.actor,
    detail: null,
  }));

  const fin = finance.data?.finance;
  const title = t ? t.name : teamId;

  return (
    <TableworkPage record={title} section="Team" actions={<RecordBackLink to="/teams">Back to teams</RecordBackLink>}>
      <RecordPage
        eyebrow="Team"
        title={title}
        documentTitle={title}
        actions={
          canManage && t ? (
            <>
              {t.isActive && (
                <GovernedAction
                  triggerLabel="Edit…"
                  triggerTestId="edit-team"
                  triggerAppearance="secondary"
                  title={`Edit ${t.teamId}?`}
                  description="Changes take effect immediately; what changed is recorded in the audit history."
                  extra={
                    <>
                      <Field label="Name" required>
                        <Input
                          value={(edit ?? { name: t.name }).name}
                          onChange={(e) => setEdit({ ...(edit ?? { name: t.name, code: t.code, gameTitle: t.gameTitle ?? '' }), name: e.target.value })}
                          data-testid="edit-team-name"
                        />
                      </Field>
                      <Field label="Code" required>
                        <Input
                          value={(edit ?? { code: t.code }).code ?? t.code}
                          onChange={(e) => setEdit({ ...(edit ?? { name: t.name, code: t.code, gameTitle: t.gameTitle ?? '' }), code: e.target.value.toUpperCase() })}
                          data-testid="edit-team-code"
                        />
                      </Field>
                      <Field label="Game title">
                        <Input
                          value={(edit ?? { gameTitle: t.gameTitle ?? '' }).gameTitle ?? t.gameTitle ?? ''}
                          onChange={(e) => setEdit({ ...(edit ?? { name: t.name, code: t.code, gameTitle: t.gameTitle ?? '' }), gameTitle: e.target.value })}
                        />
                      </Field>
                    </>
                  }
                  confirmLabel="Save team"
                  onConfirm={() =>
                    run(
                      () =>
                        // expectedVersion reads the SERVER row, never a local
                        // edit map — that freshness is what turns a rejected
                        // concurrent edit into a rejection instead of a
                        // silent overwrite.
                        api.updateTeam(t.teamId, {
                          expectedVersion: t.version,
                          name: (edit?.name ?? t.name).trim(),
                          code: (edit?.code ?? t.code).trim(),
                          gameTitle: (edit?.gameTitle ?? t.gameTitle ?? '').trim() === '' ? null : (edit?.gameTitle ?? t.gameTitle ?? '').trim(),
                        }),
                      'Team updated and recorded.',
                    ).then(() => setEdit(null))
                  }
                />
              )}
              {t.isActive ? (
                <GovernedAction
                  triggerLabel="Deactivate…"
                  triggerTestId="deactivate-team"
                  triggerAppearance="secondary"
                  title={`Deactivate ${t.teamId}?`}
                  description="The team becomes inactive (history preserved; memberships stay recorded). Reactivation is available any time."
                  confirmLabel="Deactivate team"
                  onConfirm={() => run(() => api.deactivateTeam(t.teamId, t.version), 'Team deactivated and recorded.')}
                />
              ) : (
                <GovernedAction
                  triggerLabel="Reactivate…"
                  triggerTestId="reactivate-team"
                  triggerAppearance="secondary"
                  title={`Reactivate ${t.teamId}?`}
                  description="The team becomes active again. Recorded in the audit history."
                  confirmLabel="Reactivate team"
                  onConfirm={() => run(() => api.reactivateTeam(t.teamId, t.version), 'Team reactivated and recorded.')}
                />
              )}
            </>
          ) : undefined
        }
      >
        {team.isLoading && <LoadingState label="Loading team…" />}
        {team.isError && (
          <ErrorState
            message={team.error instanceof ApiError && team.error.status === 404 ? `No team ${teamId} in your tenant.` : 'Could not load this team.'}
            correlationId={team.error instanceof ApiError ? team.error.correlationId : undefined}
          />
        )}

        {t && (
          <>
            <FactList items={items} />

            {/* ── roster ───────────────────────────────────────────────────── */}
            <section className="record-section" data-testid="team-roster">
              <div className="record-section-head">
                <h2>Roster</h2>
                {canManage && t.isActive && (
                  <GovernedAction
                    triggerLabel="Add member…"
                    triggerTestId="add-team-member"
                    title={`Add a member to ${t.name}`}
                    description="Membership is organizational structure — immediate and recorded. History is kept when members leave."
                    extra={
                      <>
                        <Field label="Person" required>
                          <Selector
                            data-testid="add-team-member-person"
                            value={addPersonId}
                            options={addablePeople.map((p) => ({ value: p.personId, label: `${p.fullName} (${p.personId})` }))}
                            onSelect={(value) => setAddPersonId(value)}
                          />
                        </Field>
                        <Field label="Role on the team" required>
                          <Input value={addRole} onChange={(e) => setAddRole(e.target.value)} data-testid="add-team-member-role" />
                        </Field>
                        {suggestion && (
                          <span className="record-quiet" data-testid="personnel-code-suggestion">
                            Suggested personnel code: <strong>{suggestion}</strong> (copy it onto the person — codes stay free-text truth)
                          </span>
                        )}
                      </>
                    }
                    confirmLabel="Add member"
                    confirmDisabled={addPersonId === '' || addRole.trim() === ''}
                    onConfirm={() =>
                      run(() => api.addTeamMember(t.teamId, addPersonId, addRole.trim()), 'Member added and recorded.').then(() => {
                        setAddPersonId('');
                      })
                    }
                  />
                )}
              </div>

              {members.data && members.data.members.length === 0 && (
                <p className="record-quiet" data-testid="team-roster-empty">
                  No members yet.
                </p>
              )}
              {members.data && members.data.members.length > 0 && (
                <ComparisonTable label="Team roster" testId="team-members-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Status</th>
                      {canManage && <th aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {members.data.members.map((m) => (
                      <tr key={m.personId} data-testid={`team-member-row-${m.personId}`}>
                        <td>
                          <RecordLink to={`/people/${m.personId}`}>{m.personId}</RecordLink>
                        </td>
                        <td>{m.personName}</td>
                        <td>{m.role}</td>
                        <td>
                          <StatusBadge variant={m.isActive ? 'ready' : 'neutral'} data-testid={`team-member-status-${m.personId}`}>
                            {m.isActive ? 'Active' : 'Former'}
                          </StatusBadge>
                        </td>
                        {canManage && (
                          <td>
                            {m.isActive && t.isActive && (
                              <GovernedAction
                                triggerLabel="Remove…"
                                triggerTestId={`remove-team-member-${m.personId}`}
                                triggerAppearance="secondary"
                                title={`Remove ${m.personName} from ${t.name}?`}
                                description="The membership flips to former — history is preserved, and re-adding later reuses the same record."
                                confirmLabel="Remove member"
                                onConfirm={() => run(() => api.removeTeamMember(t.teamId, m.personId, m.version), 'Member removed and recorded.')}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </ComparisonTable>
              )}
            </section>

            {/* ── the report: per-team P&L + ROI% (finance-gated) ──────────── */}
            {canFinance && (
              <section className="record-section" data-testid="team-finance">
                <h2>Profit &amp; loss — this team's missions</h2>
                {finance.isLoading && <LoadingState label="Aggregating…" />}
                {fin && fin.missions.length === 0 && (
                  <p className="record-quiet" data-testid="team-finance-empty">
                    No missions are tagged to this team yet — tag them on the mission page.
                  </p>
                )}
                {fin && fin.unblendableMissions.length > 0 && (
                  <p className="record-quiet danger record-note" data-testid="team-finance-unblendable">
                    {`No team total: ${fin.unblendableMissions.join(', ')} cannot blend to USD (missing exchange rates — Settings → Exchange rates).`}
                  </p>
                )}
                {fin && fin.missions.length > 0 && (
                  <ComparisonTable label="Per-team P&L" testId="team-finance-table">
                    <thead>
                      <tr>
                        <th>Mission</th>
                        <th>Code</th>
                        <th>Stage</th>
                        <th>Income ≈USD</th>
                        <th>Expense ≈USD</th>
                        <th>Profit ≈USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fin.missions.map((m) => (
                        <tr key={m.missionId} data-testid={`team-finance-row-${m.missionId}`}>
                          <td>
                            <RecordLink to={`/missions/${m.missionId}`}>{m.missionId}</RecordLink> {m.name}
                          </td>
                          <td className="mono">{m.code ?? '—'}</td>
                          <td>{m.financeStage}</td>
                          {/* The guard is the BLENDED OBJECT, never a truthy
                              amount: a real 0 must print its money, and the
                              false branch names the missing-rate culprits. */}
                          <td className="mono">{m.blended ? formatMinor(m.blended.incomeUsdMinor, 'USD') : `— (${m.missingRates.join(', ')})`}</td>
                          <td className="mono">{m.blended ? formatMinor(m.blended.expenseUsdMinor, 'USD') : '—'}</td>
                          <td className="mono">{m.blended ? formatMinor(m.blended.profitUsdMinor, 'USD') : '—'}</td>
                        </tr>
                      ))}
                      {/* Totals come from the SERVER or not at all — never a
                          sum of visible rows: the server withholds the total
                          when any mission is unblendable, and synthesizing one
                          here would invent a number nobody can stand behind.
                          `roiBps !== null` stays a null check: 0 is a real
                          break-even, and truthiness would report "no expense
                          base" for a team that broke even. */}
                      {fin.totals && (
                        <tr className="total-row" data-testid="team-finance-totals">
                          <td colSpan={3}>{`Total · ROI ${fin.roiBps !== null ? formatRoiBps(fin.roiBps) : '— (no expense base)'}`}</td>
                          <td className="mono">{formatMinor(fin.totals.incomeUsdMinor, 'USD')}</td>
                          <td className="mono">{formatMinor(fin.totals.expenseUsdMinor, 'USD')}</td>
                          <td className="mono" data-testid="team-finance-profit">
                            {formatMinor(fin.totals.profitUsdMinor, 'USD')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </ComparisonTable>
                )}
              </section>
            )}

            {/* ── history ──────────────────────────────────────────────────── */}
            <section className="record-section">
              <h2>History</h2>
              <AuditTimeline entries={entries} testId="team-audit" emptyMessage="No events recorded yet." />
            </section>
          </>
        )}
        {!t && !team.isLoading && !team.isError && <EmptyState message="No team." />}
      </RecordPage>
    </TableworkPage>
  );
}
