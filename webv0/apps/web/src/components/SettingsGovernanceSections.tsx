import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Input, Option, makeStyles } from '@fluentui/react-components';
import type { DelegationDto } from '@c3web/api-contracts';
import { useBackupStatus, useDelegations, useMembers } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';

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
 */

const useStyles = makeStyles({
  panel: {
    maxWidth: '720px',
    marginTop: '24px',
    border: '1px solid var(--c3-line)',
    borderRadius: 'var(--c3-radius-data)',
    backgroundColor: 'var(--c3-surface-data)',
    boxShadow: 'var(--c3-e1)',
    overflow: 'hidden',
  },
  head: { display: 'flex', alignItems: 'baseline', padding: '14px 20px', borderBottom: '1px solid var(--c3-line)' },
  title: { fontSize: '14px', fontWeight: 600, color: 'var(--c3-ink)' },
  meta: {
    marginLeft: 'auto',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '10.5px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-muted)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    columnGap: '12px',
    rowGap: '8px',
    padding: '12px 20px',
    borderBottom: '1px solid var(--c3-line)',
    flexWrap: 'wrap',
  },
  note: { fontSize: '13px', color: 'var(--c3-ink-mid)', lineHeight: '20px' },
  mono: { fontFamily: 'var(--c3-font-mono)', fontSize: '12px', color: 'var(--c3-ink-muted)' },
  state: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '10.5px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    padding: '2px 8px',
    borderRadius: '999px',
    border: '1px solid var(--c3-line)',
  },
  stateActive: { color: 'var(--c3-status-ready)', borderTopColor: 'var(--c3-status-ready)', borderRightColor: 'var(--c3-status-ready)', borderBottomColor: 'var(--c3-status-ready)', borderLeftColor: 'var(--c3-status-ready)' },
  stateOff: { color: 'var(--c3-ink-muted)' },
  stateWarn: { color: 'var(--c3-attention)', borderTopColor: 'var(--c3-attention)', borderRightColor: 'var(--c3-attention)', borderBottomColor: 'var(--c3-attention)', borderLeftColor: 'var(--c3-attention)' },
  grantee: { fontSize: '13px', fontWeight: 600, color: 'var(--c3-ink)' },
  dateInput: { width: '150px' },
  reasonInput: { minWidth: '220px', flexGrow: 1 },
});

function stateClass(s: ReturnType<typeof useStyles>, state: DelegationDto['state']): string {
  if (state === 'Active') return `${s.state} ${s.stateActive}`;
  if (state === 'Scheduled') return s.state;
  return `${s.state} ${s.stateOff}`;
}

export function DelegationSection() {
  const s = useStyles();
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
    <div className={s.panel} data-testid="delegation-panel">
      <div className={s.head}>
        <span className={s.title}>Approver delegation</span>
        <span className={s.meta}>owner only · window-bounded · audited</span>
      </div>
      <div className={s.row}>
        <span className={s.note}>
          Grant review+execute standing to a member while you are away. The delegate can never decide their own
          submissions, the cockpit shows the delegation for its whole life, and you can revoke it at any moment.
        </span>
      </div>
      <div className={s.row}>
        <Dropdown
          placeholder="Member…"
          value={grantee}
          selectedOptions={grantee ? [grantee] : []}
          onOptionSelect={(_, d) => setGrantee(d.optionValue ?? '')}
          data-testid="delegation-grantee"
        >
          {candidates.map((m) => (
            <Option key={m.email} value={m.email} text={`${m.email} (${m.role})`}>
              {m.email} ({m.role})
            </Option>
          ))}
        </Dropdown>
        <Input className={s.dateInput} type="date" value={startsOn} onChange={(_, d) => setStartsOn(d.value)} data-testid="delegation-starts" />
        <Input className={s.dateInput} type="date" value={endsOn} onChange={(_, d) => setEndsOn(d.value)} data-testid="delegation-ends" />
        <Input
          className={s.reasonInput}
          placeholder="Reason (audit narrative)"
          value={reason}
          onChange={(_, d) => setReason(d.value)}
          data-testid="delegation-reason"
        />
        <Button appearance="primary" size="small" disabled={!valid || busy} onClick={() => void grant()} data-testid="delegation-grant">
          Grant
        </Button>
      </div>
      {(data?.delegations ?? []).length === 0 && (
        <div className={s.row} data-testid="delegation-empty">
          <span className={s.note}>No delegations have ever been granted.</span>
        </div>
      )}
      {(data?.delegations ?? []).map((d) => (
        <div className={s.row} key={d.delegationId} data-testid={`delegation-row-${d.delegationId}`}>
          <span className={s.mono}>{d.delegationId}</span>
          <span className={s.grantee}>{d.granteeIdentity}</span>
          <span className={s.mono}>
            {d.startsOn} → {d.endsOn}
          </span>
          <span className={stateClass(s, d.state)} data-testid={`delegation-state-${d.delegationId}`}>
            {d.state}
          </span>
          {(d.state === 'Active' || d.state === 'Scheduled') &&
            (revokeFor?.delegationId === d.delegationId ? (
              <>
                <Input
                  className={s.reasonInput}
                  placeholder="Revocation reason (mandatory)"
                  value={revokeReason}
                  onChange={(_, dd) => setRevokeReason(dd.value)}
                  data-testid="delegation-revoke-reason"
                />
                <Button size="small" appearance="primary" disabled={revokeReason.trim() === '' || busy} onClick={() => void revoke()} data-testid="delegation-revoke-confirm">
                  Confirm revoke
                </Button>
                <Button size="small" appearance="secondary" onClick={() => setRevokeFor(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="small" appearance="secondary" onClick={() => setRevokeFor(d)} data-testid={`delegation-revoke-${d.delegationId}`}>
                Revoke…
              </Button>
            ))}
        </div>
      ))}
    </div>
  );
}

export function BackupStatusSection() {
  const s = useStyles();
  const { me } = useSession();
  const canManage = me?.capabilities.canManageDelegations ?? false;
  const { data } = useBackupStatus(canManage);

  if (!canManage) return null;

  return (
    <div className={s.panel} data-testid="backup-status-panel">
      <div className={s.head}>
        <span className={s.title}>Backups</span>
        <span className={s.meta}>read-only marker · threshold 36h</span>
      </div>
      <div className={s.row}>
        {!data ? (
          <span className={s.note}>Checking…</span>
        ) : !data.configured ? (
          <>
            <span className={`${s.state} ${s.stateOff}`} data-testid="backup-state">
              Not configured
            </span>
            <span className={s.note}>{data.reason}</span>
          </>
        ) : data.healthy ? (
          <>
            <span className={`${s.state} ${s.stateActive}`} data-testid="backup-state">
              Healthy
            </span>
            <span className={s.note}>
              Last successful backup {data.ageHours}h ago (<span className={s.mono}>{data.lastSuccessUtc}</span>).
            </span>
          </>
        ) : (
          <>
            <span className={`${s.state} ${s.stateWarn}`} data-testid="backup-state">
              Stale
            </span>
            <span className={s.note}>{data.reason}</span>
          </>
        )}
      </div>
    </div>
  );
}
