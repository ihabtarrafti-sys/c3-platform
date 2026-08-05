import type { CommsMessageDto, CommsObligationDto } from '@c3web/api-contracts';
import type { WitnessState } from './TruthPanel';

export type ContinuityBearing = 'standing' | 'history';

export type ContinuityRecordRef =
  | { readonly kind: 'message'; readonly id: string }
  | { readonly kind: 'obligation'; readonly id: string };

export type ContinuityProvenance =
  | {
      readonly kind: 'message';
      readonly threadId: string;
      readonly seq: number;
      readonly revisionNo: number;
      readonly authorship: CommsMessageDto['authorship'];
      readonly supersedesMessageId: string | null;
      readonly supersededByMessageIds: readonly string[];
    }
  | {
      readonly kind: 'recall';
      readonly reasonCode: 'AuthorRecall' | 'ModeratorRemoval';
      readonly actorLabel: string | null;
    }
  | {
      readonly kind: 'obligation';
      readonly threadId: string;
      readonly requesterUserId: string;
      readonly sourceMessageId: string | null;
      readonly currentState: CommsObligationDto['state'];
    }
  | {
      readonly kind: 'obligation-transition';
      readonly eventType: string;
      readonly fromState: CommsObligationDto['events'][number]['fromState'];
      readonly toState: CommsObligationDto['events'][number]['toState'];
      readonly actorUserId: string;
      readonly actorLabel: string | null;
      readonly reason: string | null;
      readonly attestation: string | null;
      readonly deliveryEpisodeVersion: number | null;
    }
  | {
      readonly kind: 'evidence';
      readonly documentId: string;
      readonly fileName: string;
      readonly contentType: string;
      readonly sizeBytes: number;
      readonly deliveredByUserId: string;
      readonly delivererLabel: string | null;
      readonly note: string | null;
    };

export interface MissionContinuityEntry {
  readonly id: string;
  readonly kind: 'message-recorded' | 'message-recalled' | 'obligation-created' | 'obligation-transition' | 'evidence-delivered';
  readonly occurredAt: string;
  readonly record: ContinuityRecordRef;
  /** Standing identifies the source record's current posture. History remains
   * durable, but is never presented as the posture that stands now. */
  readonly bearing: ContinuityBearing;
  readonly title: string;
  readonly detail: string;
  readonly provenance: ContinuityProvenance;
}

export interface MissionContinuitySources {
  readonly messages: readonly CommsMessageDto[];
  readonly messageTruth: WitnessState;
  readonly obligations: readonly CommsObligationDto[];
  readonly obligationTruth: WitnessState;
}

export interface MissionContinuityProps extends MissionContinuitySources {
  readonly onFocusMessage: (messageId: string) => void;
  readonly onFocusObligation: (obligationId: string) => void;
}

const KIND_ORDER: Readonly<Record<MissionContinuityEntry['kind'], number>> = {
  'message-recorded': 0,
  'obligation-created': 1,
  'obligation-transition': 2,
  'evidence-delivered': 3,
  'message-recalled': 4,
};

function comparableTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function compareEntries(left: MissionContinuityEntry, right: MissionContinuityEntry): number {
  const leftTime = comparableTime(left.occurredAt);
  const rightTime = comparableTime(right.occurredAt);
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  const rawTime = left.occurredAt.localeCompare(right.occurredAt);
  if (rawTime !== 0) return rawTime;
  const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (kind !== 0) return kind;
  return left.id.localeCompare(right.id);
}

function latestStandingEventIndex(obligation: CommsObligationDto): number | null {
  if (obligation.events.length === 0) return null;
  const ordered = obligation.events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftTime = comparableTime(left.event.at);
      const rightTime = comparableTime(right.event.at);
      if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
      const rawTime = left.event.at.localeCompare(right.event.at);
      if (rawTime !== 0) return rawTime;
      // The event array is the source ledger order. It is used only to break an
      // exact timestamp tie, never to invent an event or a causal relationship.
      return left.index - right.index;
    });
  const latest = ordered.at(-1);
  return latest?.event.toState === obligation.state ? latest.index : null;
}

/**
 * A deterministic read projection over the two records already witnessed by
 * the caller. It does not derive causality, completion, acceptance, or
 * settlement. In particular, evidence and transitions remain separate rows
 * even when their timestamps or delivery-episode numbers align.
 */
export function projectMissionContinuity(
  messages: readonly CommsMessageDto[],
  obligations: readonly CommsObligationDto[],
): readonly MissionContinuityEntry[] {
  const entries: MissionContinuityEntry[] = [];
  const supersededBy = new Map<string, string[]>();

  for (const message of messages) {
    if (message.recalled || message.supersedesMessageId === null) continue;
    const successors = supersededBy.get(message.supersedesMessageId) ?? [];
    successors.push(message.messageId);
    supersededBy.set(message.supersedesMessageId, successors);
  }
  for (const successors of supersededBy.values()) successors.sort((left, right) => left.localeCompare(right));

  for (const message of messages) {
    const successors = supersededBy.get(message.messageId) ?? [];
    entries.push({
      id: `message:${message.messageId}:recorded`,
      kind: 'message-recorded',
      occurredAt: message.createdAt,
      record: { kind: 'message', id: message.messageId },
      bearing: message.recalled || successors.length > 0 ? 'history' : 'standing',
      title: message.recalled ? 'Message record created' : message.messageKind === 'decision' ? 'Decision recorded' : 'Message recorded',
      detail: message.recalled
        ? 'The message body is unavailable because the standing record is now a recall tombstone.'
        : message.body,
      provenance: {
        kind: 'message',
        threadId: message.threadId,
        seq: message.seq,
        revisionNo: message.revisionNo,
        authorship: message.authorship,
        supersedesMessageId: message.recalled ? null : message.supersedesMessageId,
        supersededByMessageIds: successors,
      },
    });

    if (message.recalled) {
      entries.push({
        id: `message:${message.messageId}:recall`,
        kind: 'message-recalled',
        occurredAt: message.recall.at,
        record: { kind: 'message', id: message.messageId },
        bearing: 'standing',
        title: message.recall.reasonCode === 'ModeratorRemoval' ? 'Message removed by moderation' : 'Message recalled by its author',
        detail: 'The recall tombstone stands. This trace makes no claim about downstream records.',
        provenance: {
          kind: 'recall',
          reasonCode: message.recall.reasonCode,
          actorLabel: message.recall.actorLabel,
        },
      });
    }
  }

  for (const obligation of obligations) {
    const standingEventIndex = latestStandingEventIndex(obligation);
    entries.push({
      id: `obligation:${obligation.obligationId}:created`,
      kind: 'obligation-created',
      occurredAt: obligation.createdAt,
      record: { kind: 'obligation', id: obligation.obligationId },
      bearing: obligation.events.length === 0 && obligation.state === 'Open' ? 'standing' : 'history',
      title: 'Obligation recorded',
      detail: obligation.description,
      provenance: {
        kind: 'obligation',
        threadId: obligation.threadId,
        requesterUserId: obligation.requesterUserId,
        sourceMessageId: obligation.sourceMessageId,
        currentState: obligation.state,
      },
    });

    obligation.events.forEach((event, index) => {
      entries.push({
        id: `obligation:${obligation.obligationId}:event:${index}`,
        kind: 'obligation-transition',
        occurredAt: event.at,
        record: { kind: 'obligation', id: obligation.obligationId },
        bearing: standingEventIndex === index ? 'standing' : 'history',
        title: readableEventType(event.eventType),
        detail: event.fromState === null ? `State recorded as ${event.toState}.` : `${event.fromState} → ${event.toState}.`,
        provenance: {
          kind: 'obligation-transition',
          eventType: event.eventType,
          fromState: event.fromState,
          toState: event.toState,
          actorUserId: event.actorUserId,
          actorLabel: event.actorLabel,
          reason: event.reason,
          attestation: event.attestation,
          deliveryEpisodeVersion: event.deliveryEpisodeVersion,
        },
      });
    });

    for (const evidence of obligation.evidence) {
      entries.push({
        id: `obligation:${obligation.obligationId}:evidence:${evidence.documentId}`,
        kind: 'evidence-delivered',
        occurredAt: evidence.deliveredAt,
        record: { kind: 'obligation', id: obligation.obligationId },
        // Delivery is a durable historical fact. It is not the obligation's
        // standing state, and it cannot make acceptance, Done, or settlement.
        bearing: 'history',
        title: 'Evidence delivered',
        detail: evidence.fileName,
        provenance: {
          kind: 'evidence',
          documentId: evidence.documentId,
          fileName: evidence.fileName,
          contentType: evidence.contentType,
          sizeBytes: evidence.sizeBytes,
          deliveredByUserId: evidence.deliveredByUserId,
          delivererLabel: evidence.delivererLabel,
          note: evidence.note,
        },
      });
    }
  }

  return entries.sort(compareEntries);
}

function currentWitnessAt(state: WitnessState): Date | null {
  return state.kind === 'verified' || state.kind === 'proven-empty' ? state.at : null;
}

function readableEventType(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return spaced.length === 0 ? 'Obligation event' : `${spaced[0]?.toUpperCase() ?? ''}${spaced.slice(1).toLowerCase()}`;
}

function earlierWitness(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function currentSourceIsConsistent(records: readonly unknown[], state: WitnessState): boolean {
  if (state.kind === 'verified') return records.length > 0;
  if (state.kind === 'proven-empty') return records.length === 0;
  return true;
}

/** Join two independently-derived witnesses without upgrading either one. */
export function joinMissionContinuityWitness(sources: MissionContinuitySources): WitnessState {
  const states = [
    { label: 'messages', state: sources.messageTruth },
    { label: 'obligations', state: sources.obligationTruth },
  ] as const;

  const denied = states.filter((source) => source.state.kind === 'denied');
  if (denied.length > 0) {
    return {
      kind: 'denied',
      reasonClass: denied
        .map((source) => `${source.label}:${source.state.kind === 'denied' ? source.state.reasonClass : 'denied'}`)
        .join(','),
    };
  }

  const failed = states.filter((source) => source.state.kind === 'fetch-failed');
  if (failed.length > 0) {
    return {
      kind: 'fetch-failed',
      message: failed
        .map((source) => `${source.label}: ${source.state.kind === 'fetch-failed' ? source.state.message : 'The request failed.'}`)
        .join(' '),
    };
  }

  if (states.some((source) => source.state.kind === 'loading')) return { kind: 'loading' };

  const stale = states.filter((source) => source.state.kind === 'stale');
  if (stale.length > 0) {
    const verifiedAt = stale
      .map((source) => (source.state.kind === 'stale' ? source.state.verifiedAt : new Date(0)))
      .reduce(earlierWitness);
    return {
      kind: 'stale',
      verifiedAt,
      message: `${stale.map((source) => source.label).join(' and ')} ${stale.length === 1 ? 'is' : 'are'} stale; the retained trace may be incomplete.`,
    };
  }

  if (
    !currentSourceIsConsistent(sources.messages, sources.messageTruth) ||
    !currentSourceIsConsistent(sources.obligations, sources.obligationTruth)
  ) {
    return { kind: 'fetch-failed', message: 'The continuity records disagree with their independent witnesses.' };
  }

  const messageAt = currentWitnessAt(sources.messageTruth);
  const obligationAt = currentWitnessAt(sources.obligationTruth);
  if (messageAt === null || obligationAt === null) {
    return { kind: 'fetch-failed', message: 'A continuity source has no current witness.' };
  }
  const at = earlierWitness(messageAt, obligationAt);
  if (sources.messages.length === 0 && sources.obligations.length === 0) return { kind: 'proven-empty', at };
  return { kind: 'verified', at };
}

function sourceMayRender(records: readonly unknown[], state: WitnessState): boolean {
  if (state.kind === 'stale') return true;
  if (state.kind === 'verified') return records.length > 0;
  return false;
}

function formatAt(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Timestamp unavailable';
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function witnessCopy(state: WitnessState): string {
  switch (state.kind) {
    case 'verified':
      return `Complete through ${formatAt(state.at)} — both independent registers are current.`;
    case 'proven-empty':
      return `No mission continuity records yet — both registers were verified empty at ${formatAt(state.at)}.`;
    case 'loading':
      return 'Checking messages and obligations. No complete timeline is claimed.';
    case 'denied':
      return `Continuity is incomplete because a source is denied (${state.reasonClass}).`;
    case 'fetch-failed':
      return `Continuity is incomplete. ${state.message}`;
    case 'stale':
      return `Retained trace last witnessed at ${formatAt(state.verifiedAt)}. It may be incomplete. ${state.message}`;
  }
}

function authoredBy(entry: MissionContinuityEntry): string | null {
  switch (entry.provenance.kind) {
    case 'message': {
      const authorship = entry.provenance.authorship;
      return authorship.label?.trim() || `Member · ${authorship.userId}`;
    }
    case 'recall':
      return entry.provenance.actorLabel?.trim() || 'Actor label unavailable';
    case 'obligation':
      return `Requester account · ${entry.provenance.requesterUserId}`;
    case 'obligation-transition':
      return entry.provenance.actorLabel?.trim() || `Member · ${entry.provenance.actorUserId}`;
    case 'evidence':
      return entry.provenance.delivererLabel?.trim() || `Member · ${entry.provenance.deliveredByUserId}`;
  }
}

function ProvenanceDetails({ entry }: { readonly entry: MissionContinuityEntry }) {
  const provenance = entry.provenance;
  return (
    <div className="cell-note mission-continuity-provenance" data-continuity-provenance={provenance.kind}>
      <span>{authoredBy(entry)}</span>
      {provenance.kind === 'message' ? (
        <>
          <span>Thread {provenance.threadId} · sequence {provenance.seq} · revision {provenance.revisionNo}</span>
          {provenance.supersedesMessageId ? <span>Explicitly supersedes {provenance.supersedesMessageId}.</span> : null}
          {provenance.supersededByMessageIds.length > 0 ? (
            <span>Explicitly superseded by {provenance.supersededByMessageIds.join(', ')}.</span>
          ) : null}
        </>
      ) : null}
      {provenance.kind === 'recall' ? <span>Reason class · {provenance.reasonCode}</span> : null}
      {provenance.kind === 'obligation' ? (
        <>
          <span>Current recorded state · {provenance.currentState}</span>
          {provenance.sourceMessageId ? <span>Recorded source message · {provenance.sourceMessageId}</span> : null}
        </>
      ) : null}
      {provenance.kind === 'obligation-transition' ? (
        <>
          {provenance.reason ? <span>Recorded reason · {provenance.reason}</span> : null}
          {provenance.attestation ? <span>Recorded attestation · {provenance.attestation}</span> : null}
          {provenance.deliveryEpisodeVersion !== null ? <span>Delivery episode · {provenance.deliveryEpisodeVersion}</span> : null}
        </>
      ) : null}
      {provenance.kind === 'evidence' ? (
        <>
          <span>Document {provenance.documentId} · {provenance.contentType} · {provenance.sizeBytes} bytes</span>
          {provenance.note ? <span>Delivery note · {provenance.note}</span> : null}
        </>
      ) : null}
    </div>
  );
}

export function MissionContinuity({
  messages,
  messageTruth,
  obligations,
  obligationTruth,
  onFocusMessage,
  onFocusObligation,
}: MissionContinuityProps) {
  const witness = joinMissionContinuityWitness({ messages, messageTruth, obligations, obligationTruth });
  const visibleMessages = sourceMayRender(messages, messageTruth) ? messages : [];
  const visibleObligations = sourceMayRender(obligations, obligationTruth) ? obligations : [];
  const entries = projectMissionContinuity(visibleMessages, visibleObligations);
  const complete = witness.kind === 'verified' || witness.kind === 'proven-empty';

  return (
    <section
      className="mission-continuity"
      data-tablework="MissionContinuity"
      data-continuity-complete={complete ? 'true' : 'false'}
      data-truth={witness.kind}
      aria-label="Mission continuity"
    >
      <p className="boundary-note" role="status">
        {witnessCopy(witness)}
      </p>
      {entries.length > 0 ? (
        <ol className="mission-continuity-trace" data-continuity-trace>
          {entries.map((entry) => (
            <li key={entry.id} className="mission-continuity-entry" data-continuity-kind={entry.kind} data-continuity-bearing={entry.bearing}>
              <article>
                <header>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>
                      <time dateTime={entry.occurredAt}>{formatAt(entry.occurredAt)}</time> · {entry.bearing === 'standing' ? 'Standing record' : 'History'}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="quiet-action"
                    data-focus-record={`${entry.record.kind}:${entry.record.id}`}
                    onClick={() =>
                      entry.record.kind === 'message' ? onFocusMessage(entry.record.id) : onFocusObligation(entry.record.id)
                    }
                  >
                    Focus {entry.record.id}
                  </button>
                </header>
                <p>{entry.detail}</p>
                <ProvenanceDetails entry={entry} />
              </article>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="boundary-note">This trace orders recorded facts. It infers no causality, acceptance, completion, or settlement.</p>
    </section>
  );
}
