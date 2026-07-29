/**
 * AttentionLedgerPage — Phase B: the Comms front door (`/comms`).
 *
 * One honest answer to "what awaits my act, everywhere": my obligations
 * grouped by MY station, and threads with TRUE unread (lastSeq − my cursor,
 * re-derived per read — instance 8's law). Born under the six-state contract:
 * both regions derive through truthStateOf; failure and emptiness are
 * different artifacts.
 *
 * Guardrail Zero BY CONSTRUCTION: every row's predicate is `me` at the SQL
 * layer; no org-wide variant of this page exists anywhere in the system.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CommsLedgerResponse } from '@c3web/api-contracts';
import { useSession } from '../session';
import { useCommsLedger } from '../queries';
import { api } from '../apiClient';
import { IS_ENTRA } from '../auth';
import { EntraSignIn, AccessNotProvisioned } from './EntraSignIn';
import { LoginGate } from './LoginGate';
import { AppFrame, ContextHeader, TruthPanel, truthStateOf, WorkSurface } from '../tablework';

export function AttentionLedgerPage() {
  const { status, providerSession, signOut } = useSession();
  if (status === 'loading') {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>Loading session...</div>;
  }
  if (status === 'anonymous') {
    return IS_ENTRA ? <EntraSignIn intendedPath="/comms" /> : <LoginGate intendedPath="/comms" />;
  }
  if (status === 'unprovisioned') {
    return <AccessNotProvisioned identity={providerSession?.identity ?? 'This account'} onSignOut={() => void signOut()} />;
  }
  return <LedgerScreen />;
}

type LedgerRow = CommsLedgerResponse['awaitingMyAcceptance'][number];

function threadHref(threadKind: string, anchorType: string | null, anchorId: string | null, threadId: string): string {
  if (threadKind === 'anchored' && anchorType === 'Mission' && anchorId) return `/missions/${anchorId}/comms`;
  return `/comms/threads/${threadId}`;
}

function Station({ title, hint, rows }: { title: string; hint: string; rows: LedgerRow[] }) {
  if (rows.length === 0) return null; // section-level absence; the page-level truth is stamped once
  return (
    <WorkSurface className="comms-surface" aria-label={title}>
      <header className="surface-heading">
        <div>
          <h2>{title}</h2>
          <p>{hint}</p>
        </div>
        <span className="state-label info">{rows.length}</span>
      </header>
      <div className="obligation-stack">
        {rows.map((r) => (
          <article className="group-box" data-testid={`ledger-${r.obligation.obligationId}`} key={r.obligation.obligationId}>
            <header>
              <strong>{r.obligation.description}</strong>
              <small>
                {r.obligation.obligationId} · due {new Date(r.obligation.dueAt).toLocaleString()} · {r.obligation.state}
              </small>
            </header>
            <p className="cell-note">
              {r.threadKind === 'anchored'
                ? `Anchored: ${r.anchorType} ${r.anchorId}`
                : r.threadKind === 'direct'
                  ? 'From a direct thread (never surfaces in org signals)'
                  : `From the room “${r.threadTitle ?? 'private room'}”`}
            </p>
            <div className="message-actions">
              <Link className="mini-action" to={threadHref(r.threadKind, r.anchorType, r.anchorId, r.obligation.threadId)}>
                Open where it lives
              </Link>
            </div>
          </article>
        ))}
      </div>
    </WorkSurface>
  );
}

function LedgerScreen() {
  const { me } = useSession();
  const navigate = useNavigate();
  const ledger = useCommsLedger();
  const canManage = me?.capabilities.canManageMissions ?? false;
  const [creating, setCreating] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const truth = truthStateOf(
    { data: ledger.data, error: ledger.error, isLoading: ledger.isLoading, dataUpdatedAt: ledger.dataUpdatedAt },
    (d) =>
      d.awaitingMyAcceptance.length === 0 &&
      d.awaitingMyDelivery.length === 0 &&
      d.awaitingMySettle.length === 0 &&
      d.watching.length === 0 &&
      d.threads.length === 0,
  );
  const data = ledger.data;

  const createRoom = () => {
    const title = window.prompt('Name the room (invite-only; the seat list is its audience):');
    if (!title || !title.trim()) return;
    setCreating(true);
    setRoomError(null);
    api
      .createCommsRoom(title.trim())
      .then((res) => navigate(`/comms/threads/${res.thread.threadId}`))
      .catch((err) => setRoomError(err instanceof Error ? err.message : 'The room was not created.'))
      .finally(() => setCreating(false));
  };

  return (
    <AppFrame
      place="Comms"
      actor={{ displayName: me?.displayName ?? 'Member', role: me?.role ?? '', tenantName: me?.tenantSlug ?? '' }}
      header={
        <ContextHeader
          place="Comms"
          origin="You"
          record="The Attention Ledger"
          section="What awaits your act"
          actions={
            canManage ? (
              <button className="intent-button" type="button" disabled={creating} onClick={createRoom} data-testid="create-room">
                Open a room
              </button>
            ) : undefined
          }
        />
      }
    >
      <p className="boundary-note" style={{ maxWidth: '60ch' }}>
        Everything here awaits YOUR act, with its provenance. Counts are re-derived at every read. There is no
        org-wide version of this page — an attention ledger belongs to the person, never to a cockpit.
      </p>
      {roomError ? (
        <div className="lapsed-banner" role="alert">
          {roomError}
        </div>
      ) : null}
      <TruthPanel state={truth} emptyLabel="You are caught up — nothing awaits your act.">
        {data ? (
          <div className="comms-layout" style={{ alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 'var(--space-4, 1rem)' }}>
              <Station title="Awaiting my acceptance" hint="Delivered to you — accept or reject is your move" rows={data.awaitingMyAcceptance} />
              <Station title="Awaiting my delivery" hint="You are the accountable owner" rows={data.awaitingMyDelivery} />
              <Station title="Awaiting my settle" hint="Done is claimed; only your judgment closes it" rows={data.awaitingMySettle} />
              <Station title="Watching" hint="You asked; others act" rows={data.watching} />
            </div>
            {data.threads.length > 0 ? (
              <WorkSurface className="comms-surface" aria-label="Unread conversations">
                <header className="surface-heading">
                  <div>
                    <h2>Unread conversations</h2>
                    <p>lastSeq − your cursor, derived at this read</p>
                  </div>
                </header>
                <div className="thread-list">
                  {data.threads.map((t) => (
                    <Link
                      key={t.thread.threadId}
                      className="thread-item"
                      data-testid={`ledger-thread-${t.thread.threadId}`}
                      to={threadHref(t.thread.kind, t.thread.anchorType, t.thread.anchorId, t.thread.threadId)}
                    >
                      <strong>
                        {t.thread.kind === 'anchored'
                          ? `${t.thread.anchorType} ${t.thread.anchorId}`
                          : (t.thread.title ?? (t.thread.kind === 'direct' ? 'Direct thread' : 'Room'))}
                      </strong>
                      <small>
                        {t.unread} unread · {t.thread.kind}
                      </small>
                    </Link>
                  ))}
                </div>
              </WorkSurface>
            ) : null}
          </div>
        ) : null}
      </TruthPanel>
    </AppFrame>
  );
}
