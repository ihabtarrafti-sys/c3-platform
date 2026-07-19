import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Input, makeStyles, mergeClasses } from '@fluentui/react-components';
import type { RecycleItemDto } from '@c3web/api-contracts';
import { useRecycleBin } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { StatusBadge } from '../components/StatusBadge';
import { GovernedAction } from '../components/GovernedAction';
import { useRegisterStyles } from '../components/registerStyles';

/**
 * Recycle Bin (Track B2) — one place to see everything soft-removed, with who
 * removed it and when, and a Restore that goes through each domain's OWN
 * governance class: a person restore SUBMITS an approval (as its removal did);
 * entities and teams restore immediately (direct-audited, as they were
 * removed). Credentials/kit/apparel are visible here but managed from their
 * own record. Owner/operations only. Nothing is ever lost — this is a door.
 */

const KIND_LABEL: Record<RecycleItemDto['kind'], string> = {
  person: 'People',
  entity: 'Entities',
  team: 'Teams',
  credential: 'Credentials',
  kit: 'Kit',
  apparel: 'Apparel',
};

const useStyles = makeStyles({
  intro: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-muted)', maxWidth: '660px', marginBottom: '16px' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' },
  chip: {
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    letterSpacing: '0.06em',
    color: 'var(--c3-ink-muted)',
    backgroundColor: 'transparent',
    border: '1px solid var(--c3-border-subtle)',
    borderRadius: '999px',
    padding: '3px 11px',
    cursor: 'pointer',
    ':hover': { backgroundColor: 'var(--c3-hover)' },
  },
  chipActive: {
    color: 'var(--c3-ink-default)',
    borderTopColor: 'var(--c3-action-primary)',
    borderRightColor: 'var(--c3-action-primary)',
    borderBottomColor: 'var(--c3-action-primary)',
    borderLeftColor: 'var(--c3-action-primary)',
    backgroundColor: 'var(--c3-hover)',
  },
  recWrap: { fontSize: '13.5px', color: 'var(--c3-ink-default)', display: 'flex', flexDirection: 'column', rowGap: '2px' },
  recTitle: { display: 'flex', alignItems: 'baseline', columnGap: '8px' },
  recId: { fontFamily: 'var(--c3-font-mono)', fontSize: '11.5px', color: 'var(--c3-ink-quiet)' },
  recSub: { fontSize: '12px', color: 'var(--c3-ink-quiet)' },
  meta: { fontSize: '12.5px', color: 'var(--c3-ink-muted)' },
  metaWho: { fontFamily: 'var(--c3-font-mono)', fontSize: '11.5px', color: 'var(--c3-ink-quiet)' },
  recordLink: { fontSize: '12.5px', color: 'var(--c3-action-primary)' },
  muted: { fontSize: '12px', color: 'var(--c3-ink-quiet)' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '10px' },
});

function removedOn(iso: string): string {
  return iso.slice(0, 10);
}

/** Where a recordPage kind's "Open record" navigates. */
function recordRoute(item: RecycleItemDto): string {
  switch (item.kind) {
    case 'credential':
      return item.parentId ? `/people/${item.parentId}` : '/credentials';
    case 'kit':
      return '/kit';
    case 'apparel':
      return '/apparel';
    default:
      return '/people';
  }
}

export function RecycleBinPage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageEntities ?? false;
  const { data, isLoading, isError, error } = useRecycleBin(canManage);
  const [kindFilter, setKindFilter] = useState<RecycleItemDto['kind'] | null>(null);
  const [reason, setReason] = useState('');

  const all = useMemo(() => data?.items ?? [], [data]);
  const items = kindFilter ? all.filter((i) => i.kind === kindFilter) : all;
  const kindsPresent = useMemo(() => (Object.keys(KIND_LABEL) as RecycleItemDto['kind'][]).filter((k) => all.some((i) => i.kind === k)), [all]);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Recycle bin" />
        <EmptyState data-testid="recycle-denied" message="The recycle bin is available to owners and operations." />
      </div>
    );
  }

  async function restore(item: RecycleItemDto, withReason?: string): Promise<void> {
    try {
      const res = await api.restoreRecord(item.kind, item.id, item.version, withReason ?? null);
      if (res.outcome === 'approval-submitted') {
        notify('success', `Restore requested for ${item.id} — an owner must approve ${res.approvalId} to bring it back.`);
      } else {
        notify('success', `${item.id} restored.`);
      }
      setReason('');
      await qc.invalidateQueries({ queryKey: ['recycleBin'] });
      await qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Restore failed.');
    }
  }

  return (
    <div>
      <PageHeader kicker="Nothing is ever lost" title="Recycle bin" />
      <p className={s.intro}>
        Everything that has been removed, with who removed it and when. Restoring goes through the record’s own
        governance — a person’s restore is an approval an owner executes; an entity or team comes straight back.
        Credentials, kit and apparel are shown here and managed from their own page.
      </p>

      {isLoading && <LoadingState label="Gathering removed records…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load the recycle bin.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}

      {data && all.length === 0 && (
        <EmptyState data-testid="recycle-empty" message="Nothing has been removed — the recycle bin is empty." />
      )}

      {data && all.length > 0 && (
        <>
          {kindsPresent.length > 1 && (
            <div className={s.chips} data-testid="recycle-chips">
              <button type="button" className={mergeClasses(s.chip, kindFilter === null && s.chipActive)} onClick={() => setKindFilter(null)} data-testid="recycle-chip-all">
                All ({all.length})
              </button>
              {kindsPresent.map((k) => (
                <button
                  type="button"
                  key={k}
                  className={mergeClasses(s.chip, kindFilter === k && s.chipActive)}
                  onClick={() => setKindFilter(kindFilter === k ? null : k)}
                  data-testid={`recycle-chip-${k}`}
                >
                  {KIND_LABEL[k]} ({all.filter((i) => i.kind === k).length})
                </button>
              ))}
            </div>
          )}

          <table className={r.table} data-testid="recycle-table" aria-label="Recycle bin register">
            <thead>
              <tr>
                <th className={r.th}>Record</th>
                <th className={r.th}>Removed</th>
                <th className={r.th}>Restore</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.kind}-${item.id}`} className={r.row} data-testid={`recycle-row-${item.id}`}>
                  <td className={r.td}>
                    <div className={s.recWrap}>
                      <span className={s.recTitle}>
                        {item.label}
                        <span className={s.recId}>{item.id}</span>
                        <StatusBadge variant="neutral">{KIND_LABEL[item.kind]}</StatusBadge>
                      </span>
                      {item.sublabel && <span className={s.recSub}>{item.sublabel}</span>}
                    </div>
                  </td>
                  <td className={r.td}>
                    <div className={s.meta}>{removedOn(item.removedAt)}</div>
                    <div className={s.metaWho}>{item.removedBy ?? '—'}</div>
                  </td>
                  <td className={r.td}>
                    {item.restoreClass === 'direct' && (
                      <GovernedAction
                        triggerLabel="Restore"
                        triggerTestId={`recycle-restore-${item.id}`}
                        triggerAppearance="secondary"
                        title={`Restore ${item.id}?`}
                        description="This brings the record back immediately and is recorded in its history."
                        confirmLabel="Restore"
                        onConfirm={() => restore(item)}
                      />
                    )}
                    {item.restoreClass === 'governed' && (
                      <GovernedAction
                        triggerLabel="Restore…"
                        triggerTestId={`recycle-restore-${item.id}`}
                        triggerAppearance="secondary"
                        title={`Request restoring ${item.id}?`}
                        description="This restore goes through approval — an owner must execute it before the record is active again."
                        extra={
                          <div className={s.fields}>
                            <Field label="Reason" required>
                              <Input value={reason} onChange={(_, d) => setReason(d.value)} data-testid={`recycle-reason-${item.id}`} />
                            </Field>
                          </div>
                        }
                        confirmLabel="Submit for approval"
                        confirmDisabled={reason.trim() === ''}
                        onConfirm={() => restore(item, reason.trim())}
                      />
                    )}
                    {item.restoreClass === 'recordPage' && (
                      <Link className={s.recordLink} to={recordRoute(item)} data-testid={`recycle-open-${item.id}`}>
                        Open record →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
