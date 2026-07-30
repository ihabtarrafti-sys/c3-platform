/**
 * ThreadRoomPage — Phase B: rooms and DMs (`/comms/threads/:threadId`).
 *
 * The generalized room through the SAME per-kind gate the server enforces. A
 * non-member receives the room's own 404 — rendered as the SAME truthful
 * absence as a missing record (private ≠ invisible done right: nothing to
 * confirm, nothing to count). direct threads state their retention posture
 * where the conversation happens; standing rooms render the seat list and the
 * ROOM LOG (0090's event vocabulary — the room's own history).
 *
 * The AUDIENCE TREATY: the composer's audience line derives from the SAME
 * room read that produced the messages — if the audience is unverifiable,
 * Send is disabled rather than guessing.
 *
 * B8: the DM-opening affordance the first cut withheld now lives on the ledger
 * (the front door), and the room's invite picker draws on the comms ADDRESS
 * BOOK — owner-ruled "all can talk to all". Addressability only: nothing here
 * widened what anyone can SEE.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CommsLinkInput } from '@c3web/domain';
import { useSession } from '../session';
import { useCommsDirectory, useThreadRoom } from '../queries';
import { api } from '../apiClient';
import { ApiError } from '../api';
import { IS_ENTRA } from '../auth';
import { EntraSignIn, AccessNotProvisioned } from './EntraSignIn';
import { LoginGate } from './LoginGate';
import { AppFrame, ContextHeader, Thread, ToastStack, truthStateOf, WorkSurface } from '../tablework';
import { useCommsLive, playArrivalSound } from '../useCommsLive';
import { useCommsPrefs } from '../queries';

export function ThreadRoomPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const { status, providerSession, signOut } = useSession();
  if (status === 'loading') {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>Loading session...</div>;
  }
  if (status === 'anonymous') {
    const intended = `/comms/threads/${threadId}`;
    return IS_ENTRA ? <EntraSignIn intendedPath={intended} /> : <LoginGate intendedPath={intended} />;
  }
  if (status === 'unprovisioned') {
    return <AccessNotProvisioned identity={providerSession?.identity ?? 'This account'} onSignOut={() => void signOut()} />;
  }
  return <RoomScreen threadId={threadId ?? ''} />;
}

function RoomScreen({ threadId }: { threadId: string }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const room = useThreadRoom(threadId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const notFound = room.error instanceof ApiError && room.error.status === 404;
  const data = room.data;
  const messages = useMemo(() => [...(data?.messages ?? [])].sort((a, b) => a.seq - b.seq), [data]);
  // Phase B-LIVE: the connection's health is part of this region's witness.
  const live = useCommsLive(!notFound);
  const prefs = useCommsPrefs(!notFound);
  const baseTruth = truthStateOf(
    { data: room.data, error: notFound ? null : room.error, isLoading: room.isLoading, dataUpdatedAt: room.dataUpdatedAt },
    (d) => d.messages.length === 0,
  );
  // A dropped stream with rows on screen is STALE, not verified: the content
  // may already be behind, and saying so is the whole contract.
  const truth =
    !live.state.healthy && baseTruth.kind === 'verified' && room.dataUpdatedAt
      ? ({ kind: 'stale', verifiedAt: new Date(room.dataUpdatedAt), message: 'The live channel is not confirmed.' } as const)
      : baseTruth;

  const iAmAdmin = data?.participants.some((p) => p.userId === me?.userId && p.role === 'admin') ?? false;
  // B8: the invite picker now draws on the COMMS ADDRESS BOOK (owner-ruled),
  // not the owner/ops members register. This also CORRECTS a render-gate that
  // was narrower than its API: the room's authority is the ADMIN SEAT, and the
  // backend never required canManageMissions to invite — an affordance hidden
  // from someone who actually holds the authority is its own small lie.
  const directory = useCommsDirectory(iAmAdmin);

  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['commsRoom', threadId] }), [qc, threadId]);

  const post = useCallback(
    async (body: string, links: CommsLinkInput[]): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      try {
        await api.postThreadMessage(threadId, { body, links, clientMutationId: crypto.randomUUID() });
        await invalidate();
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'The message did not send.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [threadId, invalidate],
  );

  const seatAction = useCallback(
    (work: () => Promise<unknown>) => {
      setActionError(null);
      work()
        .then(() => invalidate())
        .catch((err) => setActionError(err instanceof Error ? err.message : 'The change did not apply.'));
    },
    [invalidate],
  );

  // Sound follows the ruled default: ON for what is aimed AT you (a direct
  // thread), OFF for broad traffic — and a blocked play is reported, never
  // swallowed (a pref that claims to be on while nothing sounds is a lie).
  const soundOn = data?.thread.kind === 'direct' ? (prefs.data?.soundDirectEnabled ?? true) : (prefs.data?.soundThreadEnabled ?? false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const arrivalsForThisThread = live.arrivals.filter((a) => a.threadId === threadId);
  useEffect(() => {
    if (!soundOn || arrivalsForThisThread.length === 0) return;
    void playArrivalSound().then((played) => setSoundBlocked(!played));
  }, [soundOn, arrivalsForThisThread.length]);

  const kindLabel = data?.thread.kind === 'direct' ? 'Direct thread' : 'Room';
  const record = notFound ? threadId : (data?.thread.title ?? kindLabel);
  const audienceText =
    data?.thread.kind === 'direct'
      ? 'Between the seated members only — never visible to anyone else, owners included.'
      : `Readable by the seated members only: ${(data?.participants ?? []).map((p) => p.displayName ?? 'Member').join(', ')}.`;

  return (
    <AppFrame
      place="Comms"
      actor={{ displayName: me?.displayName ?? 'Member', role: me?.role ?? '', tenantName: me?.tenantSlug ?? '' }}
      header={
        <ContextHeader
          place="Comms"
          origin="Comms"
          record={record}
          section={kindLabel}
          actions={
            <Link className="intent-button" to="/comms">
              The Attention Ledger
            </Link>
          }
        />
      }
    >
      {notFound ? (
        <WorkSurface tier="base" className="comms-surface" aria-labelledby="room-missing-heading">
          <header className="surface-heading">
            <div>
              <h2 id="room-missing-heading">This thread is not available</h2>
              <p>
                The thread does not exist or is outside your access. A private room you are not seated at is ABSENT —
                without count, without confirmation.
              </p>
            </div>
          </header>
          <p className="boundary-note">
            <Link to="/comms">Back to the ledger</Link>
          </p>
        </WorkSurface>
      ) : (
        <>
          {actionError ? (
            <div className="lapsed-banner" role="alert">
              {actionError}
            </div>
          ) : null}
          {soundBlocked ? (
            <p className="cell-note" data-testid="sound-blocked">
              Sound is on for this thread, but this browser has not allowed audio yet — one interaction enables it.
            </p>
          ) : null}
          <ToastStack
            items={live.arrivals
              .filter((a) => a.threadId !== threadId)
              .map((a) => ({
                id: a.key,
                title: a.recalled ? 'A message was recalled' : `New message from ${a.authorLabel ?? 'a member'}`,
                detail: a.recalled ? null : (a.preview ?? null),
                href: `/comms/threads/${a.threadId}`,
              }))}
            onDismiss={live.dismiss}
          />
          <div className="comms-layout">
            <WorkSurface as="nav" tablework="SectionRail" className="comms-surface" aria-label="Room facts">
              <header className="surface-heading">
                <div>
                  <h2>{kindLabel}</h2>
                  <p>{me?.tenantSlug}</p>
                </div>
              </header>
              {data?.retentionDays != null ? (
                <p className="boundary-note" data-tablework="RetentionNotice" data-testid="retention-notice">
                  <strong>Retention: {data.retentionDays} days.</strong> A direct thread is a conversation, not an
                  archive — messages here carry a retention date from the moment they are sent. Work that must outlive
                  the conversation belongs on an anchor.
                </p>
              ) : null}
              {data && data.thread.kind === 'standing' ? (
                <p className="boundary-note">
                  Invite-only. Obligations minted here never reach org signal surfaces — what happens at this table
                  stays accountable AT this table.
                </p>
              ) : null}
              {data && data.participants.length > 0 ? (
                <>
                  <h3 className="cell-note strong">Seated</h3>
                  <div className="thread-list" data-testid="room-seats">
                    {data.participants.map((p) => (
                      <span className="thread-item" key={p.userId}>
                        <strong>{p.displayName ?? 'Member'}</strong>
                        <small>
                          {p.role}
                          {iAmAdmin && data.thread.kind === 'standing' && p.userId !== me?.userId ? (
                            <>
                              {' · '}
                              <button className="quiet-action" type="button" onClick={() => seatAction(() => api.removeFromCommsRoom(threadId, p.userId))}>
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
              {iAmAdmin && data?.thread.kind === 'standing' && directory.data ? (
                <div className="panel-actions" data-testid="room-invite" style={{ justifyContent: 'flex-start' }}>
                  <select
                    aria-label="Invite a member to this room"
                    defaultValue=""
                    onChange={(e) => {
                      const userId = e.target.value;
                      e.target.value = '';
                      if (userId) seatAction(() => api.inviteToCommsRoom(threadId, userId));
                    }}
                  >
                    <option value="" disabled>
                      Invite to the room…
                    </option>
                    {directory.data.people
                      .filter((p) => !data.participants.some((seat) => seat.userId === p.userId))
                      .map((p) => (
                        <option key={p.userId} value={p.userId}>
                          {p.displayName} · {p.roleClass}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}
              {data && data.events.length > 0 ? (
                <>
                  <h3 className="cell-note strong">Room log</h3>
                  <div className="thread-list" data-tablework="RoomLog" data-testid="room-log">
                    {data.events.map((e, i) => (
                      <span className="thread-item" key={i}>
                        <strong>{e.eventType}</strong>
                        <small>
                          {e.actorLabel ?? 'Member'} · {new Date(e.at).toLocaleString()}
                        </small>
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </WorkSurface>
            <Thread
              missionName={record}
              threadTitle={record}
              participantsLine={data?.thread.kind === 'direct' ? 'A conversation, not an archive' : 'The table keeps its own log'}
              messages={messages}
              myLastReadSeq={data?.myLastReadSeq ?? null}
              lapsed={false}
              seenLine={null}
              posting={busy}
              onPost={post}
              onAttach={async () => {
                setActionError('Attachments live on anchored threads — rooms and DMs carry words; work carries evidence.');
              }}
              truth={truth}
              audienceTreaty={{ text: audienceText, verified: data !== undefined }}
            />
          </div>
        </>
      )}
    </AppFrame>
  );
}
