/**
 * CommandAttention — the signed-in person's read-only attention relay.
 *
 * The ledger endpoint is person-scoped at the application/persistence
 * boundary: every obligation predicate is `me`, and its conversation rows are
 * true unread (lastSeq - my cursor) re-derived for this read. This module does
 * not widen that answer into an organisation queue. It can only open the
 * owning thread selected by its host; accepting, delivering and settling stay
 * with that record's governed surface.
 */
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { CommsLedgerResponse } from '@c3web/api-contracts';
import { ApiError } from '../api';
import { useCommsLedger } from '../queries';
import { CollectionFrame } from './collections';
import { WorkSurface } from './materials';
import { TruthPanel, truthStateOf, type WitnessState } from './TruthPanel';
import {
  withModuleChannelTruth,
  type ModuleChannelState,
} from './missionCommandModel';
import { useForegroundRewitness } from './useForegroundRewitness';

type LedgerObligation = CommsLedgerResponse['awaitingMyAcceptance'][number];
type LedgerThread = CommsLedgerResponse['threads'][number];

export type CommandAttentionTarget =
  | {
      readonly kind: 'obligation-thread';
      readonly obligationId: string;
      readonly threadId: string;
      readonly threadKind: LedgerObligation['threadKind'];
      readonly anchorType: string | null;
      readonly anchorId: string | null;
    }
  | {
      readonly kind: 'unread-thread';
      readonly threadId: string;
      readonly threadKind: LedgerThread['thread']['kind'];
      readonly anchorType: string | null;
      readonly anchorId: string | null;
    };

export interface CommandAttentionTruthFacts {
  readonly data: CommsLedgerResponse | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
  /** Attention owns the Comms channel witness passed by its host. It never
   * borrows the health of Mission, Finance, or another workspace module. */
  readonly channel: ModuleChannelState;
}

const isLedgerEmpty = (data: CommsLedgerResponse): boolean =>
  data.awaitingMyAcceptance.length === 0 &&
  data.awaitingMyDelivery.length === 0 &&
  data.awaitingMySettle.length === 0 &&
  data.watching.length === 0 &&
  data.threads.length === 0;

/** Six-state truth for Attention, independently testable from its React view. */
export function commandAttentionTruthOf({
  data,
  error,
  isLoading,
  isFetching,
  dataUpdatedAt,
  channel,
}: CommandAttentionTruthFacts): WitnessState {
  // The shared deriver classifies 403. Attention also treats an expired or
  // rejected session (401) as authoritative revocation of any cached rows.
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return { kind: 'denied', reasonClass: error.code || `HTTP_${error.status}` };
  }

  const base = truthStateOf(
    { data, error, isLoading, dataUpdatedAt },
    isLedgerEmpty,
  );

  if (
    isFetching &&
    data !== undefined &&
    (base.kind === 'verified' || base.kind === 'proven-empty')
  ) {
    return {
      kind: 'stale',
      verifiedAt: new Date(dataUpdatedAt > 0 ? dataUpdatedAt : 0),
      message: 'Your attention ledger is being checked again.',
    };
  }

  return withModuleChannelTruth(base, channel);
}

export interface CommandAttentionProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly channel: ModuleChannelState;
  readonly resolveHref: (target: CommandAttentionTarget) => string;
  readonly onTruthChange?: (truth: WitnessState) => void;
}

interface CommandAttentionViewProps {
  readonly data: CommsLedgerResponse | undefined;
  readonly truth: WitnessState;
  readonly resolveHref: (target: CommandAttentionTarget) => string;
}

interface StationDefinition {
  readonly key:
    | 'awaitingMyAcceptance'
    | 'awaitingMyDelivery'
    | 'awaitingMySettle'
    | 'watching';
  readonly title: string;
  readonly hint: string;
  readonly empty: string;
}

const STATIONS: readonly StationDefinition[] = [
  {
    key: 'awaitingMyAcceptance',
    title: 'Awaiting my acceptance',
    hint: 'Delivered to you; judgment stays with the owning obligation.',
    empty: 'Nothing is waiting for your acceptance.',
  },
  {
    key: 'awaitingMyDelivery',
    title: 'Awaiting my delivery',
    hint: 'You are the accountable owner; delivery stays with the owning obligation.',
    empty: 'Nothing is waiting for your delivery.',
  },
  {
    key: 'awaitingMySettle',
    title: 'Awaiting my settle',
    hint: 'Done is claimed; settlement stays with the owning obligation.',
    empty: 'Nothing is waiting for your settlement.',
  },
  {
    key: 'watching',
    title: 'Watching',
    hint: 'You asked; another accountable person owns the next act.',
    empty: 'Nothing you requested is waiting on another person.',
  },
] as const;

function obligationTarget(row: LedgerObligation): CommandAttentionTarget {
  return {
    kind: 'obligation-thread',
    obligationId: row.obligation.obligationId,
    threadId: row.obligation.threadId,
    threadKind: row.threadKind,
    anchorType: row.anchorType,
    anchorId: row.anchorId,
  };
}

function unreadTarget(row: LedgerThread): CommandAttentionTarget {
  return {
    kind: 'unread-thread',
    threadId: row.thread.threadId,
    threadKind: row.thread.kind,
    anchorType: row.thread.anchorType,
    anchorId: row.thread.anchorId,
  };
}

function AttentionStation({
  definition,
  rows,
  resolveHref,
}: {
  readonly definition: StationDefinition;
  readonly rows: readonly LedgerObligation[];
  readonly resolveHref: (target: CommandAttentionTarget) => string;
}) {
  return (
    <WorkSurface className="comms-surface" aria-label={definition.title}>
      <header className="surface-heading">
        <div>
          <h2>{definition.title}</h2>
          <p>{definition.hint}</p>
        </div>
        <span className="state-label info" aria-label={`${rows.length} items`}>
          {rows.length}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="record-quiet">{definition.empty}</p>
      ) : (
        <div className="obligation-stack">
          {rows.map((row) => (
            <article
              className="group-box"
              data-testid={`attention-obligation-${row.obligation.obligationId}`}
              key={row.obligation.obligationId}
            >
              <header>
                <strong>{row.obligation.description}</strong>
                <small>
                  {row.obligation.obligationId} · due {new Date(row.obligation.dueAt).toLocaleString()} ·{' '}
                  {row.obligation.state}
                </small>
              </header>
              <p className="cell-note">
                {row.threadKind === 'anchored'
                  ? `Anchored: ${row.anchorType} ${row.anchorId}`
                  : row.threadKind === 'direct'
                    ? 'From a direct thread'
                    : `From the room “${row.threadTitle ?? 'private room'}”`}
              </p>
              <div className="message-actions">
                <Link className="mini-action" to={resolveHref(obligationTarget(row))}>
                  Open where it lives
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </WorkSurface>
  );
}

function UnreadConversations({
  rows,
  resolveHref,
}: {
  readonly rows: readonly LedgerThread[];
  readonly resolveHref: (target: CommandAttentionTarget) => string;
}) {
  return (
    <WorkSurface className="comms-surface" aria-label="Unread conversations">
      <header className="surface-heading">
        <div>
          <h2>Unread conversations</h2>
          <p>lastSeq − your cursor, derived for this read</p>
        </div>
        <span className="state-label info" aria-label={`${rows.length} conversations`}>
          {rows.length}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="record-quiet">No unread conversations were proven by this read.</p>
      ) : (
        <div className="thread-list">
          {rows.map((row) => (
            <Link
              key={row.thread.threadId}
              className="thread-item"
              data-testid={`attention-thread-${row.thread.threadId}`}
              to={resolveHref(unreadTarget(row))}
            >
              <strong>
                {row.thread.kind === 'anchored'
                  ? `${row.thread.anchorType} ${row.thread.anchorId}`
                  : (row.thread.title ?? (row.thread.kind === 'direct' ? 'Direct thread' : 'Room'))}
              </strong>
              <small>
                {row.unread} unread · {row.thread.kind}
              </small>
            </Link>
          ))}
        </div>
      )}
    </WorkSurface>
  );
}

/** Pure rendering seam used by the workspace module and its contract tests. */
export function CommandAttentionView({ data, truth, resolveHref }: CommandAttentionViewProps) {
  const personalObligationCount = data
    ? data.awaitingMyAcceptance.length +
      data.awaitingMyDelivery.length +
      data.awaitingMySettle.length +
      data.watching.length
    : 0;
  const countVisible = data !== undefined && (truth.kind === 'verified' || truth.kind === 'stale');

  return (
    <CollectionFrame
      kicker="Personal relay"
      title="My attention"
      count={
        countVisible
          ? `${personalObligationCount} obligation${personalObligationCount === 1 ? '' : 's'} · ${data.threads.length} unread conversation${data.threads.length === 1 ? '' : 's'}`
          : undefined
      }
      scope="Only what awaits the signed-in person's attention. This view can open an owning record; it cannot act on one."
    >
      <TruthPanel
        state={truth}
        emptyLabel="You are caught up — this read found nothing awaiting your attention."
        testids={{
          loading: 'attention-loading',
          verified: 'attention-verified',
          empty: 'attention-empty',
          denied: 'attention-denied',
          failed: 'attention-failed',
          stale: 'attention-stale',
        }}
      >
        {data ? (
          <div className="command-attention-grid">
            <div style={{ display: 'grid', gap: 'var(--space-4, 1rem)' }}>
              {STATIONS.map((definition) => (
                <AttentionStation
                  key={definition.key}
                  definition={definition}
                  rows={data[definition.key]}
                  resolveHref={resolveHref}
                />
              ))}
            </div>
            <UnreadConversations rows={data.threads} resolveHref={resolveHref} />
          </div>
        ) : null}
      </TruthPanel>
    </CollectionFrame>
  );
}

export function CommandAttention({
  enabled = true,
  foreground = true,
  channel,
  resolveHref,
  onTruthChange,
}: CommandAttentionProps) {
  const query = useCommsLedger(enabled);
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = query;
  const rewitnessing = useForegroundRewitness({ foreground, enabled, refetch });
  const truth = useMemo(
    () =>
      commandAttentionTruthOf({
        data,
        error,
        isLoading,
        isFetching: isFetching || rewitnessing,
        dataUpdatedAt,
        channel,
      }),
    [data, error, isLoading, isFetching, rewitnessing, dataUpdatedAt, channel],
  );

  useEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  return <CommandAttentionView data={data} truth={truth} resolveHref={resolveHref} />;
}
