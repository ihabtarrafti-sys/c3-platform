import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CURRENCY_CODES } from '@c3web/api-contracts';
import {
  MISSION_LINE_DIRECTIONS,
  PAYMENT_STATUSES,
  budgetCategoriesForDirection,
  categoriesForDirection,
  formatMoney,
  missionDayCount,
  nextMissionFinanceStage,
  parseDecimalToMinor,
  type CurrencyCode,
  type MissionFinanceStage,
  type MissionLineDirection,
  type PaymentStatus,
} from '@c3web/domain';
import { useEntities, useMission, useMissionAudit, useMissionParticipants, useMissionPnl, usePeople, usePerDiemPresets, useTeams } from '../queries';
import { ApiError, type MissionLineDto, type PnlAmountDto } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
// The pivot (W1-6): the frozen kit carries API-identical ports of every
// cross-cutting piece this hub uses — the import path IS the conversion for
// StatusBadge/AuditTimeline/CommentThread/DocumentsSection/GovernedAction;
// FactList replaces DefinitionList (same items API); Breadcrumbs do not port
// (the ContextHeader working-from band replaces them).
import {
  TableworkGate,
  TableworkPage,
  RecordPage,
  RecordLink,
  FactList,
  StatusBadge,
  AuditTimeline,
  type TimelineEntry,
  CommentThread,
  ErrorState,
  LoadingState,
  GovernedAction,
  DocumentsSection,
  ComparisonTable,
  Field,
  Input,
  Selector,
  RecheckingTruthPanel,
  moneyActionsAvailable,
  moneyWitnessOf,
  percentToBpsAllowingZero,
  positiveAmountToMinor,
  positiveFiniteRatio,
  type WitnessState,
} from '../tablework';
import { DistributionsSection } from '../components/DistributionsSection';
import { auditActionOf, lineCategoryOf, missionFinanceStageOf, paymentStatusOf } from '../labels';
import { useForegroundRewitness } from '../tablework/useForegroundRewitness';

/**
 * MissionDetailPage (Sprint 39) — the operational hub for one mission. The
 * SHELL actions (edit/deactivate) are direct-audited: immediate and recorded.
 * The ROSTER is governed: adding or removing a participant submits an
 * approval an owner must review and execute — the dialogs say so honestly.
 */

/**
 * Wave 3 (Lane 1): the Fluent `makeStyles` block is retired. SIX of its ten
 * declarations had an exact kit answer and are gone outright — the four
 * geometry ones match the kit's tokens to the pixel:
 *
 *   section       → `.record-section`      (margin-top --c3-space-8 = the same 32px)
 *   h2            → `.record-section h2`   (--c3-font-size-lead = the same 20px,
 *                                           semibold, ink-strong, margin 0 0 12px)
 *   h2Row         → `.record-section-head` (flex/baseline/space-between/wrap,
 *                                           gap --c3-space-3 = the same 12px)
 *   headerActions → `.row-actions` in a cell or a section head (gap
 *                   --c3-space-2 = the same 8px), and NOTHING at all on the
 *                   shell cluster: RecordPage already wraps `actions` in
 *                   `.local-actions`, which is that same row
 *   rosterIntro   → `.record-quiet`
 *   personSelect  → deleted. Declared in the Fluent era and never once applied
 *                   — dead on arrival. What it reached for now exists as the
 *                   kit's `Selector width="wide"`, but this screen has never
 *                   rendered a wide person picker and a conversion may not
 *                   introduce one.
 *
 * The four styles that survived conversion as carried-verbatim objects closed
 * onto kit classes in the marker chapter (K3/K5): `fields` → `.field-stack`,
 * `pnlTotals` → `.totals-stack`, `pnlProfit` → `.totals-conclusion`,
 * `pnlSubtle` → `.cell-note` (its six standalone sentences stay
 * `.record-quiet`).
 */

// K5 CLOSED (marker chapter): the three page-level roster forms ride the
// kit's `.field-stack` (bare column, the carried 8px rhythm = --c3-space-2
// exact); their max-widths/margins stay inline as SITE geometry, not the
// primitive. The P&L totals ride `.totals-stack` + `.totals-conclusion` —
// the non-tabular totals vocabulary (carried values, token-exact); the six
// quiet sentences keep `.record-quiet` and `.total-row` stays table-bound.

// K3 CLOSED (marker chapter; tone ruling 2026-07-28): both money-cell asides
// ride the kit's `.cell-note` — the cell-scale half of the tone family.
// DISCLOSED NORMALIZATION, ruled in ("one family, two scales — never a
// parallel scheme"): the carried 13px/ink-muted lands on the tier's
// 12px/ink-quiet — the annotation now sits AT the figure's own size instead
// of 1px above it, and takes the family's base ink. The six standalone totals
// sentences below the table stay `.record-quiet` (page scale), untouched.

// R4 L-02 (v2 P&L): a tagged amount renders its exact money, or an HONEST reason —
// never a silently-rounded figure, never the wrong excuse.
const PNL_REASON_LABEL = {
  overflow: 'not computable — exceeds the exact range',
  missing_rate: 'missing exchange rate',
  open_ended: 'open-ended',
} as const;
function pnlAmountText(a: PnlAmountDto, currency: CurrencyCode): string {
  return a.status === 'ok' ? formatMoney(a.amountMinor, currency) : `— (${PNL_REASON_LABEL[a.reason]})`;
}

export function MissionDetailPage() {
  // The session gate mounts BEFORE any query hook: an anonymous deep link in
  // Entra mode must land on the deliberate sign-in screen, not fire 401s into
  // acquireTokenRedirect. The band's record NAME comes from data, so the body
  // (not this wrapper) renders TableworkPage.
  const { missionId = '' } = useParams();
  return (
    <TableworkGate>
      <MissionDetailBody missionId={missionId} />
    </TableworkGate>
  );
}

function MissionDetailBody({ missionId }: { missionId: string }) {
  const navigate = useNavigate();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useMission(missionId);
  const participants = useMissionParticipants(missionId);
  const canManage = me?.capabilities.canManageMissions ?? false;
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const canViewPerDiem = me?.capabilities.canViewPerDiem ?? false;
  const [perDiemDraft, setPerDiemDraft] = useState<Record<string, { amount: string; currency: string }>>({});
  // HARDEN-2: the org's per-diem quick-picks (Settings-editable; defaults in code).
  const presetsQuery = usePerDiemPresets(canManage);
  const perDiemPresets = presetsQuery.data?.presets ?? [];
  const canViewHistory = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const audit = useMissionAudit(missionId, canViewHistory);
  const people = usePeople(canSubmit);
  const allTeams = useTeams();

  const [edit, setEdit] = useState<{ name: string; code: string; organizer: string; city: string; teamId: string; gameTitle: string; startsOn: string; endsOn: string } | null>(null);
  const [addPersonId, setAddPersonId] = useState('');
  const [addPersonLabel, setAddPersonLabel] = useState('');
  const [addRole, setAddRole] = useState('');
  // Bulk roster actions (Track B): multi-add + roster-wide per-diem.
  const [bulkPersonIds, setBulkPersonIds] = useState<string[]>([]);
  const [bulkRole, setBulkRole] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rosterPd, setRosterPd] = useState<{ amount: string; currency: string }>({ amount: '', currency: 'USD' });
  const [rosterBusy, setRosterBusy] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['mission', missionId] });
    void qc.invalidateQueries({ queryKey: ['missions'] });
    void qc.invalidateQueries({ queryKey: ['missionAudit', missionId] });
    // Shell dates and the roster's per-diems are P&L INPUTS (day counts).
    void qc.invalidateQueries({ queryKey: ['missionPnl', missionId] });
  };

  if (isError) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <TableworkPage record={missionId}>
        <ErrorState
          data-testid="mission-error"
          message={is404 ? `No mission ${missionId} in your tenant.` : 'Could not load this mission.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      </TableworkPage>
    );
  }

  const m = data?.mission;
  const title = m?.name ?? (isLoading ? 'Loading…' : missionId);
  const editState = edit ?? {
    name: m?.name ?? '',
    code: m?.code ?? '',
    organizer: m?.organizer ?? '',
    city: m?.city ?? '',
    teamId: m?.teamId ?? '',
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

  // UX12 (ruled truthfulness fix): a bulk loop must retain PER-ROW outcomes.
  // The old error notice named the failing ids but guessed ONE cause for all
  // of them; the server said why each row failed and the notice discarded it.
  const rowReason = (e: unknown): string => (e instanceof ApiError ? e.message : 'request failed');

  // Bulk roster: fire N governed AddMissionParticipant requests (one approval
  // each — membership stays a per-person governed decision) and report each row.
  async function bulkAdd(): Promise<void> {
    if (!m || bulkPersonIds.length === 0 || !bulkRole.trim()) return;
    setBulkBusy(true);
    let ok = 0;
    const fails: { personId: string; reason: string }[] = [];
    for (const personId of bulkPersonIds) {
      try {
        await api.submitAddMissionParticipant({ missionId: m.missionId, personId, role: bulkRole.trim() });
        ok += 1;
      } catch (e) {
        fails.push({ personId, reason: rowReason(e) });
      }
    }
    setBulkBusy(false);
    if (ok > 0) notify('success', `Submitted ${ok} add request${ok > 1 ? 's' : ''} for approval — the roster is unchanged until an owner executes each.`);
    if (fails.length) notify('error', `${fails.length} could not be submitted — ${fails.map((f) => `${f.personId}: ${f.reason}`).join(' · ')}`);
    // The selection still clears on any outcome: retained ids can go stale
    // against the chip list (a person whose add "failed" as already-active
    // leaves the eligible set on refresh, stranding an invisible selection).
    // The notice's per-row ids are what make the re-pick informed.
    setBulkPersonIds([]);
    setBulkRole('');
    invalidate();
    void qc.invalidateQueries({ queryKey: ['missionParticipants', missionId] });
    void qc.invalidateQueries({ queryKey: ['approvals'] });
  }

  // Roster-wide per-diem: set the same daily rate on every ACTIVE participant
  // (direct-audited, version-guarded per person — the existing setter).
  async function applyRosterPerDiem(): Promise<void> {
    if (!m) return;
    // MONEY SITE 1 of 3 — the DOMAIN parser, deliberately not migrated.
    // Policy here: a well-formed amount, ZERO ALLOWED (a 0.00 daily rate is a
    // real rate), and '' is malformed like any other bad string — this form has
    // no "clear" verb, so both land on one refusal. That policy IS the kit's
    // `amountToMinorAllowingZero`, which is a verbatim re-export of this call
    // (`return parseDecimalToMinor(input)`) — so the swap would be provably
    // behaviour-identical. It is still not made here: Wave 3 does not do F-1
    // call-site parser migrations, and moving ONE of the three per-diem sites to
    // a second name would leave one quantity parsed under two names on one
    // screen, which is how a zero policy drifts unnoticed. All three move
    // together, in the F-1 pass, or none do.
    const minor = parseDecimalToMinor(rosterPd.amount);
    if (minor === null) return notify('error', 'Enter a valid per-diem amount (up to 2 decimals).');
    const active = (participants.data?.participants ?? []).filter((p) => p.isActive);
    if (active.length === 0) return notify('error', 'No active participants to apply to.');
    setRosterBusy(true);
    let ok = 0;
    // UX12: per-row outcomes. The old notice reported only a count and one
    // assumed cause; this money-adjacent surface must say WHICH people were
    // not set and what the server said for each.
    const fails: { personId: string; reason: string }[] = [];
    for (const p of active) {
      try {
        await api.setParticipantPerDiem(m.missionId, p.personId, minor, rosterPd.currency, p.version);
        ok += 1;
      } catch (e) {
        fails.push({ personId: p.personId, reason: rowReason(e) });
      }
    }
    setRosterBusy(false);
    if (ok > 0) notify('success', `Set per-diem on ${ok} participant${ok > 1 ? 's' : ''}.`);
    if (fails.length) notify('error', `${fails.length} could not be set — ${fails.map((f) => `${f.personId}: ${f.reason}`).join(' · ')}. Reload to see current values before retrying.`);
    // UX12: a partial failure keeps the entered amount so the retry does not
    // depend on the operator re-typing money; a full success clears it.
    if (fails.length === 0) setRosterPd({ amount: '', currency: rosterPd.currency });
    invalidate();
    void qc.invalidateQueries({ queryKey: ['missionParticipants', missionId] });
  }

  // The Tablework pilot: every mission reader may open the conversation —
  // the Comms route itself is the authority on what renders there.
  const conversationAction = m ? (
    <button className="secondary-action" type="button" data-testid="mission-conversation-link" onClick={() => navigate(`/missions/${m.missionId}/comms`)}>
      Conversation
    </button>
  ) : null;

  const manageActions =
    m && canManage && m.isActive ? (
      // No wrapper: RecordPage already puts `actions` inside `.local-actions`
      // (flex/center/wrap, gap --c3-space-2 — the same 8px the retired
      // `headerActions` set), and these fold in beside the Conversation button
      // exactly as before.
      <>
        <GovernedAction
          triggerLabel="Edit…"
          triggerTestId={`edit-mission-${m.missionId}`}
          triggerAppearance="secondary"
          title={`Edit ${m.missionId}?`}
          description="Changes take effect immediately; what changed is recorded in the audit history."
          extra={
            // GovernedAction wraps `extra` in `.governed-extra`, itself a grid
            // with a token gap — the Fluent-era stack wrapper is redundant here.
            <>
              <Field label="Name" required>
                <Input value={editState.name} onChange={(e) => setEdit({ ...editState, name: e.target.value })} data-testid={`edit-mission-name-${m.missionId}`} />
              </Field>
              <Field label="Tournament code">
                <Input value={editState.code} onChange={(e) => setEdit({ ...editState, code: e.target.value })} data-testid={`edit-mission-code-${m.missionId}`} />
              </Field>
              <Field label="Organizer">
                <Input value={editState.organizer} onChange={(e) => setEdit({ ...editState, organizer: e.target.value })} />
              </Field>
              <Field label="City">
                <Input value={editState.city} onChange={(e) => setEdit({ ...editState, city: e.target.value })} />
              </Field>
              <Field label="Team (division)">
                <Selector
                  data-testid={`edit-mission-team-${m.missionId}`}
                  placeholder="— none —"
                  value={editState.teamId}
                  display={
                    // A set team must NEVER read as "— none —": if it isn't in
                    // the active-GameDivision options, show its name from the
                    // full register, else the raw id (the honest fallback).
                    editState.teamId
                      ? ((x) => (x ? `${x.code} · ${x.name}` : editState.teamId))(allTeams.data?.teams.find((x) => x.teamId === editState.teamId))
                      : undefined
                  }
                  options={[
                    { value: '', label: '— none —' },
                    ...(allTeams.data?.teams ?? [])
                      .filter((x) => x.isActive && x.kind === 'GameDivision')
                      .map((x) => ({ value: x.teamId, label: `${x.code} · ${x.name}` })),
                  ]}
                  onSelect={(value) => setEdit({ ...editState, teamId: value })}
                />
              </Field>
              <Field label="Game title">
                <Input value={editState.gameTitle} onChange={(e) => setEdit({ ...editState, gameTitle: e.target.value })} />
              </Field>
              <Field label="Starts on" required>
                <Input type="date" value={editState.startsOn} onChange={(e) => setEdit({ ...editState, startsOn: e.target.value })} />
              </Field>
              <Field label="Ends on">
                <Input type="date" value={editState.endsOn} onChange={(e) => setEdit({ ...editState, endsOn: e.target.value })} data-testid={`edit-mission-ends-${m.missionId}`} />
              </Field>
            </>
          }
          confirmLabel="Save changes"
          confirmDisabled={editState.name.trim() === '' || !/^\d{4}-\d{2}-\d{2}$/.test(editState.startsOn)}
          onConfirm={() =>
            run(
              () =>
                api.updateMission(m.missionId, {
                  expectedVersion: m.version,
                  name: editState.name.trim(),
                  code: editState.code.trim() === '' ? null : editState.code.trim(),
                  organizer: editState.organizer.trim() === '' ? null : editState.organizer.trim(),
                  city: editState.city.trim() === '' ? null : editState.city.trim(),
                  teamId: editState.teamId === '' ? null : editState.teamId,
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
      </>
    ) : undefined;

  const shellActions = (
    <>
      {conversationAction}
      {manageActions}
    </>
  );

  const addReady = addPersonId !== '' && addRole.trim() !== '';

  return (
    <TableworkPage record={title} section={m ? m.missionId : undefined}>
      <RecordPage eyebrow="Mission" title={title} documentTitle={m ? title : missionId} titleTestId="mission-title" actions={shellActions}>
      {isLoading && <LoadingState label="Loading mission…" />}
      {m && (
        <>
          <FactList
            items={[
              { label: 'Mission ID', value: m.missionId, mono: true, testId: 'mission-id' },
              { label: 'Tournament code', value: m.code ? <span data-testid="mission-code">{m.code}</span> : null, mono: true },
              { label: 'Organizer', value: m.organizer ?? null },
              { label: 'City', value: m.city ?? null },
              {
                label: 'Team',
                value: m.teamId ? (
                  <Link to={`/teams/${m.teamId}`} data-testid='mission-team-link'>
                    {((x) => (x ? `${x.code} · ${x.name}` : m.teamId))(allTeams.data?.teams.find((x) => x.teamId === m.teamId))}
                  </Link>
                ) : null,
              },
              { label: 'Game title', value: m.gameTitle ?? null },
              { label: 'Starts on', value: m.startsOn },
              { label: 'Ends on', value: m.endsOn ?? null },
              ...(me?.capabilities.canViewFinancials
                ? [
                    {
                      label: 'Finance stage',
                      value: (
                        // `.row-actions` — the kit's flex-START trigger cluster
                        // (gap --c3-space-2 = the same 8px). The badge and its
                        // one advance trigger sit inside a fact's <dd>.
                        <span className="row-actions">
                          <StatusBadge variant={missionFinanceStageOf(m.financeStage).variant} data-testid="mission-finance-stage">
                            {missionFinanceStageOf(m.financeStage).label}
                          </StatusBadge>
                          {canManage &&
                            m.isActive &&
                            (() => {
                              const next = nextMissionFinanceStage(m.financeStage as MissionFinanceStage);
                              if (!next) return null;
                              return (
                                <GovernedAction
                                  triggerLabel={`Advance to ${missionFinanceStageOf(next).label}…`}
                                  triggerTestId="advance-finance-stage"
                                  triggerAppearance="secondary"
                                  title={`Advance ${m.missionId} to ${missionFinanceStageOf(next).label}?`}
                                  description={
                                    next === 'Settled'
                                      ? 'Settling closes the mission’s money story. It requires every income line to be Received — the request is refused otherwise.'
                                      : 'The financial lifecycle moves one step forward. This takes effect immediately and is recorded.'
                                  }
                                  confirmLabel={`Advance to ${missionFinanceStageOf(next).label}`}
                                  onConfirm={() =>
                                    run(
                                      () => api.setMissionFinanceStage(m.missionId, m.version, next),
                                      () => `${m.missionId} is now ${missionFinanceStageOf(next).label}.`,
                                    )
                                  }
                                />
                              );
                            })()}
                        </span>
                      ),
                    },
                  ]
                : []),
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

          <div className="record-section">
            <h2>Participants</h2>
            {canSubmit && (
              <p className="record-quiet">
                Roster changes go through approval — an owner must review and execute before membership changes.
              </p>
            )}
            {canSubmit && m.isActive && (
              <div className="field-stack" style={{ maxWidth: '440px', marginBottom: '16px' }}>
                <Field label="Person" required>
                  <Selector
                    data-testid="add-participant-person"
                    placeholder="Select a person"
                    value={addPersonId}
                    display={addPersonId ? addPersonLabel : undefined}
                    options={(people.data?.people ?? []).map((p) => ({ value: p.personId, label: `${p.fullName} (${p.personId})` }))}
                    onSelect={(value, label) => {
                      setAddPersonId(value);
                      setAddPersonLabel(label);
                    }}
                  />
                </Field>
                <Field label="Mission role" required>
                  <Input value={addRole} onChange={(e) => setAddRole(e.target.value)} data-testid="add-participant-role" />
                </Field>
                <div>
                  <GovernedAction
                    triggerLabel="Submit for approval"
                    triggerTestId="add-participant-submit"
                    triggerDisabled={!addReady}
                    title="Request adding this participant?"
                    description="It goes to an approver for review; you can edit it until review starts, then it’s frozen. The person joins the roster only when an owner executes it."
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
            {canSubmit && m.isActive && (
              <div className="field-stack" style={{ maxWidth: '520px', marginBottom: '16px', paddingTop: '10px', borderTop: '1px solid var(--c3-border-subtle)' }}>
                {/* Spec-free multiselect → the established chips pattern
                    (toggle to pick), same container testid. */}
                <div className="tw-field">
                  <span>Bulk add — pick several people, one role</span>
                  <div className="comment-mention-chips" data-testid="bulk-add-people" role="group" aria-label="Bulk add — pick several people, one role">
                    {(people.data?.people ?? [])
                      .filter((p) => !roster.some((rp) => rp.isActive && rp.personId === p.personId))
                      .map((p) => (
                        <button
                          key={p.personId}
                          type="button"
                          className={bulkPersonIds.includes(p.personId) ? 'mini-action active' : 'mini-action'}
                          aria-pressed={bulkPersonIds.includes(p.personId)}
                          onClick={() =>
                            setBulkPersonIds((ids) => (ids.includes(p.personId) ? ids.filter((x) => x !== p.personId) : [...ids, p.personId]))
                          }
                        >
                          {`${p.fullName} (${p.personId})`}
                        </button>
                      ))}
                  </div>
                </div>
                <Field label="Mission role for all">
                  <Input value={bulkRole} onChange={(e) => setBulkRole(e.target.value)} data-testid="bulk-add-role" />
                </Field>
                <div className="row-actions">
                  <button className="primary-action" type="button" onClick={() => void bulkAdd()} disabled={bulkBusy || bulkPersonIds.length === 0 || !bulkRole.trim()} data-testid="bulk-add-submit">
                    {bulkBusy ? 'Submitting…' : `Submit ${bulkPersonIds.length || ''} for approval`}
                  </button>
                  <span className="record-quiet">One approval per person — membership stays a governed decision.</span>
                </div>
              </div>
            )}
            {canManage && canViewPerDiem && m.isActive && (participants.data?.participants ?? []).some((p) => p.isActive) && (
              <div className="field-stack" style={{ maxWidth: '520px', marginBottom: '16px' }}>
                <Field label="Roster-wide per-diem — apply one daily rate to every active participant">
                  {/* `.form-row` — the kit's inline create-form row (these are
                      fields, not filters, which is exactly the distinction the
                      class was added to keep). */}
                  <div className="form-row">
                    <Input value={rosterPd.amount} onChange={(e) => setRosterPd((c) => ({ ...c, amount: e.target.value }))} placeholder="100.00" data-testid="roster-perdiem-amount" style={{ maxWidth: '120px' }} />
                    <Selector
                      data-testid="roster-perdiem-currency"
                      value={rosterPd.currency}
                      options={CURRENCY_CODES.map((c) => ({ value: c, label: c }))}
                      onSelect={(value) => setRosterPd((c) => ({ ...c, currency: value || 'USD' }))}
                      // Was an inline `minWidth: 6rem` ridden in through the
                      // rest-spread — precisely the narrower-than-the-12rem-floor
                      // case the kit's width scale exists to end.
                      // ⚠️ NOT a like-for-like: `compact` is 10rem, so this
                      // currency picker gets wider than it was. The scale's steps
                      // are the kit's decision, not this screen's, and a
                      // three-letter code has room to spare either way.
                      width="compact"
                    />
                    {perDiemPresets.map((p) => (
                      <button key={`${p.amountMinor}-${p.currency}`} type="button" className="mini-action" onClick={() => setRosterPd({ amount: (p.amountMinor / 100).toFixed(2), currency: p.currency })}>
                        {(p.amountMinor / 100).toFixed(0)} {p.currency}
                      </button>
                    ))}
                    <button className="secondary-action" type="button" onClick={() => void applyRosterPerDiem()} disabled={rosterBusy} data-testid="roster-perdiem-apply">
                      {rosterBusy ? 'Applying…' : 'Apply to all active'}
                    </button>
                  </div>
                </Field>
              </div>
            )}
            {roster.length === 0 && <p data-testid="participants-empty">No participants yet.</p>}
            {roster.length > 0 && (
              <ComparisonTable label="Mission participants" testId="participants-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Name</th>
                    <th>Role</th>
                    {canViewPerDiem && <th>Per-diem</th>}
                    <th>Status</th>
                    {canSubmit && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((p) => (
                    <tr key={p.personId} data-testid={`participant-row-${p.personId}`}>
                      <td>
                        {/* A business-ID link → RecordLink. `.mono` styles the
                            CELL, so a plain anchor here has always rendered in
                            the body font; this is the kit primitive for it. */}
                        <RecordLink to={`/people/${p.personId}`}>{p.personId}</RecordLink>
                      </td>
                      <td>{p.personName}</td>
                      <td>{p.role}</td>
                      {canViewPerDiem && (
                        <td className="mono" data-testid={`participant-perdiem-${p.personId}`}>
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
                      <td>
                        <StatusBadge variant={p.isActive ? 'ready' : 'neutral'} data-testid={`participant-status-${p.personId}`}>
                          {p.isActive ? 'Active' : 'Removed'}
                        </StatusBadge>
                      </td>
                      {canSubmit && (
                        <td>
                          {p.isActive && (
                            <div className="row-actions">
                              {canManage &&
                                (() => {
                                  const draft = perDiemDraft[p.personId] ?? {
                                    amount: p.perDiemAmountMinor != null ? String(p.perDiemAmountMinor / 100) : '',
                                    currency: p.perDiemCurrency ?? 'USD',
                                  };
                                  const setDraft = (patch: Partial<{ amount: string; currency: string }>) =>
                                    setPerDiemDraft((c) => ({ ...c, [p.personId]: { ...draft, ...patch } }));
                                  const amt = draft.amount.trim();
                                  // M-02: exact-decimal law — excess precision disables Save.
                                  //
                                  // MONEY SITE 2 of 3 — the DOMAIN parser, and here
                                  // the migration is not merely out of scope, it is
                                  // WRONG. This site has THREE outcomes, not two:
                                  // '' means "no value stated → clear the per-diem",
                                  // a parse means a value (0 included — a 0.00 daily
                                  // rate is real), and null means malformed. Every
                                  // kit parser collapses '' and malformed into the
                                  // same null, so the '' arm has to be answered
                                  // before the parser is consulted — which is what
                                  // this line does. A kit name here would claim a
                                  // policy that does not describe the call site.
                                  const validAmt = amt === '' || parseDecimalToMinor(amt) !== null;
                                  return (
                                    <GovernedAction
                                      triggerLabel="Per-diem…"
                                      triggerTestId={`perdiem-participant-${p.personId}`}
                                      triggerAppearance="secondary"
                                      title={`Set ${p.personId}'s per-diem?`}
                                      description="This is the daily rate for this person on this mission. It takes effect immediately and is recorded. Leave the amount empty to clear it."
                                      extra={
                                        <>
                                          {perDiemPresets.length > 0 && (
                                            <div className="row-actions" data-testid={`perdiem-presets-${p.personId}`}>
                                              {perDiemPresets.map((pre) => (
                                                <button
                                                  key={`${pre.amountMinor}-${pre.currency}`}
                                                  type="button"
                                                  className="mini-action"
                                                  onClick={() =>
                                                    setDraft({
                                                      amount: pre.amountMinor % 100 === 0 ? String(pre.amountMinor / 100) : (pre.amountMinor / 100).toFixed(2),
                                                      currency: pre.currency,
                                                    })
                                                  }
                                                  data-testid={`perdiem-preset-${p.personId}-${pre.amountMinor}-${pre.currency}`}
                                                >
                                                  {formatMoney(pre.amountMinor, pre.currency)}/day
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                          <Field label="Daily rate (leave empty to clear)">
                                            <Input
                                              type="number"
                                              value={draft.amount}
                                              onChange={(e) => setDraft({ amount: e.target.value })}
                                              data-testid={`perdiem-amount-${p.personId}`}
                                            />
                                          </Field>
                                          <Field label="Currency">
                                            <Selector
                                              data-testid={`perdiem-currency-${p.personId}`}
                                              value={draft.currency}
                                              options={CURRENCY_CODES.map((c) => ({ value: c, label: c }))}
                                              onSelect={(value) => value && setDraft({ currency: value })}
                                            />
                                          </Field>
                                        </>
                                      }
                                      confirmLabel="Save per-diem"
                                      confirmDisabled={!validAmt}
                                      onConfirm={() =>
                                        run(
                                          () =>
                                            // MONEY SITE 3 of 3 — the same parser as
                                            // site 2 on purpose. This is the WRITE that
                                            // `validAmt` gated; if the validator and the
                                            // write ever parsed under different rules,
                                            // an amount could pass the gate and reach
                                            // the API as something else. They move
                                            // together or not at all. The `!` is safe
                                            // only because `confirmDisabled={!validAmt}`
                                            // proved the parse on this exact string.
                                            amt === ''
                                              ? api.setParticipantPerDiem(m.missionId, p.personId, null, null, p.version)
                                              : api.setParticipantPerDiem(m.missionId, p.personId, parseDecimalToMinor(amt)!, draft.currency, p.version),
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
              </ComparisonTable>
            )}
          </div>

          {(me?.capabilities.canViewFinancials ?? false) && (
            <>
              <MissionPnlSection missionId={m.missionId} canManage={canManage && m.isActive} organizer={m.organizer} />
              <DistributionsSection missionId={m.missionId} canManage={canManage && m.isActive} />
            </>
          )}

          <DocumentsSection ownerType="Mission" ownerId={m.missionId} canManage={canManage && m.isActive} />

          <CommentThread subjectType="Mission" subjectId={m.missionId} />

          {canViewHistory && (
            <div className="record-section">
              <h2>History</h2>
              {/* F04 (instance 21): a denied or failed history fetch surfaces —
                  an empty timeline is a CLAIM about what happened here. */}
              {audit.isError ? (
                <ErrorState data-testid="mission-audit-error" message="The history could not be loaded — what happened here may not be shown." correlationId={audit.error instanceof ApiError ? audit.error.correlationId : undefined} />
              ) : (
                <AuditTimeline entries={entries} testId="mission-audit" />
              )}
            </div>
          )}
        </>
      )}
      </RecordPage>
    </TableworkPage>
  );
}

// ── Finance S4: the mission's profit & loss ──────────────────────────────────

type LineForm = { direction: MissionLineDirection; category: string; label: string; amount: string; currency: CurrencyCode };

const EMPTY_LINE: LineForm = { direction: 'Income', category: 'Other', label: '', amount: '', currency: 'USD' };

type PaymentForm = { status: PaymentStatus; received: string; rate: string; source: string; refNo: string };

/** S6: the issue-invoice dialog per income line. */
type InvoiceForm = { entityId: string; billedTo: string; details: string; vatPct: string; description: string };

type BudgetForm = { direction: MissionLineDirection; category: string; currency: CurrencyCode; amount: string };

const EMPTY_BUDGET: BudgetForm = { direction: 'Expense', category: 'Other', currency: 'USD', amount: '' };

function lineFormInvalid(f: LineForm): boolean {
  return f.label.trim() === '' || positiveAmountToMinor(f.amount) == null;
}

/**
 * The P&L surface — rendered only for canViewFinancials roles (the API gates
 * the endpoint too). Owner/operations on an ACTIVE mission add / edit / remove
 * income and expense lines (direct-audited); the roster's per-diems roll in as
 * an expense automatically; profit blends to USD through the org's FX table —
 * honestly: a missing rate means "no blended figure", never an invented one.
 */
export interface MissionPnlSectionProps {
  readonly missionId: string;
  readonly canManage: boolean;
  readonly organizer: string | null;
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly requestKey?: string | number;
  readonly onTruthChange?: (truth: WitnessState) => void;
}

export function MissionPnlSection({
  missionId,
  canManage,
  organizer,
  enabled = true,
  foreground = true,
  requestKey,
  onTruthChange,
}: MissionPnlSectionProps) {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canViewFinancials = me?.capabilities.canViewFinancials ?? false;
  const queryEnabled = enabled && canViewFinancials;
  const query = useMissionPnl(missionId, queryEnabled);
  const rewitnessing = useForegroundRewitness({
    foreground,
    enabled: queryEnabled,
    refetch: query.refetch,
    requestKey,
  });
  const truth = useMemo(
    () =>
      moneyWitnessOf(
        {
          included: canViewFinancials,
          data: query.data,
          error: query.error,
          isLoading: query.isLoading,
          isFetching: query.isFetching || rewitnessing,
          dataUpdatedAt: query.dataUpdatedAt,
        },
        {
          isEmpty: (view) =>
            view.lines.length === 0 && view.budgets.length === 0 && view.pnl.perDiem.entries.length === 0,
          omittedReason: 'FINANCIALS_UNAVAILABLE',
          recheckMessage: "This mission's financial record is being checked again.",
          notFoundMessage: "This mission's financial record no longer resolves.",
        },
      ),
    [
      canViewFinancials,
      query.data,
      query.dataUpdatedAt,
      query.error,
      query.isFetching,
      query.isLoading,
      rewitnessing,
    ],
  );
  const actionsCurrent = moneyActionsAvailable(canManage && enabled, truth, foreground);
  const data = query.data;
  const lines = data?.lines ?? [];
  const pnl = data?.pnl;

  const [add, setAdd] = useState<LineForm>(EMPTY_LINE);
  const [edits, setEdits] = useState<Record<string, LineForm>>({});
  const [payments, setPayments] = useState<Record<string, PaymentForm>>({});
  const [budget, setBudget] = useState<BudgetForm>(EMPTY_BUDGET);
  // S6: per-line issue-invoice forms (entity series, billed-to, VAT %).
  const [invoiceForms, setInvoiceForms] = useState<Record<string, InvoiceForm>>({});
  const { data: entitiesData } = useEntities(actionsCurrent);
  const invoiceEntities = (entitiesData?.entities ?? []).filter((e) => e.isActive);

  useEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  useLayoutEffect(() => {
    if (actionsCurrent) return;
    setAdd(EMPTY_LINE);
    setEdits({});
    setPayments({});
    setBudget(EMPTY_BUDGET);
    setInvoiceForms({});
  }, [actionsCurrent]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['missionPnl', missionId] });
    void qc.invalidateQueries({ queryKey: ['missionAudit', missionId] });
    void qc.invalidateQueries({ queryKey: ['invoices'] });
  };

  async function run(fn: () => Promise<unknown>, message: string): Promise<void> {
    if (!actionsCurrent) {
      notify('error', 'The financial record must be current before this action can be recorded.');
      throw new Error('money witness is not current');
    }
    try {
      await fn();
      notify('success', message);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  // Both call sites pass this straight to GovernedAction's `extra`, which is
  // already `.governed-extra` — a grid with a token gap. No wrapper needed.
  function lineFields(form: LineForm, setForm: (f: LineForm) => void, idPrefix: string, directionEditable: boolean) {
    return (
      <>
        {directionEditable && (
          <Field label="Type" required>
            <Selector
              data-testid={`${idPrefix}-direction`}
              value={form.direction}
              options={MISSION_LINE_DIRECTIONS.map((d) => ({ value: d, label: d }))}
              onSelect={(value) => {
                const direction = (value || 'Income') as MissionLineDirection;
                // Category lists differ per direction — reset to the honest bucket.
                setForm({ ...form, direction, category: 'Other' });
              }}
            />
          </Field>
        )}
        {directionEditable && (
          <Field label="Category" required>
            <Selector
              data-testid={`${idPrefix}-category`}
              value={form.category}
              display={lineCategoryOf(form.category)}
              options={categoriesForDirection(form.direction).map((c) => ({ value: c, label: lineCategoryOf(c) }))}
              onSelect={(value) => setForm({ ...form, category: value || 'Other' })}
            />
          </Field>
        )}
        <Field label="Label" required>
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} data-testid={`${idPrefix}-label`} />
        </Field>
        <Field label="Amount" required>
          <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid={`${idPrefix}-amount`} />
        </Field>
        <Field label="Currency" required>
          <Selector
            data-testid={`${idPrefix}-currency`}
            value={form.currency}
            options={CURRENCY_CODES.map((c) => ({ value: c, label: c }))}
            onSelect={(value) => setForm({ ...form, currency: (value || 'USD') as CurrencyCode })}
          />
        </Field>
      </>
    );
  }

  const formFromLine = (l: MissionLineDto): LineForm => ({
    direction: l.direction,
    category: l.category,
    label: l.label,
    amount: String(l.amountMinor / 100),
    currency: l.currency,
  });

  const paymentFromLine = (l: MissionLineDto): PaymentForm => ({
    status: (l.paymentStatus ?? 'Expected') as PaymentStatus,
    received: l.receivedAmountMinor != null ? String(l.receivedAmountMinor / 100) : '',
    rate: l.receivedUsdPerUnit != null ? String(l.receivedUsdPerUnit) : '',
    source: l.paymentSourceLabel ?? '',
    refNo: l.refNo ?? '',
  });

  const perDiemEntries = pnl?.perDiem.entries ?? [];

  return (
    <div className="record-section" data-testid="mission-pnl-panel">
      <div className="record-section-head">
        <h2>Profit &amp; loss</h2>
        {actionsCurrent && (
          <div className="row-actions">
            <GovernedAction
              triggerLabel="Set budget…"
              triggerTestId="set-budget"
              triggerAppearance="secondary"
              title="Set a budget cell"
              description="One planned amount per type + category + currency (the tournament budget template). Leave the amount empty to clear the cell. Takes effect immediately and is recorded."
              extra={
                <>
                  <Field label="Type" required>
                    <Selector
                      data-testid="set-budget-direction"
                      value={budget.direction}
                      options={MISSION_LINE_DIRECTIONS.map((d) => ({ value: d, label: d }))}
                      onSelect={(value) => setBudget({ ...budget, direction: (value || 'Expense') as MissionLineDirection, category: 'Other' })}
                    />
                  </Field>
                  <Field label="Category" required>
                    <Selector
                      data-testid="set-budget-category"
                      value={budget.category}
                      display={lineCategoryOf(budget.category)}
                      options={budgetCategoriesForDirection(budget.direction).map((c) => ({ value: c, label: lineCategoryOf(c) }))}
                      onSelect={(value) => setBudget({ ...budget, category: value || 'Other' })}
                    />
                  </Field>
                  <Field label="Currency" required>
                    <Selector
                      data-testid="set-budget-currency"
                      value={budget.currency}
                      options={CURRENCY_CODES.map((c) => ({ value: c, label: c }))}
                      onSelect={(value) => setBudget({ ...budget, currency: (value || 'USD') as CurrencyCode })}
                    />
                  </Field>
                  <Field label="Planned amount (empty clears)">
                    <Input type="number" value={budget.amount} onChange={(e) => setBudget({ ...budget, amount: e.target.value })} data-testid="set-budget-amount" />
                  </Field>
                </>
              }
              confirmLabel="Save budget"
              confirmDisabled={budget.amount.trim() !== '' && positiveAmountToMinor(budget.amount) == null}
              onConfirm={() =>
                run(
                  () =>
                    api.setMissionBudget(missionId, {
                      direction: budget.direction,
                      category: budget.category,
                      currency: budget.currency,
                      amountMinor: budget.amount.trim() === '' ? null : positiveAmountToMinor(budget.amount)!,
                      // M-03: the version of the cell as THIS page loaded it
                      // (null = the cell was empty) — a concurrent edit refuses.
                      expectedVersion:
                        (data?.budgets ?? []).find(
                          (b) => b.direction === budget.direction && b.category === budget.category && b.currency === budget.currency,
                        )?.version ?? null,
                    }),
                  budget.amount.trim() === '' ? 'Budget cell cleared and recorded.' : 'Budget saved and recorded.',
                ).then(() => setBudget(EMPTY_BUDGET))
              }
            />
            <GovernedAction
              triggerLabel="Add line…"
              triggerTestId="add-line"
              triggerAppearance="secondary"
              title="Add an income or expense line"
              description="Lines record the mission's money — prize income, org support, travel costs. They take effect immediately and are recorded in the mission's history."
              extra={lineFields(add, setAdd, 'add-line', true)}
              confirmLabel="Add line"
              confirmDisabled={lineFormInvalid(add)}
              onConfirm={() =>
                run(
                  () =>
                    api.addMissionLine(missionId, {
                      direction: add.direction,
                      category: add.category,
                      label: add.label.trim(),
                      amountMinor: positiveAmountToMinor(add.amount)!,
                      currency: add.currency,
                    }),
                  'Line added and recorded.',
                ).then(() => setAdd(EMPTY_LINE))
              }
            />
          </div>
        )}
      </div>

      <RecheckingTruthPanel
        state={truth}
        rechecking={rewitnessing || (query.isFetching && query.error == null)}
        emptyLabel="No income, expense, per-diem, or budget records yet."
        testids={{
          loading: 'mission-pnl-loading',
          empty: 'mission-pnl-empty',
          denied: 'mission-pnl-denied',
          failed: 'mission-pnl-error',
          stale: 'mission-pnl-stale',
        }}
      >
      {(lines.length > 0 || perDiemEntries.length > 0) && (
        <ComparisonTable label="Mission income and expense lines" testId="mission-pnl-lines">
          <thead>
            <tr>
              <th>Type</th>
              <th>Category</th>
              <th>Label</th>
              <th>Amount</th>
              <th>Payment</th>
              {actionsCurrent && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const ef = edits[l.lineId] ?? formFromLine(l);
              const setEf = (f: LineForm) => setEdits({ ...edits, [l.lineId]: f });
              const pf = payments[l.lineId] ?? paymentFromLine(l);
              const setPf = (f: PaymentForm) => setPayments({ ...payments, [l.lineId]: f });
              const receivedRate = positiveFiniteRatio(pf.rate);
              return (
                <tr key={l.lineId} data-testid={`pnl-line-${l.lineId}`}>
                  <td>{l.direction}</td>
                  <td data-testid={`pnl-line-category-${l.lineId}`}>{lineCategoryOf(l.category)}</td>
                  <td>{l.label}</td>
                  <td className="mono" data-testid={`pnl-line-amount-${l.lineId}`}>
                    {formatMoney(l.amountMinor, l.currency)}
                    {l.paymentStatus === 'Received' && l.receivedAmountMinor != null && l.receivedAmountMinor !== l.amountMinor && (
                      <span className="cell-note">{` (received ${formatMoney(l.receivedAmountMinor, l.currency)})`}</span>
                    )}
                  </td>
                  <td>
                    {l.paymentStatus ? (
                      <StatusBadge variant={paymentStatusOf(l.paymentStatus).variant} data-testid={`pnl-line-payment-${l.lineId}`}>
                        {paymentStatusOf(l.paymentStatus).label}
                      </StatusBadge>
                    ) : (
                      '—'
                    )}
                    {l.refNo && <span className="cell-note">{` · ${l.refNo}`}</span>}
                  </td>
                   {actionsCurrent && (
                    <td>
                      <div className="row-actions">
                        {l.direction === 'Income' && l.paymentStatus === 'Expected' && (
                          <GovernedAction
                            triggerLabel="Invoice…"
                            triggerTestId={`invoice-line-${l.lineId}`}
                            title={`Issue an invoice for ${l.lineId}?`}
                            description="One income line, one invoice. The number comes from the issuing entity's yearly series and is never reused; the line flips to Invoiced; the PDF is stored as evidence. All immediate and recorded."
                            extra={(() => {
                              const f = invoiceForms[l.lineId] ?? { entityId: invoiceEntities[0]?.entityId ?? '', billedTo: organizer ?? '', details: '', vatPct: '0', description: '' };
                              const setF = (n: InvoiceForm) => setInvoiceForms((c) => ({ ...c, [l.lineId]: n }));
                              const chosen = invoiceEntities.find((e) => e.entityId === f.entityId);
                              return (
                                <>
                                  <Field label="Issuing entity (its code numbers the series)" required hint={chosen && !chosen.code ? 'This entity has no code — set one on the Entities register first.' : undefined}>
                                    <Selector
                                      data-testid={`invoice-entity-${l.lineId}`}
                                      value={f.entityId}
                                      display={chosen ? `${chosen.code ?? '—'} · ${chosen.name}` : undefined}
                                      options={invoiceEntities.map((e) => ({ value: e.entityId, label: `${e.code ?? '—'} · ${e.name}` }))}
                                      onSelect={(value) => value && setF({ ...f, entityId: value })}
                                    />
                                  </Field>
                                  <Field label="Billed to" required>
                                    <Input value={f.billedTo} onChange={(e) => setF({ ...f, billedTo: e.target.value })} data-testid={`invoice-billed-to-${l.lineId}`} />
                                  </Field>
                                  <Field label="Billed-to details (address block, optional)">
                                    <Input value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
                                  </Field>
                                  <Field label="VAT %" required hint="Entered per invoice — C3 states no tax law. 0 for none.">
                                    <Input type="number" value={f.vatPct} onChange={(e) => setF({ ...f, vatPct: e.target.value })} data-testid={`invoice-vat-${l.lineId}`} />
                                  </Field>
                                  <Field label="Description (appears on the PDF; optional)">
                                    <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid={`invoice-description-${l.lineId}`} />
                                  </Field>
                                </>
                              );
                            })()}
                            confirmLabel="Issue invoice"
                            confirmDisabled={(() => {
                              const f = invoiceForms[l.lineId] ?? { entityId: invoiceEntities[0]?.entityId ?? '', billedTo: organizer ?? '', details: '', vatPct: '0', description: '' };
                              const chosen = invoiceEntities.find((e) => e.entityId === f.entityId);
                              return !chosen || !chosen.code || f.billedTo.trim() === '' || percentToBpsAllowingZero(f.vatPct) === null;
                            })()}
                            onConfirm={async () => {
                              if (!actionsCurrent) {
                                notify('error', 'The financial record must be current before an invoice can be issued.');
                                throw new Error('money witness is not current');
                              }
                              const f = invoiceForms[l.lineId] ?? { entityId: invoiceEntities[0]?.entityId ?? '', billedTo: organizer ?? '', details: '', vatPct: '0', description: '' };
                              try {
                                const res = await api.issueInvoice({
                                  missionId,
                                  lineId: l.lineId,
                                  entityId: f.entityId,
                                  billedToName: f.billedTo.trim(),
                                  billedToDetails: f.details.trim() === '' ? null : f.details.trim(),
                                  vatRateBps: percentToBpsAllowingZero(f.vatPct)!,
                                  description: f.description.trim() === '' ? null : f.description.trim(),
                                });
                                notify('success', `Issued ${res.invoice.invoiceNumber} — the line is now Invoiced.`);
                                if (res.pdfError) notify('error', res.pdfError);
                                invalidate();
                                setInvoiceForms((prev) => {
                                  const { [l.lineId]: _drop, ...rest } = prev;
                                  return rest;
                                });
                              } catch (err) {
                                notify('error', err instanceof ApiError ? err.message : 'The invoice could not be issued.');
                                throw err instanceof Error ? err : new Error('failed');
                              }
                            }}
                          />
                        )}
                        {l.direction === 'Income' && (
                          <GovernedAction
                            triggerLabel="Payment…"
                            triggerTestId={`payment-line-${l.lineId}`}
                            triggerAppearance="secondary"
                            title={`Update payment for ${l.lineId}?`}
                            description="Expected → Invoiced → Received (corrections are legal; the audit trail is the truth). Received may carry the actual amount landed, the FX rate at receipt, the bank label, and the bank reference. Never account numbers."
                            extra={
                              <>
                                <Field label="Status" required>
                                  <Selector
                                    data-testid={`payment-status-${l.lineId}`}
                                    value={pf.status}
                                    display={paymentStatusOf(pf.status).label}
                                    options={PAYMENT_STATUSES.map((ps) => ({ value: ps, label: paymentStatusOf(ps).label }))}
                                    onSelect={(value) => setPf({ ...pf, status: (value || 'Expected') as PaymentStatus })}
                                  />
                                </Field>
                                {pf.status === 'Received' && (
                                  <>
                                    <Field label={`Received amount (${l.currency}; empty = as expected)`}>
                                      <Input type="number" value={pf.received} onChange={(e) => setPf({ ...pf, received: e.target.value })} data-testid={`payment-received-${l.lineId}`} />
                                    </Field>
                                    <Field label="FX rate at receipt (USD per 1 unit; optional)">
                                      <Input type="number" value={pf.rate} onChange={(e) => setPf({ ...pf, rate: e.target.value })} data-testid={`payment-rate-${l.lineId}`} />
                                    </Field>
                                  </>
                                )}
                                <Field label="Payment source (bank LABEL only)">
                                  <Input value={pf.source} onChange={(e) => setPf({ ...pf, source: e.target.value })} data-testid={`payment-source-${l.lineId}`} />
                                </Field>
                                <Field label="Bank reference">
                                  <Input value={pf.refNo} onChange={(e) => setPf({ ...pf, refNo: e.target.value })} data-testid={`payment-ref-${l.lineId}`} />
                                </Field>
                              </>
                            }
                            confirmLabel="Save payment"
                            confirmDisabled={
                              (pf.received.trim() !== '' && positiveAmountToMinor(pf.received) == null) ||
                              (pf.rate.trim() !== '' && receivedRate == null)
                            }
                            onConfirm={() =>
                              run(
                                () =>
                                  api.setMissionLinePayment(missionId, l.lineId, {
                                    expectedVersion: l.version,
                                    paymentStatus: pf.status,
                                    receivedAmountMinor: pf.status === 'Received' && pf.received.trim() !== '' ? positiveAmountToMinor(pf.received) : null,
                                    receivedUsdPerUnit: pf.status === 'Received' && pf.rate.trim() !== '' ? receivedRate : null,
                                    paymentSourceLabel: pf.source.trim() === '' ? null : pf.source.trim(),
                                    refNo: pf.refNo.trim() === '' ? null : pf.refNo.trim(),
                                  }),
                                'Payment updated and recorded.',
                              ).then(() =>
                                setPayments((prev) => {
                                  const { [l.lineId]: _drop, ...rest } = prev;
                                  return rest;
                                }),
                              )
                            }
                          />
                        )}
                        <GovernedAction
                          triggerLabel="Edit…"
                          triggerTestId={`edit-line-${l.lineId}`}
                          triggerAppearance="secondary"
                          title={`Edit this ${l.direction.toLowerCase()} line`}
                          description="The change takes effect immediately and is recorded. The line's type never changes — remove it and add another to flip income/expense."
                          extra={lineFields(ef, setEf, `edit-line-${l.lineId}`, false)}
                          confirmLabel="Save line"
                          confirmDisabled={lineFormInvalid(ef)}
                          onConfirm={() =>
                            run(
                              () =>
                                api.updateMissionLine(missionId, l.lineId, {
                                  expectedVersion: l.version,
                                  label: ef.label.trim(),
                                  amountMinor: positiveAmountToMinor(ef.amount)!,
                                  currency: ef.currency,
                                }),
                              'Line updated and recorded.',
                            ).then(() =>
                              setEdits((prev) => {
                                const { [l.lineId]: _drop, ...rest } = prev;
                                return rest;
                              }),
                            )
                          }
                        />
                        <GovernedAction
                          triggerLabel="Remove…"
                          triggerTestId={`remove-line-${l.lineId}`}
                          triggerAppearance="secondary"
                          title="Remove this line?"
                          description="The line is removed from the P&L immediately. The removal is recorded and auditable."
                          confirmLabel="Remove line"
                          onConfirm={() => run(() => api.removeMissionLine(missionId, l.lineId, l.version), 'Line removed and recorded.')}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {perDiemEntries.map((e) => (
              <tr key={`pd-${e.personId}`} data-testid={`pnl-perdiem-${e.personId}`}>
                <td>Expense</td>
                <td>Per-diem</td>
                <td>{`Per-diem — ${e.personName}`}</td>
                <td className="mono">
                  {e.total.status === 'ok' && e.days != null
                    ? `${formatMoney(e.amountMinor, e.currency)}/day × ${e.days}d = ${formatMoney(e.total.amountMinor, e.currency)}`
                    : e.total.status === 'unavailable' && e.total.reason === 'overflow'
                      ? `${formatMoney(e.amountMinor, e.currency)}/day — total ${PNL_REASON_LABEL.overflow}`
                      : `${formatMoney(e.amountMinor, e.currency)}/day`}
                </td>
                <td>—</td>
                {actionsCurrent && <td />}
              </tr>
            ))}
          </tbody>
        </ComparisonTable>
      )}

      {pnl && pnl.perCategory.length > 0 && (
        <ComparisonTable label="Budget vs actual by category" testId="pnl-categories">
          <thead>
            <tr>
              <th>Type</th>
              <th>Category</th>
              <th>Budget ≈</th>
              <th>Actual ≈</th>
              <th>Δ ≈</th>
            </tr>
          </thead>
          <tbody>
            {pnl.perCategory.map((c) => (
              <tr key={`${c.direction}-${c.category}`} data-testid={`pnl-category-${c.direction}-${c.category}`}>
                <td>{c.direction}</td>
                <td>{lineCategoryOf(c.category)}</td>
                <td className="mono">{pnlAmountText(c.budgetUsd, 'USD')}</td>
                <td className="mono" data-testid={`pnl-category-actual-${c.direction}-${c.category}`}>
                  {pnlAmountText(c.actualUsd, 'USD')}
                </td>
                <td className="mono" data-testid={`pnl-category-variance-${c.direction}-${c.category}`}>
                  {c.budget.length > 0 ? pnlAmountText(c.varianceUsd, 'USD') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </ComparisonTable>
      )}

      {pnl && (lines.length > 0 || perDiemEntries.length > 0) && (
        <div className="totals-stack">
          {pnl.settlement.outstandingIncomeCount > 0 && (
            <span className="record-quiet" data-testid="pnl-outstanding-income">
              {`${pnl.settlement.outstandingIncomeCount} income line${pnl.settlement.outstandingIncomeCount === 1 ? '' : 's'} not yet received.`}
            </span>
          )}
          {pnl.settlement.incomeComplete && (
            <span className="record-quiet" data-testid="pnl-income-complete">
              All income received — settlement-ready.
            </span>
          )}
          {pnl.perDiem.openEnded && perDiemEntries.length > 0 && (
            <span className="record-quiet" data-testid="pnl-open-ended-note">
              This mission has no end date — per-diem totals are not included until one is set.
            </span>
          )}
          {pnl.perCurrency.map((t) => (
            <span key={t.currency} className="record-quiet" data-testid={`pnl-currency-${t.currency}`}>
              {`${t.currency}: income ${pnlAmountText(t.income, t.currency)} · expenses ${pnlAmountText(t.expense, t.currency)}`}
            </span>
          ))}
          {pnl.blended.income.status === 'ok' && pnl.blended.expense.status === 'ok' && pnl.blended.profit.status === 'ok' ? (
            <>
              <span data-testid="pnl-income-usd">{`Income ≈ ${formatMoney(pnl.blended.income.amountMinor, 'USD')}`}</span>
              <span data-testid="pnl-expense-usd">{`Expenses ≈ ${formatMoney(pnl.blended.expense.amountMinor, 'USD')}`}</span>
              <span className="totals-conclusion" data-testid="pnl-profit-usd">{`Profit ≈ ${formatMoney(pnl.blended.profit.amountMinor, 'USD')}`}</span>
            </>
          ) : pnl.blended.profit.status === 'unavailable' && pnl.blended.profit.reason === 'overflow' ? (
            // R4 L-02: the HONEST reason — an overflow is a data-integrity refusal, never
            // to be misreported as a missing exchange rate.
            <span className="record-quiet" data-testid="pnl-overflow-note">
              No USD total — an amount in this P&L exceeds the exactly-representable range, so a trustworthy total cannot be computed.
            </span>
          ) : (
            <span className="record-quiet" data-testid="pnl-missing-rates">
              {`No USD total — missing exchange rate${pnl.missingRates.length > 1 ? 's' : ''} for ${pnl.missingRates.join(', ')} (set in Settings → Exchange rates).`}
            </span>
          )}
        </div>
      )}
      </RecheckingTruthPanel>
    </div>
  );
}
