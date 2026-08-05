/**
 * ThreadRoomPage — the standalone host for the shared Conversation Relay.
 * Workspace OS mounts the same controller with its already-open live channel;
 * this page owns one only when no mission workspace was explicitly requested.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IS_ENTRA } from '../auth';
import { useSession } from '../session';
import { useCommsLive } from '../useCommsLive';
import { AppFrame, ContextHeader } from '../tablework';
import {
  ConversationRelay,
  type ConversationRelayMeta,
} from '../tablework/ConversationRelay';
import { EntraSignIn, AccessNotProvisioned } from './EntraSignIn';
import { LoginGate } from './LoginGate';

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
  return <StandaloneConversation key={threadId} threadId={threadId ?? ''} />;
}

function StandaloneConversation({ threadId }: { readonly threadId: string }) {
  const { me } = useSession();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<ConversationRelayMeta>({
    record: threadId,
    kindLabel: 'Conversation',
    unavailable: false,
  });
  const live = useCommsLive(!meta.unavailable);

  return (
    <AppFrame
      place="Comms"
      actor={{ displayName: me?.displayName ?? 'Member', role: me?.role ?? '', tenantName: me?.tenantSlug ?? '' }}
      header={
        <ContextHeader
          place="Comms"
          origin="Comms"
          record={meta.record}
          section={meta.kindLabel}
          actions={<Link className="intent-button" to="/comms">The Attention Ledger</Link>}
        />
      }
    >
      <ConversationRelay
        threadId={threadId}
        live={live}
        showCrossThreadArrivals
        onOpenHref={(href) => navigate(href)}
        onMetaChange={setMeta}
      />
    </AppFrame>
  );
}
