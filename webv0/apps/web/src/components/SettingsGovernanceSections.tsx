import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DelegationDto } from '@c3web/api-contracts';
import { useBackupStatus, useDelegations, useMembers } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { DateInput, EmptyState, Input, Selector, StatusBadge, WorkSurface, type StatusVariant } from '../tablework';

/**
 * Tier 0.5 Settings sections (owner-only):
 *
 *  - DelegationSection — grant/revoke approver standing for a bounded window.
 *    The delegate may review and execute approvals, NEVER their own
 *    submissions (separation of duties is not delegable). One unrevoked
 *    delegation per grantee; rows are history and never deleted; the cockpit
 *    carries a DelegationActive check for as long as one is live.
 *
 *  - BackupStatusSection — one honest question: when did the last backup
 *    succeed? Reads the cron's status marker only. Unconfigured = says so.
 *
 * ── Wave 4 (Lane C): the last Fluent inside `.tw-root` ───────────────────────
 *
 * This file was the one component still rendering Fluent `Button` / `Input` /
 * `Dropdown` / `Option` INSIDE the kit's scope root — its consumer,
 * `SettingsPage`, converted in Wave 3 and left it read-only. Measured, that was
 * benign (a single 1px border, rgb(43,29,38) on rgb(247,234,215), legible) but
 * INCONSISTENT: the Grant button read square (4px) beside four sibling panels
 * whose buttons are pills. Converting it is what makes the screen one screen.
 *
 * Every mapping below is `SettingsPage`'s own, so these two panels are now
 * indistinguishable in construction from the four they sit under:
 *
 *   panel      → `WorkSurface tier="elevated" className="record-card"`. ⚠️
 *                `.record-card` carries the padding/rhythm and NO SURFACE — the
 *                border, background and elevation come from WorkSurface. Pairing
 *                them is mandatory; `.record-card` alone renders an invisible
 *                panel that typechecks and gates green.
 *                The Fluent-era `max-width: 720px` is DELIBERATELY dropped: the
 *                four sibling panels on this screen are full width, and being
 *                narrower than them was half of the inconsistency being fixed.
 *   head/title → `<header className="surface-heading"><div><h2>…` — the title
 *                becomes a REAL heading (it was a <span>), matching every
 *                sibling panel and making the section reachable by heading
 *                navigation. Copy verbatim.
 *   meta       → `.record-row-meta`
 *   row        → `.form-row` for the control rows; `.record-rows` +
 *                `.record-row-item` for the delegation LIST (the kit's register-
 *                row idiom, and what the per-diem list on this screen uses)
 *   note       → `.record-quiet`
 *   mono       → `.record-row-meta` (mono, caption, ink-quiet, nowrap — the id
 *                and the date window must not wrap)
 *   grantee    → `.record-row-name`
 *   state·…    → `StatusBadge`, whose variant colours ARE the Fluent-era ones
 *                (see STATE_VARIANT / the backup badges below)
 *
 * The empty list becomes the kit's `EmptyState` — the app-wide answer for a
 * `*-empty` testid, and honest by construction (empty ≠ unavailable ≠ denied).
 * Copy byte-identical.
 */

// KIT-GAP WORKAROUND (provisional — remove when the gap closes).
// GAP: the frozen kit has no WIDTH affordance for a bare native input. B1 added
//   `input[type='date']` / `input[type='number']` to the styled list at
//   `width: 100%`, which is right inside a `Field` (a grid track that sizes to
//   the control) and wrong for this screen's inline grant row: in a `.form-row`
//   (flex + wrap) a `width: 100%` item's flex base is the whole row, so each
//   input claims a line to itself and the row breaks apart. `Selector` already
//   carries the answer for pickers (`width="compact" | "wide"`, expressed as
//   min-width, no inline style); `Input`/`DateInput` have no equivalent. Nor can
//   these be wrapped in a `Field` instead — `Field` renders a visible label and
//   this row's copy is frozen: the two dates and the reason are labelled by
//   their placeholders and by the panel's own sentence, not by field labels.
//   (SettingsPage hit the identical gap on its two money rows and answered it
//   the identical way.)
// WORKAROUND: the Fluent-era `dateInput` / `reasonInput` declarations carried
//   verbatim as inline styles — 150px and min-width 220px + grow, byte-identical
//   to the pre-conversion row.
// CLASS: additive — a `width` prop on the kit's `Input`/`DateInput` mirroring
//   `Selector`'s (or `.field-compact` / `.field-grow` classes) closes it and
//   changes no converted call site.
const DATE_INPUT: React.CSSProperties = { width: '150px' };
const REASON_INPUT: React.CSSProperties = { minWidth: '220px', flexGrow: 1 };

/**
 * The delegation state's badge variant. Three of the four are the Fluent-era
 * colour EXACTLY: `ready` is --c3-state-success (the old `stateActive`), and
 * `neutral` is --c3-ink-quiet (the old `stateOff`, which both Expired and
 * Revoked carried). `Scheduled` is the one judgement call — Fluent gave it a
 * bare pill with no colour of its own; `info` follows this app's own vocabulary
 * for a decided-but-not-yet-in-force state (labels.ts maps mission `Confirmed`
 * to `info`), rather than `pending`, which this codebase reserves for something
 * awaiting a PERSON. A scheduled delegation awaits only the calendar.
 */
const STATE_VARIANT: Record<DelegationDto['state'], StatusVariant> = {
  Active: 'ready',
  Scheduled: 'info',
  Expired: 'neutral',
  Revoked: 'neutral',
};

export function DelegationSection() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageDelegations ?? false;
  const { data } = useDelegations(canManage);
  const { data: membersData } = useMembers(canManage);
  const [grantee, setGrantee] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [reason, setReason] = useState('');
  const [revokeFor, setRevokeFor] = useState<DelegationDto | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!canManage) return null;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['delegations'] });
  // candidates: active members whose role does not already carry review standing
  const candidates = (membersData?.members ?? []).filter((m) => m.isActive && m.role !== 'owner');

  async function grant() {
    setBusy(true);
    try {
      const res = await api.createDelegation({ granteeIdentity: grantee, startsOn, endsOn, reason });
      notify('success', `Granted ${res.delegation.delegationId} to ${res.delegation.granteeIdentity} until ${res.delegation.endsOn}`);
      setGrantee('');
      setStartsOn('');
      setEndsOn('');
      setReason('');
      refresh();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not grant the delegation.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revokeFor) return;
    setBusy(true);
    try {
      await api.revokeDelegation(revokeFor.delegationId, { expectedVersion: revokeFor.version, reason: revokeReason });
      notify('success', `Revoked ${revokeFor.delegationId}`);
      setRevokeFor(null);
      setRevokeReason('');
      refresh();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not revoke the delegation.');
    } finally {
      setBusy(false);
    }
  }

  const valid = grantee !== '' && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(endsOn) && endsOn >= startsOn && reason.trim() !== '';

  return (
    <WorkSurface tier="elevated" className="record-card" data-testid="delegation-panel">
      <header className="surface-heading">
        <div>
          <h2>Approver delegation</h2>
        </div>
        <span className="record-row-meta">owner only · window-bounded · audited</span>
      </header>
      <p className="record-quiet">
        Grant review+execute standing to a member while you are away. The delegate can never decide their own
        submissions, the cockpit shows the delegation for its whole life, and you can revoke it at any moment.
      </p>
      <div className="form-row">
        <Selector
          data-testid="delegation-grantee"
          value={grantee}
          // The Fluent Dropdown's trigger showed `value` — the bare email — while
          // the LIST showed "email (role)". `display` keeps that split verbatim;
          // `|| undefined` lets the unset state fall through to the placeholder.
          display={grantee || undefined}
          placeholder="Member…"
          options={candidates.map((m) => ({ value: m.email, label: `${m.email} (${m.role})` }))}
          onSelect={(value) => setGrantee(value)}
        />
        <DateInput style={DATE_INPUT} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} data-testid="delegation-starts" />
        <DateInput style={DATE_INPUT} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} data-testid="delegation-ends" />
        <Input
          style={REASON_INPUT}
          placeholder="Reason (audit narrative)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="delegation-reason"
        />
        <button className="primary-action" type="button" disabled={!valid || busy} onClick={() => void grant()} data-testid="delegation-grant">
          Grant
        </button>
      </div>
      {(data?.delegations ?? []).length === 0 && <EmptyState data-testid="delegation-empty" message="No delegations have ever been granted." />}
      <div className="record-rows">
        {(data?.delegations ?? []).map((d) => (
          <div className="record-row-item" key={d.delegationId} data-testid={`delegation-row-${d.delegationId}`}>
            <span className="record-row-meta">{d.delegationId}</span>
            <span className="record-row-name">{d.granteeIdentity}</span>
            <span className="record-row-meta">
              {d.startsOn} → {d.endsOn}
            </span>
            <StatusBadge variant={STATE_VARIANT[d.state]} data-testid={`delegation-state-${d.delegationId}`}>
              {d.state}
            </StatusBadge>
            {(d.state === 'Active' || d.state === 'Scheduled') &&
              (revokeFor?.delegationId === d.delegationId ? (
                <>
                  <Input
                    style={REASON_INPUT}
                    placeholder="Revocation reason (mandatory)"
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    data-testid="delegation-revoke-reason"
                  />
                  <button
                    className="primary-action"
                    type="button"
                    disabled={revokeReason.trim() === '' || busy}
                    onClick={() => void revoke()}
                    data-testid="delegation-revoke-confirm"
                  >
                    Confirm revoke
                  </button>
                  <button className="secondary-action" type="button" onClick={() => setRevokeFor(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="secondary-action" type="button" onClick={() => setRevokeFor(d)} data-testid={`delegation-revoke-${d.delegationId}`}>
                  Revoke…
                </button>
              ))}
          </div>
        ))}
      </div>
    </WorkSurface>
  );
}

export function BackupStatusSection() {
  const { me } = useSession();
  const canManage = me?.capabilities.canManageDelegations ?? false;
  const { data } = useBackupStatus(canManage);

  if (!canManage) return null;

  return (
    <WorkSurface tier="elevated" className="record-card" data-testid="backup-status-panel">
      <header className="surface-heading">
        <div>
          <h2>Backups</h2>
        </div>
        <span className="record-row-meta">read-only marker · threshold 36h</span>
      </header>
      <div className="form-row">
        {!data ? (
          <span className="record-quiet">Checking…</span>
        ) : !data.configured ? (
          <>
            {/* `neutral` IS --c3-ink-quiet — the Fluent-era `stateOff` colour, exactly. */}
            <StatusBadge variant="neutral" data-testid="backup-state">
              Not configured
            </StatusBadge>
            <span className="record-quiet">{data.reason}</span>
          </>
        ) : data.healthy ? (
          <>
            {/* `ready` IS --c3-state-success — the Fluent-era `stateActive` colour. */}
            <StatusBadge variant="ready" data-testid="backup-state">
              Healthy
            </StatusBadge>
            <span className="record-quiet">
              Last successful backup {data.ageHours}h ago (<span className="record-row-meta">{data.lastSuccessUtc}</span>).
            </span>
          </>
        ) : (
          <>
            {/* `blocked` IS --c3-state-danger — the Fluent-era `stateWarn` colour.
                A stale backup is a red fact, not an amber one; the pre-pivot
                screen already said so and this conversion does not soften it. */}
            <StatusBadge variant="blocked" data-testid="backup-state">
              Stale
            </StatusBadge>
            <span className="record-quiet">{data.reason}</span>
          </>
        )}
      </div>
    </WorkSurface>
  );
}
