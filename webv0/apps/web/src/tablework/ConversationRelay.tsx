/**
 * ConversationRelay — one lawful room/direct-thread controller that can live
 * either on its standalone page or in the runtime-only Workspace OS slot.
 *
 * The host owns the live channel. A workspace therefore opens no second
 * stream, and a stream signal still causes an ordinary gated room re-read.
 * Thread identity is a prop, never geometry or saved-layout state.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ThreadRoomResponse } from '@c3web/api-contracts';
import type { CommsLinkInput } from '@c3web/domain';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useCommsDirectory, useCommsPrefs, useThreadRoom } from '../queries';
import { useSession } from '../session';
import {
  playArrivalSound,
  type CommsLiveResource,
} from '../useCommsLive';
import {
  isActionableWitness,
  withModuleChannelTruth,
} from './missionCommandModel';
import { Thread } from './Thread';
import { ToastStack } from './Toast';
import { truthStateOf, type WitnessState } from './TruthPanel';
import { useForegroundRewitness } from './useForegroundRewitness';
import { WorkSurface } from './materials';

export interface ConversationRelayMeta {
  readonly record: string;
  readonly kindLabel: 'Direct thread' | 'Room' | 'Conversation';
  readonly unavailable: boolean;
}

export interface ConversationRelayTruthFacts {
  readonly data: ThreadRoomResponse | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
  readonly channel: CommsLiveResource['state'];
}

export type ConversationWriteBoundary = 'post' | 'seat';
export type ConversationWriteRefusal =
  | 'ordinary-failure'
  | 'module-read-only'
  | 'conversation-write-revoked'
  | 'room-unavailable'
  | 'seat-administration-revoked';

/** A concealed seat-write 404 is deliberately NOT treated as a missing room:
 * it may name an invitee who ceased to be addressable. Only the room GET may
 * make that privacy-sensitive conclusion. */
export function conversationWriteRefusalOf(
  error: unknown,
  boundary: ConversationWriteBoundary,
): ConversationWriteRefusal {
  if (!(error instanceof ApiError)) return 'ordinary-failure';
  if (error.code === 'MODULE_READ_ONLY') return 'module-read-only';
  if (error.status !== 401 && error.status !== 403 && error.status !== 404) return 'ordinary-failure';
  if (boundary === 'seat') return 'seat-administration-revoked';
  return error.status === 404 ? 'room-unavailable' : 'conversation-write-revoked';
}

/** A room owns both its gated read and its live-channel witness. Cached rows
 * cannot remain current through revalidation or an authoritative refusal. */
export function conversationRelayTruthOf({
  data,
  error,
  isLoading,
  isFetching,
  dataUpdatedAt,
  channel,
}: ConversationRelayTruthFacts): WitnessState {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
    return {
      kind: 'denied',
      reasonClass: error.status === 404 ? 'THREAD_NOT_AVAILABLE' : (error.code || `HTTP_${error.status}`),
    };
  }

  const base = truthStateOf(
    { data, error, isLoading, dataUpdatedAt },
    (view) => view.messages.length === 0,
  );
  if (isFetching && data !== undefined && (base.kind === 'verified' || base.kind === 'proven-empty')) {
    return {
      kind: 'stale',
      verifiedAt: new Date(dataUpdatedAt > 0 ? dataUpdatedAt : 0),
      message: 'This conversation is being checked again.',
    };
  }
  return withModuleChannelTruth(base, channel);
}

export interface ConversationRelayProps {
  readonly threadId: string;
  /** Unique within the current document; drafts and labelled controls must not
   * collide with Mission Current or another rendered Thread. Standalone keeps
   * the legacy DOM ids by omitting this value. */
  readonly instanceId?: string;
  readonly live: CommsLiveResource;
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly activationKey?: string | number;
  readonly showCrossThreadArrivals?: boolean;
  readonly hrefForThread?: (threadId: string) => string;
  readonly onOpenHref?: (href: string) => void;
  readonly backHref?: string;
  /** Workspace Comms owns one license posture across every open window. The
   * standalone host omits these and keeps the same fail-closed state locally. */
  readonly moduleReadOnly?: boolean;
  readonly onModuleReadOnly?: () => void;
  readonly onTruthChange?: (truth: WitnessState) => void;
  readonly onMetaChange?: (meta: ConversationRelayMeta) => void;
}

export function ConversationRelay({
  threadId,
  instanceId,
  live,
  enabled = true,
  foreground = true,
  activationKey,
  showCrossThreadArrivals = false,
  hrefForThread = (nextThreadId) => `/comms/threads/${nextThreadId}`,
  onOpenHref,
  backHref = '/comms',
  moduleReadOnly,
  onModuleReadOnly,
  onTruthChange,
  onMetaChange,
}: ConversationRelayProps) {
  const { me } = useSession();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localLapsed, setLocalLapsed] = useState(false);
  const [postingRevoked, setPostingRevoked] = useState(false);
  const [seatRevoked, setSeatRevoked] = useState(false);
  const [locallyUnavailable, setLocallyUnavailable] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const room = useThreadRoom(threadId, enabled);
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = room;
  const rewitnessing = useForegroundRewitness({ foreground, enabled, refetch, requestKey: activationKey });
  const readUnavailable =
    error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404);
  const unavailable = readUnavailable || locallyUnavailable;
  const truth = useMemo(() => {
    if (locallyUnavailable) return { kind: 'denied', reasonClass: 'THREAD_NOT_AVAILABLE' } as const;
    return conversationRelayTruthOf({
        data,
        error,
        isLoading,
        isFetching: isFetching || rewitnessing,
        dataUpdatedAt,
        channel: live.state,
      });
  }, [data, error, isLoading, isFetching, rewitnessing, dataUpdatedAt, live.state, locallyUnavailable]);
  const messages = useMemo(() => [...(data?.messages ?? [])].sort((a, b) => a.seq - b.seq), [data]);
  const kindLabel: ConversationRelayMeta['kindLabel'] = unavailable
    ? 'Conversation'
    : data?.thread.kind === 'direct'
      ? 'Direct thread'
      : data
        ? 'Room'
        : 'Conversation';
  const record = unavailable ? 'Conversation Relay' : (data?.thread.title ?? kindLabel);
  const meta = useMemo<ConversationRelayMeta>(
    () => ({ record, kindLabel, unavailable }),
    [record, kindLabel, unavailable],
  );

  useLayoutEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);
  useLayoutEffect(() => {
    onMetaChange?.(meta);
  }, [meta, onMetaChange]);
  const lapsed = Boolean(moduleReadOnly) || localLapsed;
  const conversationActionsAvailable = foreground && isActionableWitness(truth) && !lapsed && !postingRevoked;
  const seatActionsAvailable = conversationActionsAvailable && !seatRevoked;
  const iAmAdmin = data?.participants.some((participant) => participant.userId === me?.userId && participant.role === 'admin') ?? false;
  const directory = useCommsDirectory(enabled && iAmAdmin && seatActionsAvailable);
  const refetchDirectory = directory.refetch;
  const directoryCurrent =
    directory.data !== undefined && directory.error == null && !directory.isFetching;
  const prefs = useCommsPrefs(enabled && !unavailable);
  const invalidate = useCallback(
    () => refetch().then(() => undefined),
    [refetch],
  );
  const markModuleReadOnly = useCallback(() => {
    setLocalLapsed(true);
    onModuleReadOnly?.();
    setActionError('The Comms license has lapsed — retained conversation history is read-only.');
  }, [onModuleReadOnly]);
  const refusePost = useCallback(
    (writeError: unknown) => {
      const refusal = conversationWriteRefusalOf(writeError, 'post');
      if (refusal === 'module-read-only') {
        markModuleReadOnly();
      } else if (refusal === 'conversation-write-revoked' || refusal === 'room-unavailable') {
        if (refusal === 'room-unavailable') setLocallyUnavailable(true);
        else setPostingRevoked(true);
        setActionError('This conversation is no longer writable. Its standing is being checked again.');
        void invalidate().catch(() => undefined);
      } else {
        setActionError(writeError instanceof Error ? writeError.message : 'The message did not send.');
      }
    },
    [invalidate, markModuleReadOnly],
  );
  const refuseSeat = useCallback(
    (writeError: unknown) => {
      const refusal = conversationWriteRefusalOf(writeError, 'seat');
      if (refusal === 'module-read-only') {
        markModuleReadOnly();
      } else if (refusal === 'seat-administration-revoked') {
        // A concealed 404 can name either the room/seat OR an invitee who just
        // became unaddressable. Revoke only room administration here; the
        // authoritative room re-read below decides whether the room vanished.
        setSeatRevoked(true);
        setActionError('The seating change was refused. The room and member directory are being checked again.');
        void invalidate().catch(() => undefined);
        void refetchDirectory().catch(() => undefined);
      } else {
        setActionError(writeError instanceof Error ? writeError.message : 'The change did not apply.');
      }
    },
    [invalidate, markModuleReadOnly, refetchDirectory],
  );

  const post = useCallback(
    async (body: string, links: CommsLinkInput[]): Promise<boolean> => {
      if (!conversationActionsAvailable) return false;
      setBusy(true);
      setActionError(null);
      try {
        await api.postThreadMessage(threadId, { body, links, clientMutationId: crypto.randomUUID() });
        await invalidate();
        return true;
      } catch (writeError) {
        refusePost(writeError);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [conversationActionsAvailable, threadId, invalidate, refusePost],
  );

  const postKinded = useCallback(
    async (
      body: string,
      links: CommsLinkInput[],
      kind: 'note' | 'decision',
      supersedes: string | null,
    ): Promise<boolean> => {
      if (!conversationActionsAvailable) return false;
      setBusy(true);
      setActionError(null);
      try {
        await api.postThreadMessage(threadId, {
          body,
          links,
          clientMutationId: crypto.randomUUID(),
          messageKind: kind,
          supersedesMessageId: supersedes,
        });
        await invalidate();
        return true;
      } catch (writeError) {
        refusePost(writeError);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [conversationActionsAvailable, threadId, invalidate, refusePost],
  );

  const seatAction = useCallback(
    (work: () => Promise<unknown>) => {
      if (!seatActionsAvailable) return;
      setActionError(null);
      work()
        .then(() => invalidate())
        .catch(refuseSeat);
    },
    [seatActionsAvailable, invalidate, refuseSeat],
  );

  const prefsCurrent = prefs.data !== undefined && prefs.error == null && !prefs.isFetching;
  const soundOn = prefsCurrent
    ? data?.thread.kind === 'direct'
      ? prefs.data.soundDirectEnabled
      : prefs.data.soundThreadEnabled
    : false;
  const arrivalKeys = useMemo(
    () => live.arrivals.filter((arrival) => arrival.threadId === threadId).map((arrival) => arrival.key),
    [live.arrivals, threadId],
  );
  const observedArrivals = useRef<{
    readonly threadId: string;
    readonly keys: Set<string>;
    readonly order: string[];
  } | null>(null);
  useEffect(() => {
    if (observedArrivals.current === null || observedArrivals.current.threadId !== threadId) {
      observedArrivals.current = { threadId, keys: new Set(arrivalKeys), order: [...arrivalKeys] };
      return;
    }
    const unseen = arrivalKeys.filter((key) => !observedArrivals.current!.keys.has(key));
    for (const key of unseen) {
      observedArrivals.current.keys.add(key);
      observedArrivals.current.order.push(key);
    }
    while (observedArrivals.current.order.length > 32) {
      const oldest = observedArrivals.current.order.shift();
      if (oldest) observedArrivals.current.keys.delete(oldest);
    }
    if (unseen.length === 0 || !soundOn) return;
    void playArrivalSound().then((played) => setSoundBlocked(!played));
  }, [arrivalKeys, soundOn, threadId]);

  const audienceText =
    data?.thread.kind === 'direct'
      ? 'Between the seated members only — never visible to anyone else, owners included.'
      : `Readable by the seated members only: ${(data?.participants ?? [])
          .map((participant) => participant.displayName ?? 'Member')
          .join(', ')}.`;

  if (unavailable) {
    const missingHeadingId = instanceId ? `${instanceId}-missing-heading` : 'room-missing-heading';
    return (
      <WorkSurface tier="base" className="comms-surface conversation-relay-missing" aria-labelledby={missingHeadingId}>
        <header className="surface-heading">
          <div>
            <h2 id={missingHeadingId}>This thread is not available</h2>
            <p>The thread does not exist or is outside your access. A private room you are not seated at is absent without count or confirmation.</p>
          </div>
        </header>
        <p className="boundary-note"><Link to={backHref}>Back to my attention</Link></p>
      </WorkSurface>
    );
  }

  return (
    <section className="conversation-relay" data-tablework="ConversationRelay" data-truth={truth.kind}>
      {actionError ? <div className="lapsed-banner" role={lapsed ? 'status' : 'alert'}>{actionError}</div> : null}
      {soundBlocked ? (
        <p className="cell-note" data-testid="sound-blocked">
          Sound is on for this thread, but this browser has not allowed audio yet — one interaction enables it.
        </p>
      ) : null}
      {prefs.error ? (
        <p className="cell-note" data-testid="sound-unverified">
          Notification preferences could not be verified — sound is off.
        </p>
      ) : null}
      {showCrossThreadArrivals ? (
        <ToastStack
          items={live.arrivals
            .filter((arrival) => arrival.threadId !== threadId)
            .map((arrival) => ({
              id: arrival.key,
              title: arrival.recalled ? 'A message was recalled' : `New message from ${arrival.authorLabel ?? 'a member'}`,
              detail: arrival.recalled ? null : (arrival.preview ?? null),
              href: hrefForThread(arrival.threadId),
            }))}
          onDismiss={live.dismiss}
          onOpen={onOpenHref ? (item) => {
            live.dismiss(item.id);
            if (item.href) onOpenHref(item.href);
          } : undefined}
        />
      ) : null}
      <div className="conversation-relay-layout">
        <WorkSurface as="aside" tablework="SectionRail" className="comms-surface conversation-relay-facts" aria-label="Conversation facts">
          <header className="surface-heading">
            <div>
              <h2>{kindLabel}</h2>
              <p>{me?.tenantSlug}</p>
            </div>
          </header>
          {truth.kind === 'stale' ? (
            <p className="boundary-note" data-testid="conversation-facts-stale">
              These are retained conversation facts. Actions wait until the room and its live channel are witnessed again.
            </p>
          ) : null}
          {data?.retentionDays != null ? (
            <p className="boundary-note" data-tablework="RetentionNotice" data-testid="retention-notice">
              <strong>Retention: {data.retentionDays} days.</strong> A direct thread is a conversation, not an archive. Work that must outlive it belongs on an anchor.
            </p>
          ) : null}
          {data?.thread.kind === 'standing' ? (
            <p className="boundary-note">Invite-only. Obligations minted here remain accountable at this table and never enter organization signal surfaces.</p>
          ) : null}
          {data && data.participants.length > 0 ? (
            <>
              <h3 className="cell-note strong">Seated</h3>
              <div className="thread-list" data-testid="room-seats">
                {data.participants.map((participant) => (
                  <span className="thread-item" key={participant.userId}>
                    <strong>{participant.displayName ?? 'Member'}</strong>
                    <small>
                      {participant.role}
                      {seatActionsAvailable && iAmAdmin && data.thread.kind === 'standing' && participant.userId !== me?.userId ? (
                        <>
                          {' · '}
                          <button
                            className="quiet-action"
                            type="button"
                            data-governed-control
                            aria-label={`Remove ${participant.displayName ?? 'member'} from ${record}`}
                            onClick={() => seatAction(() => api.removeFromCommsRoom(threadId, participant.userId))}
                          >
                            remove
                          </button>
                        </>
                      ) : null}
                    </small>
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {seatActionsAvailable && iAmAdmin && data?.thread.kind === 'standing' && directoryCurrent ? (
            <div className="panel-actions" data-testid="room-invite">
              <select
                aria-label="Invite a member to this room"
                data-governed-control
                defaultValue=""
                onChange={(event) => {
                  const userId = event.target.value;
                  event.target.value = '';
                  if (userId) seatAction(() => api.inviteToCommsRoom(threadId, userId));
                }}
              >
                <option value="" disabled>Invite to the room…</option>
                {directory.data.people
                  .filter((person) => !data.participants.some((seat) => seat.userId === person.userId))
                  .map((person) => <option key={person.userId} value={person.userId}>{person.displayName} · {person.roleClass}</option>)}
              </select>
            </div>
          ) : null}
          {seatActionsAvailable && iAmAdmin && data?.thread.kind === 'standing' && directory.isFetching ? (
            <p className="cell-note" data-testid="room-directory-checking">Checking who can be invited…</p>
          ) : null}
          {seatActionsAvailable && iAmAdmin && data?.thread.kind === 'standing' && directory.error ? (
            <p className="boundary-note" data-testid="room-directory-unavailable">
              The member directory could not be verified — inviting is unavailable.
            </p>
          ) : null}
          {data && data.events.length > 0 ? (
            <>
              <h3 className="cell-note strong">Conversation log</h3>
              <div className="thread-list" data-tablework="RoomLog" data-testid="room-log">
                {data.events.map((event, index) => (
                  <span className="thread-item" key={`${event.eventType}:${event.at}:${index}`}>
                    <strong>{event.eventType}</strong>
                    <small>{event.actorLabel ?? 'Member'} · {new Date(event.at).toLocaleString()}</small>
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </WorkSurface>
        <Thread
          instanceId={instanceId}
          contextLabel="Conversation"
          standingLabel={data !== undefined && isActionableWitness(truth) ? 'Seated' : 'Standing unverified'}
          composerNoun="conversation"
          composerPlaceholder="Write in this conversation"
          missionName={record}
          threadTitle={record}
          participantsLine={
            data?.thread.kind === 'direct'
              ? 'A conversation, not an archive'
              : data
                ? 'The table keeps its own log'
                : 'Conversation standing is being verified'
          }
          messages={messages}
          myLastReadSeq={data?.myLastReadSeq ?? null}
          lapsed={lapsed || postingRevoked}
          seenLine={null}
          posting={busy}
          onPost={post}
          onPostKinded={postKinded}
          onAttach={async () => {
            setActionError('Attachments live on anchored threads — rooms and DMs carry words; work carries evidence.');
          }}
          truth={truth}
          audienceTreaty={{ text: audienceText, verified: data !== undefined && conversationActionsAvailable }}
        />
      </div>
    </section>
  );
}
