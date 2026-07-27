import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { RecycleItemDto } from '@c3web/api-contracts';
import { useRecycleBin } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
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
  GovernedAction,
} from '../tablework';

/**
 * Recycle Bin (Track B2) — one place to see everything soft-removed, with who
 * removed it and when, and a Restore that goes through each domain's OWN
 * governance class: a person restore SUBMITS an approval (as its removal did);
 * entities and teams restore immediately (direct-audited, as they were
 * removed). Credentials/kit/apparel are visible here but managed from their
 * own record. Owner/operations only. Nothing is ever lost — this is a door.
 *
 * Tablework conversion (pivot W3, Lane 4). Behaviour/testids/copy verbatim.
 *
 * ⚠️ `recycleBin.spec.ts:47` reads a row's `data-testid` off the element and
 * strips the `recycle-row-` prefix to recover the id, so THE ROW TESTID MUST
 * STAY ON THE `<tr>` — `ComparisonTable` only owns the outer scroll div (which
 * carries `recycle-table`) and the `<table>`; every `<tr>` is still ours.
 *
 * The removed-on date stays the raw ISO slice — `formatDisplayDate` is a
 * NEGATIVE contract for converted screens.
 */

const KIND_LABEL: Record<RecycleItemDto['kind'], string> = {
  person: 'People',
  entity: 'Entities',
  team: 'Teams',
  credential: 'Credentials',
  kit: 'Kit',
  apparel: 'Apparel',
};

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
  return (
    <TableworkPage record="Recycle bin" section="Register" wide>
      <RecycleBinRegister />
    </TableworkPage>
  );
}

function RecycleBinRegister() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageEntities ?? false;
  // The wire law: the capability IS the react-query `enabled` flag.
  const { data, isLoading, isError, error } = useRecycleBin(canManage);
  const [kindFilter, setKindFilter] = useState<RecycleItemDto['kind'] | null>(null);
  const [reason, setReason] = useState('');

  const all = useMemo(() => data?.items ?? [], [data]);
  const items = kindFilter ? all.filter((i) => i.kind === kindFilter) : all;
  const kindsPresent = useMemo(() => (Object.keys(KIND_LABEL) as RecycleItemDto['kind'][]).filter((k) => all.some((i) => i.kind === k)), [all]);

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

  if (!canManage) {
    return (
      <CollectionFrame title="Recycle bin">
        {/* denied !== empty: `recycle-denied` is the role-gate assertion. */}
        <EmptyState data-testid="recycle-denied" message="The recycle bin is available to owners and operations." />
      </CollectionFrame>
    );
  }

  return (
    <CollectionFrame
      kicker="Nothing is ever lost"
      title="Recycle bin"
      scope="Everything that has been removed, with who removed it and when. Restoring goes through the record’s own governance — a person’s restore is an approval an owner executes; an entity or team comes straight back. Credentials, kit and apparel are shown here and managed from their own page."
    >
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
            <div className="filter-chips" data-testid="recycle-chips">
              <button
                type="button"
                className={kindFilter === null ? 'filter-chip active' : 'filter-chip'}
                onClick={() => setKindFilter(null)}
                data-testid="recycle-chip-all"
              >
                All ({all.length})
              </button>
              {kindsPresent.map((k) => (
                <button
                  type="button"
                  key={k}
                  className={kindFilter === k ? 'filter-chip active' : 'filter-chip'}
                  onClick={() => setKindFilter(kindFilter === k ? null : k)}
                  data-testid={`recycle-chip-${k}`}
                >
                  {KIND_LABEL[k]} ({all.filter((i) => i.kind === k).length})
                </button>
              ))}
            </div>
          )}

          <ComparisonTable label="Recycle bin register" testId="recycle-table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Removed</th>
                <th>Restore</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.kind}-${item.id}`} data-testid={`recycle-row-${item.id}`}>
                  <td>
                    <div>
                      {item.label}{' '}
                      <span className="record-row-meta">{item.id}</span>{' '}
                      <StatusBadge variant="neutral">{KIND_LABEL[item.kind]}</StatusBadge>
                    </div>
                    {item.sublabel && <div className="record-quiet">{item.sublabel}</div>}
                  </td>
                  <td>
                    <div>{removedOn(item.removedAt)}</div>
                    <div className="record-row-meta">{item.removedBy ?? '—'}</div>
                  </td>
                  <td>
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
                          <Field label="Reason" required>
                            <Input value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`recycle-reason-${item.id}`} />
                          </Field>
                        }
                        confirmLabel="Submit for approval"
                        confirmDisabled={reason.trim() === ''}
                        onConfirm={() => restore(item, reason.trim())}
                      />
                    )}
                    {item.restoreClass === 'recordPage' && (
                      <Link className="quiet-action" to={recordRoute(item)} data-testid={`recycle-open-${item.id}`}>
                        Open record →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </ComparisonTable>
        </>
      )}
    </CollectionFrame>
  );
}
