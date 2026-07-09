import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Dropdown, Field, Input, Option, makeStyles } from '@fluentui/react-components';
import { CURRENCY_CODES } from '@c3web/api-contracts';
import { formatMoney, missionDayCount } from '@c3web/domain';
import { useMission, useMissionAudit, useMissionParticipants, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { DefinitionList } from '../components/DefinitionList';
import { StatusBadge } from '../components/StatusBadge';
import { AuditTimeline, type TimelineEntry } from '../components/AuditTimeline';
import { ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { auditActionOf } from '../labels';

/**
 * MissionDetailPage (Sprint 39) — the operational hub for one mission. The
 * SHELL actions (edit/deactivate) are direct-audited: immediate and recorded.
 * The ROSTER is governed: adding or removing a participant submits an
 * approval an owner must review and execute — the dialogs say so honestly.
 */

const useStyles = makeStyles({
  section: { marginTop: '32px' },
  h2: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, color: 'var(--c3-command-black)', margin: '0 0 12px' },
  headerActions: { display: 'flex', columnGap: '8px', flexWrap: 'wrap' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '8px' },
  personSelect: { minWidth: '260px' },
  rosterIntro: { fontSize: '13px', color: 'var(--c3-ink-70)', margin: '0 0 12px' },
});

export function MissionDetailPage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { missionId = '' } = useParams();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useMission(missionId);
  const participants = useMissionParticipants(missionId);
  const canManage = me?.capabilities.canManageMissions ?? false;
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const canViewPerDiem = me?.capabilities.canViewPerDiem ?? false;
  const [perDiemDraft, setPerDiemDraft] = useState<Record<string, { amount: string; currency: string }>>({});
  const canViewHistory = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const audit = useMissionAudit(missionId, canViewHistory);
  const people = usePeople(canSubmit);

  const [edit, setEdit] = useState<{ name: string; gameTitle: string; startsOn: string; endsOn: string } | null>(null);
  const [addPersonId, setAddPersonId] = useState('');
  const [addPersonLabel, setAddPersonLabel] = useState('');
  const [addRole, setAddRole] = useState('');

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['mission', missionId] });
    void qc.invalidateQueries({ queryKey: ['missions'] });
    void qc.invalidateQueries({ queryKey: ['missionAudit', missionId] });
  };

  if (isError) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <div>
        <PageHeader title="Mission" breadcrumbs={<Breadcrumbs crumbs={[{ label: 'Missions', to: '/missions' }, { label: missionId }]} />} />
        <ErrorState
          data-testid="mission-error"
          message={is404 ? `No mission ${missionId} in your tenant.` : 'Could not load this mission.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      </div>
    );
  }

  const m = data?.mission;
  const title = m?.name ?? (isLoading ? 'Loading…' : missionId);
  const editState = edit ?? {
    name: m?.name ?? '',
    gameTitle: m?.gameTitle ?? '',
    startsOn: m?.startsOn ?? '',
    endsOn: m?.endsOn ?? '',
  };
  const roster = participants.data?.participants ?? [];
  const entries: TimelineEntry[] = (audit.data?.events ?? []).map((e) => ({
    at: e.at,
    label: auditActionOf(e.action),
    actor: e.actor,
  }));

  async function run<T>(fn: () => Promise<T>, successMessage: (result: T) => string): Promise<void> {
    try {
      const result = await fn();
      notify('success', successMessage(result));
      invalidate();
      void qc.invalidateQueries({ queryKey: ['missionParticipants', missionId] });
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  const shellActions =
    m && canManage && m.isActive ? (
      <div className={s.headerActions}>
        <GovernedAction
          triggerLabel="Edit…"
          triggerTestId={`edit-mission-${m.missionId}`}
          triggerAppearance="secondary"
          title={`Edit ${m.missionId}?`}
          description="Changes take effect immediately; what changed is recorded in the audit history."
          extra={
            <div className={s.fields}>
              <Field label="Name" required>
                <Input value={editState.name} onChange={(_, d) => setEdit({ ...editState, name: d.value })} data-testid={`edit-mission-name-${m.missionId}`} />
              </Field>
              <Field label="Game title">
                <Input value={editState.gameTitle} onChange={(_, d) => setEdit({ ...editState, gameTitle: d.value })} />
              </Field>
              <Field label="Starts on" required>
                <Input type="date" value={editState.startsOn} onChange={(_, d) => setEdit({ ...editState, startsOn: d.value })} />
              </Field>
              <Field label="Ends on">
                <Input type="date" value={editState.endsOn} onChange={(_, d) => setEdit({ ...editState, endsOn: d.value })} data-testid={`edit-mission-ends-${m.missionId}`} />
              </Field>
            </div>
          }
          confirmLabel="Save changes"
          confirmDisabled={editState.name.trim() === '' || !/^\d{4}-\d{2}-\d{2}$/.test(editState.startsOn)}
          onConfirm={() =>
            run(
              () =>
                api.updateMission(m.missionId, {
                  expectedVersion: m.version,
                  name: editState.name.trim(),
                  gameTitle: editState.gameTitle.trim() === '' ? null : editState.gameTitle.trim(),
                  startsOn: editState.startsOn,
                  endsOn: editState.endsOn === '' ? null : editState.endsOn,
                }),
              () => `${m.missionId} updated and recorded.`,
            ).then(() => setEdit(null))
          }
        />
        <GovernedAction
          triggerLabel="Deactivate…"
          triggerTestId={`deactivate-mission-${m.missionId}`}
          triggerAppearance="secondary"
          title={`Deactivate ${m.missionId}?`}
          description="This retires the mission immediately and is recorded. The roster history is preserved; participants can still be removed through approval."
          confirmLabel="Deactivate"
          onConfirm={() => run(() => api.deactivateMission(m.missionId, m.version), () => `${m.missionId} deactivated and recorded.`)}
        />
      </div>
    ) : undefined;

  const addReady = addPersonId !== '' && addRole.trim() !== '';

  return (
    <div>
      <PageHeader
        title={title}
        titleTestId="mission-title"
        breadcrumbs={<Breadcrumbs crumbs={[{ label: 'Missions', to: '/missions' }, { label: title }]} />}
        actions={shellActions}
      />
      {isLoading && <LoadingState label="Loading mission…" />}
      {m && (
        <>
          <DefinitionList
            items={[
              { label: 'Mission ID', value: m.missionId, mono: true, testId: 'mission-id' },
              { label: 'Game title', value: m.gameTitle ?? null },
              { label: 'Starts on', value: m.startsOn },
              { label: 'Ends on', value: m.endsOn ?? null },
              {
                label: 'Status',
                value: (
                  <StatusBadge variant={m.isActive ? 'ready' : 'neutral'} data-testid="mission-status">
                    {m.isActive ? 'Active' : 'Inactive'}
                  </StatusBadge>
                ),
              },
            ]}
          />

          <div className={s.section}>
            <h2 className={s.h2}>Participants</h2>
            {canSubmit && (
              <p className={s.rosterIntro}>
                Roster changes go through approval — an owner must review and execute before membership changes.
              </p>
            )}
            {canSubmit && m.isActive && (
              <div className={s.fields} style={{ maxWidth: '440px', marginBottom: '16px' }}>
                <Field label="Person" required>
                  <Dropdown
                    className={s.personSelect}
                    placeholder="Select a person"
                    value={addPersonLabel}
                    selectedOptions={addPersonId ? [addPersonId] : []}
                    onOptionSelect={(_, d) => {
                      if (d.optionValue) {
                        setAddPersonId(d.optionValue);
                        setAddPersonLabel(d.optionText ?? d.optionValue);
                      }
                    }}
                    data-testid="add-participant-person"
                  >
                    {(people.data?.people ?? []).map((p) => (
                      <Option key={p.personId} value={p.personId} text={`${p.fullName} (${p.personId})`}>
                        {`${p.fullName} (${p.personId})`}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                <Field label="Mission role" required>
                  <Input value={addRole} onChange={(_, d) => setAddRole(d.value)} data-testid="add-participant-role" />
                </Field>
                <div>
                  <GovernedAction
                    triggerLabel="Submit for approval"
                    triggerTestId="add-participant-submit"
                    triggerDisabled={!addReady}
                    title="Request adding this participant?"
                    description="Once submitted, this request can’t be edited. It goes to an approver for review; the person joins the roster only when an owner executes it."
                    confirmLabel="Submit for approval"
                    onConfirm={() =>
                      run(
                        () => api.submitAddMissionParticipant({ missionId: m.missionId, personId: addPersonId, role: addRole.trim() }),
                        (res) => `Submitted ${res.approval.approvalId} for approval. The roster is unchanged until an owner executes it.`,
                      ).then(() => {
                        setAddPersonId('');
                        setAddPersonLabel('');
                        setAddRole('');
                      })
                    }
                  />
                </div>
              </div>
            )}
            {roster.length === 0 && <p data-testid="participants-empty">No participants yet.</p>}
            {roster.length > 0 && (
              <table className={r.table} data-testid="participants-table" aria-label="Mission participants">
                <thead>
                  <tr>
                    <th className={r.th}>Person</th>
                    <th className={r.th}>Name</th>
                    <th className={r.th}>Role</th>
                    {canViewPerDiem && <th className={r.th}>Per-diem</th>}
                    <th className={r.th}>Status</th>
                    {canSubmit && <th className={r.th}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((p) => (
                    <tr key={p.personId} className={r.row} data-testid={`participant-row-${p.personId}`}>
                      <td className={r.td}>
                        <Link className={r.idLink} to={`/people/${p.personId}`}>
                          {p.personId}
                        </Link>
                      </td>
                      <td className={`${r.td} ${r.name}`}>{p.personName}</td>
                      <td className={r.td}>{p.role}</td>
                      {canViewPerDiem && (
                        <td className={`${r.td} ${r.mono}`} data-testid={`participant-perdiem-${p.personId}`}>
                          {p.perDiemAmountMinor != null && p.perDiemCurrency ? (
                            (() => {
                              const days = missionDayCount(m.startsOn, m.endsOn);
                              const daily = formatMoney(p.perDiemAmountMinor, p.perDiemCurrency);
                              return days != null
                                ? `${daily}/day · ${formatMoney(p.perDiemAmountMinor * days, p.perDiemCurrency)} (${days}d)`
                                : `${daily}/day`;
                            })()
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      <td className={r.td}>
                        <StatusBadge variant={p.isActive ? 'ready' : 'neutral'} data-testid={`participant-status-${p.personId}`}>
                          {p.isActive ? 'Active' : 'Removed'}
                        </StatusBadge>
                      </td>
                      {canSubmit && (
                        <td className={r.td}>
                          {p.isActive && (
                            <div style={{ display: 'flex', columnGap: '8px', flexWrap: 'wrap' }}>
                              {canManage &&
                                (() => {
                                  const draft = perDiemDraft[p.personId] ?? {
                                    amount: p.perDiemAmountMinor != null ? String(p.perDiemAmountMinor / 100) : '',
                                    currency: p.perDiemCurrency ?? 'USD',
                                  };
                                  const setDraft = (patch: Partial<{ amount: string; currency: string }>) =>
                                    setPerDiemDraft((c) => ({ ...c, [p.personId]: { ...draft, ...patch } }));
                                  const amt = draft.amount.trim();
                                  const validAmt = amt === '' || (!Number.isNaN(Number(amt)) && Number(amt) >= 0);
                                  return (
                                    <GovernedAction
                                      triggerLabel="Per-diem…"
                                      triggerTestId={`perdiem-participant-${p.personId}`}
                                      triggerAppearance="secondary"
                                      title={`Set ${p.personId}'s per-diem?`}
                                      description="This is the daily rate for this person on this mission. It takes effect immediately and is recorded. Leave the amount empty to clear it."
                                      extra={
                                        <div className={s.fields}>
                                          <Field label="Daily rate (leave empty to clear)">
                                            <Input
                                              type="number"
                                              value={draft.amount}
                                              onChange={(_, d) => setDraft({ amount: d.value })}
                                              data-testid={`perdiem-amount-${p.personId}`}
                                            />
                                          </Field>
                                          <Field label="Currency">
                                            <Dropdown
                                              value={draft.currency}
                                              selectedOptions={[draft.currency]}
                                              onOptionSelect={(_, d) => d.optionValue && setDraft({ currency: d.optionValue })}
                                              data-testid={`perdiem-currency-${p.personId}`}
                                            >
                                              {CURRENCY_CODES.map((c) => (
                                                <Option key={c} value={c}>
                                                  {c}
                                                </Option>
                                              ))}
                                            </Dropdown>
                                          </Field>
                                        </div>
                                      }
                                      confirmLabel="Save per-diem"
                                      confirmDisabled={!validAmt}
                                      onConfirm={() =>
                                        run(
                                          () =>
                                            amt === ''
                                              ? api.setParticipantPerDiem(m.missionId, p.personId, null, null)
                                              : api.setParticipantPerDiem(m.missionId, p.personId, Math.round(Number(amt) * 100), draft.currency),
                                          () => (amt === '' ? `${p.personId}'s per-diem cleared.` : `${p.personId}'s per-diem saved.`),
                                        )
                                      }
                                    />
                                  );
                                })()}
                              <GovernedAction
                                triggerLabel="Remove…"
                                triggerTestId={`remove-participant-${p.personId}`}
                                triggerAppearance="secondary"
                                title={`Request removing ${p.personId} from ${m.missionId}?`}
                                description="Removal goes through approval; the person stays on the roster until an owner executes the request."
                                confirmLabel="Submit for approval"
                                onConfirm={() =>
                                  run(
                                    () => api.submitRemoveMissionParticipant({ missionId: m.missionId, personId: p.personId }),
                                    (res) => `Submitted ${res.approval.approvalId} for approval. The roster is unchanged until an owner executes it.`,
                                  )
                                }
                              />
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {canViewHistory && (
            <div className={s.section}>
              <h2 className={s.h2}>History</h2>
              <AuditTimeline entries={entries} testId="mission-audit" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
