import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Dropdown, Field, Input, Option, makeStyles } from '@fluentui/react-components';
import { formatRoiBps, suggestPersonnelCode } from '@c3web/domain';
import { usePeople, useTeam, useTeamAudit, useTeamFinance, useTeamMembers } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { DefinitionList, type DefItem } from '../components/DefinitionList';
import { StatusBadge } from '../components/StatusBadge';
import { AuditTimeline, type TimelineEntry } from '../components/AuditTimeline';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { auditActionOf, formatMinor } from '../labels';

/**
 * Team page (S7) — the roster (direct-audited membership, reactivation
 * pattern) and THE report: per-team P&L with ROI%, aggregated from the
 * missions tagged to this division. Honest-null one level up: one mission
 * that cannot blend (missing FX rate) means NO team total — culprits named,
 * never a partial sum.
 */

const useStyles = makeStyles({
  section: { marginTop: '28px' },
  h2Row: { display: 'flex', alignItems: 'center', columnGap: '16px', marginBottom: '12px' },
  h2: { fontSize: '16px', fontWeight: 600, color: 'var(--c3-ink)', margin: 0 },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '10px', minWidth: '320px' },
  hint: { fontSize: '12px', color: 'var(--c3-ink-muted)' },
  notice: { fontSize: '13px', color: 'var(--c3-attention)', margin: '8px 0' },
  totalRow: { fontWeight: 600 },
});

const KIND_LABEL: Record<string, string> = { GameDivision: 'Game division', Department: 'Department' };

export function TeamDetailPage() {
  const { teamId = '' } = useParams();
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageEntities ?? false;
  const canFinance = me?.capabilities.canViewFinancials ?? false;

  const team = useTeam(teamId);
  const members = useTeamMembers(teamId);
  const finance = useTeamFinance(teamId, canFinance);
  const audit = useTeamAudit(teamId);
  const people = usePeople();

  const [addPersonId, setAddPersonId] = useState('');
  const [addPersonLabel, setAddPersonLabel] = useState('');
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

  return (
    <div>
      <PageHeader
        kicker="Team"
        title={t ? t.name : teamId}
        breadcrumbs={<Breadcrumbs crumbs={[{ label: 'Teams', to: '/teams' }, { label: teamId }]} />}
        actions={
          canManage && t ? (
            <div style={{ display: 'flex', columnGap: '8px' }}>
              {t.isActive && (
                <GovernedAction
                  triggerLabel="Edit…"
                  triggerTestId="edit-team"
                  triggerAppearance="secondary"
                  title={`Edit ${t.teamId}?`}
                  description="Changes take effect immediately; what changed is recorded in the audit history."
                  extra={
                    <div className={s.fields}>
                      <Field label="Name" required>
                        <Input
                          value={(edit ?? { name: t.name }).name}
                          onChange={(_, d) => setEdit({ ...(edit ?? { name: t.name, code: t.code, gameTitle: t.gameTitle ?? '' }), name: d.value })}
                          data-testid="edit-team-name"
                        />
                      </Field>
                      <Field label="Code" required>
                        <Input
                          value={(edit ?? { code: t.code }).code ?? t.code}
                          onChange={(_, d) => setEdit({ ...(edit ?? { name: t.name, code: t.code, gameTitle: t.gameTitle ?? '' }), code: d.value.toUpperCase() })}
                          data-testid="edit-team-code"
                        />
                      </Field>
                      <Field label="Game title">
                        <Input
                          value={(edit ?? { gameTitle: t.gameTitle ?? '' }).gameTitle ?? t.gameTitle ?? ''}
                          onChange={(_, d) => setEdit({ ...(edit ?? { name: t.name, code: t.code, gameTitle: t.gameTitle ?? '' }), gameTitle: d.value })}
                        />
                      </Field>
                    </div>
                  }
                  confirmLabel="Save team"
                  onConfirm={() =>
                    run(
                      () =>
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
            </div>
          ) : undefined
        }
      />

      {team.isLoading && <LoadingState label="Loading team…" />}
      {team.isError && (
        <ErrorState
          message={team.error instanceof ApiError && team.error.status === 404 ? `No team ${teamId} in your tenant.` : 'Could not load this team.'}
          correlationId={team.error instanceof ApiError ? team.error.correlationId : undefined}
        />
      )}

      {t && (
        <>
          <DefinitionList items={items} />

          {/* ── roster ─────────────────────────────────────────────────────── */}
          <section className={s.section} data-testid="team-roster">
            <div className={s.h2Row}>
              <h2 className={s.h2}>Roster</h2>
              {canManage && t.isActive && (
                <GovernedAction
                  triggerLabel="Add member…"
                  triggerTestId="add-team-member"
                  title={`Add a member to ${t.name}`}
                  description="Membership is organizational structure — immediate and recorded. History is kept when members leave."
                  extra={
                    <div className={s.fields}>
                      <Field label="Person" required>
                        <Dropdown
                          value={addPersonLabel}
                          selectedOptions={addPersonId ? [addPersonId] : []}
                          onOptionSelect={(_, d) => {
                            if (d.optionValue) {
                              setAddPersonId(d.optionValue);
                              setAddPersonLabel(d.optionText ?? d.optionValue);
                            }
                          }}
                          data-testid="add-team-member-person"
                        >
                          {(people.data?.people ?? [])
                            .filter((p) => p.isActive)
                            .map((p) => (
                              <Option key={p.personId} value={p.personId} text={`${p.fullName} (${p.personId})`}>
                                {`${p.fullName} (${p.personId})`}
                              </Option>
                            ))}
                        </Dropdown>
                      </Field>
                      <Field label="Role on the team" required>
                        <Input value={addRole} onChange={(_, d) => setAddRole(d.value)} data-testid="add-team-member-role" />
                      </Field>
                      {suggestion && (
                        <span className={s.hint} data-testid="personnel-code-suggestion">
                          Suggested personnel code: <strong>{suggestion}</strong> (copy it onto the person — codes stay free-text truth)
                        </span>
                      )}
                    </div>
                  }
                  confirmLabel="Add member"
                  confirmDisabled={addPersonId === '' || addRole.trim() === ''}
                  onConfirm={() =>
                    run(() => api.addTeamMember(t.teamId, addPersonId, addRole.trim()), 'Member added and recorded.').then(() => {
                      setAddPersonId('');
                      setAddPersonLabel('');
                    })
                  }
                />
              )}
            </div>

            {members.data && members.data.members.length === 0 && <p data-testid="team-roster-empty">No members yet.</p>}
            {members.data && members.data.members.length > 0 && (
              <table className={r.table} data-testid="team-members-table" aria-label="Team roster">
                <thead>
                  <tr>
                    <th className={r.th}>Person</th>
                    <th className={r.th}>Name</th>
                    <th className={r.th}>Role</th>
                    <th className={r.th}>Status</th>
                    {canManage && <th className={r.th} aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {members.data.members.map((m) => (
                    <tr key={m.personId} className={r.row} data-testid={`team-member-row-${m.personId}`}>
                      <td className={r.td}>
                        <Link className={r.idLink} to={`/people/${m.personId}`}>
                          {m.personId}
                        </Link>
                      </td>
                      <td className={`${r.td} ${r.name}`}>{m.personName}</td>
                      <td className={r.td}>{m.role}</td>
                      <td className={r.td}>
                        <StatusBadge variant={m.isActive ? 'ready' : 'neutral'} data-testid={`team-member-status-${m.personId}`}>
                          {m.isActive ? 'Active' : 'Former'}
                        </StatusBadge>
                      </td>
                      {canManage && (
                        <td className={r.td}>
                          {m.isActive && t.isActive && (
                            <GovernedAction
                              triggerLabel="Remove…"
                              triggerTestId={`remove-team-member-${m.personId}`}
                              triggerAppearance="secondary"
                              title={`Remove ${m.personName} from ${t.name}?`}
                              description="The membership flips to former — history is preserved, and re-adding later reuses the same record."
                              confirmLabel="Remove member"
                              onConfirm={() => run(() => api.removeTeamMember(t.teamId, m.personId), 'Member removed and recorded.')}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ── the report: per-team P&L + ROI% (finance-gated) ────────────── */}
          {canFinance && (
            <section className={s.section} data-testid="team-finance">
              <div className={s.h2Row}>
                <h2 className={s.h2}>Profit &amp; loss — this team's missions</h2>
              </div>
              {finance.isLoading && <LoadingState label="Aggregating…" />}
              {fin && fin.missions.length === 0 && (
                <p data-testid="team-finance-empty">No missions are tagged to this team yet — tag them on the mission page.</p>
              )}
              {fin && fin.unblendableMissions.length > 0 && (
                <p className={s.notice} data-testid="team-finance-unblendable">
                  {`No team total: ${fin.unblendableMissions.join(', ')} cannot blend to USD (missing exchange rates — Settings → Exchange rates).`}
                </p>
              )}
              {fin && fin.missions.length > 0 && (
                <table className={r.table} data-testid="team-finance-table" aria-label="Per-team P&L">
                  <thead>
                    <tr>
                      <th className={r.th}>Mission</th>
                      <th className={r.th}>Code</th>
                      <th className={r.th}>Stage</th>
                      <th className={r.th}>Income ≈USD</th>
                      <th className={r.th}>Expense ≈USD</th>
                      <th className={r.th}>Profit ≈USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fin.missions.map((m) => (
                      <tr key={m.missionId} className={r.row} data-testid={`team-finance-row-${m.missionId}`}>
                        <td className={r.td}>
                          <Link className={r.idLink} to={`/missions/${m.missionId}`}>
                            {m.missionId}
                          </Link>{' '}
                          {m.name}
                        </td>
                        <td className={`${r.td} ${r.mono}`}>{m.code ?? '—'}</td>
                        <td className={r.td}>{m.financeStage}</td>
                        <td className={`${r.td} ${r.mono}`}>{m.blended ? formatMinor(m.blended.incomeUsdMinor, 'USD') : `— (${m.missingRates.join(', ')})`}</td>
                        <td className={`${r.td} ${r.mono}`}>{m.blended ? formatMinor(m.blended.expenseUsdMinor, 'USD') : '—'}</td>
                        <td className={`${r.td} ${r.mono}`}>{m.blended ? formatMinor(m.blended.profitUsdMinor, 'USD') : '—'}</td>
                      </tr>
                    ))}
                    {fin.totals && (
                      <tr className={`${r.row} ${s.totalRow}`} data-testid="team-finance-totals">
                        <td className={r.td} colSpan={3}>
                          {`Total · ROI ${fin.roiBps !== null ? formatRoiBps(fin.roiBps) : '— (no expense base)'}`}
                        </td>
                        <td className={`${r.td} ${r.mono}`}>{formatMinor(fin.totals.incomeUsdMinor, 'USD')}</td>
                        <td className={`${r.td} ${r.mono}`}>{formatMinor(fin.totals.expenseUsdMinor, 'USD')}</td>
                        <td className={`${r.td} ${r.mono}`} data-testid="team-finance-profit">
                          {formatMinor(fin.totals.profitUsdMinor, 'USD')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {/* ── history ────────────────────────────────────────────────────── */}
          <section className={s.section}>
            <div className={s.h2Row}>
              <h2 className={s.h2}>History</h2>
            </div>
            <AuditTimeline entries={entries} testId="team-audit" emptyMessage="No events recorded yet." />
          </section>
        </>
      )}
      {!t && !team.isLoading && !team.isError && <EmptyState message="No team." />}
    </div>
  );
}
