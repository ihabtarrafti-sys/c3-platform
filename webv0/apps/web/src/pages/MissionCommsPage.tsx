/**
 * MissionCommsPage.tsx — the Tablework pilot route (Comms UI-2: the screen).
 *
 * /missions/:missionId/comms mounts the FULL Tablework frame OUTSIDE the
 * Fluent AppShell — the two grammars never share a route. The session is the
 * SAME app session (SessionProvider wraps the router in main.tsx).
 *
 * Governance UX (the verdict, wired):
 *  - D1: the composer carries "visible to everyone who can see this mission".
 *  - D2: "Create obligation" renders ONLY for canManageMissions; the members
 *    directory populates the mint form (its API is owner/ops-gated — the same
 *    population D2 admits).
 *  - Chips navigate, never execute; the obligation card = three INDEPENDENT
 *    truths; Accept/Reject renders only for the named authority (me.userId).
 *  - Lapse is REACTIVE truth: a write refused with MODULE_READ_ONLY flips the
 *    surface to the lapsed posture (banner + composer/actions removed); reads,
 *    receipts, and own-prefs stay live. Never-entitled = 404 = the same
 *    not-available surface as a missing mission.
 *  - Capabilities render-gate AFFORDANCES only — the API is the authority.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CommsMessageDto, CommsObligationDto, MissionDto } from '@c3web/api-contracts';
import type { CommsLinkInput } from '@c3web/domain';
import { useSession } from '../session';
import { useCommsPrefs, useMembers, useMission, useMissionObligations, useMissionReceipts, useMissionThread } from '../queries';
import { api } from '../apiClient';
import { ApiError, type CommsObligationCreateBody } from '../api';
import { IS_ENTRA } from '../auth';
import { EntraSignIn, AccessNotProvisioned } from './EntraSignIn';
import { LoginGate } from './LoginGate';
import { AppFrame, ContextHeader, FloatSurface, ObligationCard, Thread, ToastStack, TruthPanel, truthStateOf, WorkSurface, type ObligationActionInput, type WitnessState } from '../tablework';
import { MissionCommandWorkspace, type MissionCommandModule } from '../tablework/MissionCommandWorkspace';
import { isActionableWitness, withModuleChannelTruth, type MissionCommandModuleId } from '../tablework/missionCommandModel';
import { CommandConstellation } from '../tablework/CommandConstellation';
import { CommandAttention, type CommandAttentionTarget } from '../tablework/CommandAttention';
import { MissionContinuity, joinMissionContinuityWitness } from '../tablework/MissionContinuity';
import { ConversationRelay, type ConversationRelayMeta } from '../tablework/ConversationRelay';
import { PeopleField } from '../tablework/PeopleField';
import { PersonRecord, type PersonRecordMeta } from '../tablework/PersonRecord';
import { SeatsStanding } from '../tablework/SeatsStanding';
import { OrganizationContinuity } from '../tablework/OrganizationContinuity';
import { documentHasOpenDialog, mayRecordWorkspaceRead, useDocumentAttention } from '../tablework/workspaceAttention';
import { useCommsLive } from '../useCommsLive';
import { MissionFinanceOverview } from './MissionFinancePage';
import { ApprovalsRegister } from './ApprovalsPage';
import { CalendarHorizon } from './CalendarPage';

const WORKSPACE_ROUTE_META: Readonly<
  Record<MissionCommandModuleId, { readonly place: string; readonly origin: string; readonly section: string }>
> = {
  'mission-field': { place: 'Comms', origin: 'Mission', section: 'Mission Field' },
  'mission-current': { place: 'Comms', origin: 'Mission', section: 'Mission Thread' },
  'mission-obligations': { place: 'Comms', origin: 'Mission', section: 'Mission Obligations' },
  'mission-finance': { place: 'Finance', origin: 'Mission Command', section: 'Finance beside Mission' },
  'approvals-register': { place: 'Approvals', origin: 'Mission Command', section: 'Decisions beside Mission' },
  'calendar-horizon': { place: 'Calendar', origin: 'Mission Command', section: 'Planning beside Mission' },
  'command-constellation': { place: 'Command', origin: 'Mission Command', section: 'Organization Constellation' },
  'command-attention': { place: 'Comms', origin: 'Mission Command', section: 'My Attention' },
  'mission-continuity': { place: 'Comms', origin: 'Mission Command', section: 'Mission Continuity' },
  'conversation-relay': { place: 'Comms', origin: 'Mission Command', section: 'Conversation Relay' },
  'people-field': { place: 'People', origin: 'Workspace OS', section: 'Living Field' },
  'person-record': { place: 'People', origin: 'Living Field', section: 'Person Record' },
  'seats-standing': { place: 'Organization', origin: 'Workspace OS', section: 'Seats & Standing' },
  'organization-continuity': { place: 'Organization', origin: 'Workspace OS', section: 'Organization Continuity' },
};

interface MissionCommsPageProps {
  readonly missionIdOverride?: string;
  readonly requestedModule?: MissionCommandModuleId;
  readonly conversationThreadIdOverride?: string;
  readonly personIdOverride?: string;
  readonly workspaceRequestKey?: string;
  readonly workspaceActive?: boolean;
  readonly activateRequestedModule?: boolean;
}

export function MissionCommsPage({ missionIdOverride, requestedModule = 'mission-current', conversationThreadIdOverride, personIdOverride, workspaceRequestKey = 'direct', workspaceActive = true, activateRequestedModule = true }: MissionCommsPageProps = {}) {
  const { missionId: routeMissionId } = useParams<{ missionId: string }>();
  const location = useLocation();
  const missionId = missionIdOverride ?? routeMissionId;
  const { status, providerSession, signOut } = useSession();

  // The AppShell's exact session gate, replicated for the standalone mount.
  // The screen (and its queries) mounts ONLY once authenticated — a query
  // fired pre-auth would 401 and, with the app-wide retry:false, stay stuck.
  if (status === 'loading') {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>Loading session...</div>;
  }
  if (status === 'anonymous') {
    const intended = `${location.pathname}${location.search}`;
    return IS_ENTRA ? <EntraSignIn intendedPath={intended} /> : <LoginGate intendedPath={intended} />;
  }
  if (status === 'unprovisioned') {
    return <AccessNotProvisioned identity={providerSession?.identity ?? 'This account'} onSignOut={() => void signOut()} />;
  }

  return (
    <MissionCommsScreen key={missionId}
      missionId={missionId ?? ''}
      requestedModule={requestedModule}
      conversationThreadIdOverride={conversationThreadIdOverride}
      personIdOverride={personIdOverride}
      workspaceRequestKey={workspaceRequestKey}
      workspaceActive={workspaceActive}
      activateRequestedModule={activateRequestedModule}
    />
  );
}

function MissionCommsScreen({
  missionId,
  requestedModule,
  conversationThreadIdOverride,
  personIdOverride,
  workspaceRequestKey,
  workspaceActive,
  activateRequestedModule,
}: {
  missionId: string;
  requestedModule: MissionCommandModuleId;
  conversationThreadIdOverride?: string;
  personIdOverride?: string;
  workspaceRequestKey: string;
  workspaceActive: boolean;
  activateRequestedModule: boolean;
}) {
  const { me } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const mission = useMission(missionId, workspaceActive);
  const thread = useMissionThread(missionId, workspaceActive);
  const obligations = useMissionObligations(missionId, workspaceActive);
  const receipts = useMissionReceipts(missionId, workspaceActive);
  const prefs = useCommsPrefs(workspaceActive);
  const live = useCommsLive(workspaceActive);
  const canManage = me?.capabilities.canManageMissions ?? false;
  // D2's mint population: the owner/ops member directory (the API gates it).
  const members = useMembers(workspaceActive && canManage);

  // Lapse is reactive truth: set when the API refuses a write as read-only.
  const [lapsed, setLapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mintOpen, setMintOpen] = useState(false);
  const [financeTruth, setFinanceTruth] = useState<WitnessState>({ kind: 'loading' });
  const [approvalsTruth, setApprovalsTruth] = useState<WitnessState>({ kind: 'loading' });
  const [calendarTruth, setCalendarTruth] = useState<WitnessState>({ kind: 'loading' });
  const [constellationTruth, setConstellationTruth] = useState<WitnessState>({ kind: 'loading' });
  const [commandAttentionTruth, setCommandAttentionTruth] = useState<WitnessState>({ kind: 'loading' });
  const [peopleTruth, setPeopleTruth] = useState<WitnessState>({ kind: 'loading' });
  const [seatsTruth, setSeatsTruth] = useState<WitnessState>({ kind: 'loading' });
  const [organizationTruth, setOrganizationTruth] = useState<WitnessState>({ kind: 'loading' });
  const [personWitness, setPersonWitness] = useState<{
    readonly personId: string | null;
    readonly truth: WitnessState;
  }>({ personId: null, truth: { kind: 'loading' } });
  const [personMeta, setPersonMeta] = useState<{
    readonly personId: string | null;
    readonly value: PersonRecordMeta | null;
  }>({ personId: null, value: null });
  const [conversationWitness, setConversationWitness] = useState<{
    readonly threadId: string | null;
    readonly truth: WitnessState;
  }>({ threadId: null, truth: { kind: 'loading' } });
  const [conversationMeta, setConversationMeta] = useState<{
    readonly threadId: string | null;
    readonly value: ConversationRelayMeta | null;
  }>({ threadId: null, value: null });
  const [rememberedConversationThreadId, setRememberedConversationThreadId] = useState<string | null>(
    conversationThreadIdOverride ?? null,
  );
  const [rememberedPersonId, setRememberedPersonId] = useState<string | null>(personIdOverride ?? null);
  const [foregroundModule, setForegroundModule] = useState<MissionCommandModuleId | null>('mission-current');
  const attention = useDocumentAttention();
  const effectiveForeground = workspaceActive ? foregroundModule : null;
  const conversationThreadId = conversationThreadIdOverride ?? rememberedConversationThreadId;
  const personId = personIdOverride ?? rememberedPersonId;

  useEffect(() => {
    if (conversationThreadIdOverride) setRememberedConversationThreadId(conversationThreadIdOverride);
  }, [conversationThreadIdOverride]);
  useEffect(() => {
    if (!personIdOverride) return;
    setRememberedPersonId(personIdOverride);
    setPersonWitness((current) =>
      current.personId === personIdOverride
        ? current
        : { personId: personIdOverride, truth: { kind: 'loading' } },
    );
    setPersonMeta((current) =>
      current.personId === personIdOverride
        ? current
        : { personId: personIdOverride, value: null },
    );
  }, [personIdOverride]);
  const mayRecordRead = mayRecordWorkspaceRead(
    effectiveForeground,
    attention.visibilityState,
    attention.hasFocus,
    attention.dialogOpen,
  );
  const mayRecordReadRef = useRef(mayRecordRead);
  mayRecordReadRef.current = mayRecordRead;

  // Route remount used to earn a fresh witness. Persistence keeps drafts and
  // window state, so each real route activation explicitly re-witnesses the
  // mission-owned regions instead of letting an old success look perpetual.
  const previousWorkspaceRequest = useRef(workspaceRequestKey);
  useEffect(() => {
    if (!workspaceActive || previousWorkspaceRequest.current === workspaceRequestKey) return;
    previousWorkspaceRequest.current = workspaceRequestKey;
    void Promise.all([
      mission.refetch(),
      thread.refetch(),
      obligations.refetch(),
      receipts.refetch(),
      prefs.refetch(),
      ...(canManage ? [members.refetch()] : []),
    ]);
  }, [workspaceActive, workspaceRequestKey, mission, thread, obligations, receipts, prefs, members, canManage]);

  // Continuity and Attention only navigate. Once the requested owning window
  // has reopened, focus the exact durable record named by the URL fragment.
  // Unknown fragments are ignored rather than becoming document selectors.
  useEffect(() => {
    if (!workspaceActive || !/^#(?:msg|obl)-[A-Za-z0-9_-]+$/.test(location.hash)) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const record = document.getElementById(location.hash.slice(1));
        if (!record) return;
        if (!record.hasAttribute('tabindex')) record.tabIndex = -1;
        record.focus({ preventScroll: true });
        record.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [location.hash, requestedModule, workspaceActive, workspaceRequestKey]);

  const invalidateThread = useCallback(
    () => Promise.all([qc.invalidateQueries({ queryKey: ['commsThread', missionId] }), qc.invalidateQueries({ queryKey: ['commsObligations', missionId] })]),
    [qc, missionId],
  );
  const focusObligationsWindow = useCallback(
    () => document.querySelector<HTMLElement>('[data-module="mission-obligations"]'),
    [],
  );

  /** Run a write; MODULE_READ_ONLY flips the lapsed posture, errors surface inline. */
  const write = useCallback(
    async (work: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      try {
        await work();
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'MODULE_READ_ONLY') {
          setLapsed(true);
          setActionError('The Comms license has lapsed — retained history is read-only.');
        } else {
          setActionError(err instanceof Error ? err.message : 'The action did not complete.');
          // A version conflict means the record moved under us: re-render from
          // fresh server truth so the next attempt carries the real version.
          if (err instanceof ApiError && err.status === 409) void invalidateThread();
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [invalidateThread],
  );

  // The keyset pages: page 0 is the newest window and carries the thread row +
  // my cursor. The wire is newest-first (seq DESC) — normalize ONCE here to the
  // ascending order every reading surface assumes (divider, sentinel, render).
  const firstPage = thread.data?.pages[0];
  const messages = useMemo(() => {
    const byId = new Map<string, CommsMessageDto>();
    for (const page of thread.data?.pages ?? []) for (const m of page.messages) byId.set(m.messageId, m);
    return [...byId.values()].sort((a, b) => a.seq - b.seq);
  }, [thread.data]);

  // ── receipts: advance the cursor on SEEING the end, debounced, never on mount ──
  const lastAdvancedRef = useRef(0);
  const debounceRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(debounceRef.current), []);
  useEffect(() => {
    if (!mayRecordRead) window.clearTimeout(debounceRef.current);
  }, [mayRecordRead]);
  const onReachedEnd = useCallback(() => {
    if (!mayRecordReadRef.current || documentHasOpenDialog()) return;
    const t = firstPage;
    if (!t?.thread) return;
    const target = t.thread.lastSeq;
    const mine = t.myLastReadSeq ?? 0;
    if (target <= mine || target <= lastAdvancedRef.current) return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      if (!mayRecordReadRef.current || documentHasOpenDialog()) return;
      lastAdvancedRef.current = target;
      // Advancing one's OWN cursor stays legal through lapse (reading your record).
      api
        .advanceMissionCursor(missionId, target)
        .then(() => qc.invalidateQueries({ queryKey: ['commsReceipts', missionId] }))
        .catch(() => {
          lastAdvancedRef.current = 0; // let a later sighting retry
        });
    }, 1200);
  }, [firstPage, missionId, qc]);

  // ── identity resolution: only what the caller may already see ──────────────
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.data?.members ?? []) map.set(m.userId, m.displayName);
    for (const msg of messages) {
      if (msg.authorship.label) map.set(msg.authorship.userId, msg.authorship.label);
    }
    for (const o of obligations.data?.obligations ?? []) {
      for (const ev of o.events) if (ev.actorLabel) map.set(ev.actorUserId, ev.actorLabel);
      for (const ev of o.evidence) if (ev.delivererLabel) map.set(ev.deliveredByUserId, ev.delivererLabel);
    }
    if (me) map.set(me.userId, `${me.displayName} (you)`);
    return (userId: string): string => map.get(userId) ?? 'Member';
  }, [members.data, messages, obligations.data, me]);

  // Disclosed receipts on the thread's latest message — the SERVER-derived
  // lastSeq, never positional indexing into a page window.
  const seenLine = useMemo(() => {
    const t = firstPage;
    const list = receipts.data?.receipts ?? [];
    if (!t?.thread || t.thread.lastSeq === 0 || list.length === 0) return null;
    const lastSeq = t.thread.lastSeq;
    const seen = list.filter((r) => r.userId !== me?.userId && r.lastReadSeq >= lastSeq);
    if (seen.length === 0) return null;
    return `Seen by ${seen.map((r) => nameOf(r.userId)).join(', ')}`;
  }, [firstPage, receipts.data, me, nameOf]);

  // ── the actions ────────────────────────────────────────────────────────────
  const onPost = useCallback(
    (body: string, links: CommsLinkInput[]) =>
      write(async () => {
        await api.postMissionMessage(missionId, { body, links, clientMutationId: crypto.randomUUID() });
        await invalidateThread();
      }),
    [write, missionId, invalidateThread],
  );

  // Phase C: post as a decision, optionally naming what it supersedes.
  const onPostKinded = useCallback(
    (body: string, links: CommsLinkInput[], kind: 'note' | 'decision', supersedes: string | null) =>
      write(async () => {
        await api.postMissionMessage(missionId, {
          body,
          links,
          clientMutationId: crypto.randomUUID(),
          messageKind: kind,
          supersedesMessageId: supersedes,
        });
        await invalidateThread();
      }),
    [write, missionId, invalidateThread],
  );

  const onAttach = useCallback(
    async (file: File) => {
      await write(async () => {
        await api.uploadMissionAttachment(missionId, file, crypto.randomUUID());
        await invalidateThread();
      });
    },
    [write, missionId, invalidateThread],
  );

  const onTransition = useCallback(
    (obligationId: string, input: ObligationActionInput) =>
      write(async () => {
        await api.transitionCommsObligation(obligationId, input.action, {
          expectedVersion: input.expectedVersion,
          clientMutationId: crypto.randomUUID(),
          ...(input.note ? { note: input.note } : {}),
        });
        await invalidateThread();
      }),
    [write, invalidateThread],
  );

  const onDeliverEvidence = useCallback(
    async (obligationId: string, file: File, note: string | null) => {
      await write(async () => {
        await api.deliverCommsEvidence(obligationId, file, crypto.randomUUID(), note ?? undefined);
        await invalidateThread();
      });
    },
    [write, invalidateThread],
  );

  const onTogglePrefs = useCallback(
    (patch: { receiptsEnabled?: boolean; presenceEnabled?: boolean }) => {
      const current = prefs.data;
      if (!current) return;
      // Own-prefs stay live through lapse — NOT routed through the lapse flip.
      setActionError(null);
      api
        .setCommsPrefs({
          receiptsEnabled: patch.receiptsEnabled ?? current.receiptsEnabled,
          presenceEnabled: patch.presenceEnabled ?? current.presenceEnabled,
          expectedVersion: current.version,
        })
        .then(() => Promise.all([qc.invalidateQueries({ queryKey: ['commsPrefs'] }), qc.invalidateQueries({ queryKey: ['commsReceipts', missionId] })]))
        .catch((err) => {
          if (err instanceof ApiError && err.status === 409) void qc.invalidateQueries({ queryKey: ['commsPrefs'] });
          else setActionError(err instanceof Error ? err.message : 'The preference did not save.');
        });
    },
    [prefs.data, qc, missionId],
  );

  // Never-entitled and missing-mission are the SAME truthful absence (404) —
  // including the header: any 404 posture echoes only the raw id.
  const notFound =
    (mission.error instanceof ApiError && mission.error.status === 404) || (thread.error instanceof ApiError && thread.error.status === 404);
  const record = notFound ? missionId : (mission.data?.mission.name ?? missionId);

  const obligationList = obligations.data?.obligations ?? [];

  // Phase A — the six-state contract: BOTH regions derive through the ONE
  // deriver (the shipped page's hand-rolled empty branch was the instance-21
  // violation two Battle-#2 seats independently found).
  const missionTruth = truthStateOf(
    { data: mission.data, error: mission.error, isLoading: mission.isLoading, dataUpdatedAt: mission.dataUpdatedAt },
    () => false,
  );
  const threadTruth = withModuleChannelTruth(
    truthStateOf(
      { data: thread.data, error: thread.error, isLoading: thread.isLoading, dataUpdatedAt: thread.dataUpdatedAt },
      () => messages.length === 0,
    ),
    live.state,
  );
  const obligationsTruth = truthStateOf(
    { data: obligations.data, error: obligations.error, isLoading: obligations.isLoading, dataUpdatedAt: obligations.dataUpdatedAt },
    (d) => d.obligations.length === 0,
  );
  const continuityTruth = joinMissionContinuityWitness({
    messages,
    messageTruth: threadTruth,
    obligations: obligationList,
    obligationTruth: obligationsTruth,
  });
  const resolveAttentionHref = useCallback(
    (target: CommandAttentionTarget): string => {
      if (target.threadKind === 'anchored' && target.anchorType === 'Mission' && target.anchorId) {
        const base = `/missions/${target.anchorId}/comms`;
        return target.kind === 'obligation-thread'
          ? `${base}?open=obligations#obl-${target.obligationId}`
          : base;
      }
      return `/comms/threads/${target.threadId}?workspace=${missionId}`;
    },
    [missionId],
  );
  const workspaceThreadHref = useCallback(
    (threadId: string) => `/comms/threads/${threadId}?workspace=${missionId}`,
    [missionId],
  );
  const workspacePersonHref = useCallback(
    (nextPersonId: string) => `/people/${nextPersonId}?workspace=${missionId}`,
    [missionId],
  );
  const onConversationTruthChange = useCallback(
    (truth: WitnessState) => {
      if (conversationThreadId) setConversationWitness({ threadId: conversationThreadId, truth });
    },
    [conversationThreadId],
  );
  const onConversationMetaChange = useCallback(
    (value: ConversationRelayMeta) => {
      if (conversationThreadId) setConversationMeta({ threadId: conversationThreadId, value });
    },
    [conversationThreadId],
  );
  const onPersonTruthChange = useCallback(
    (truth: WitnessState) => {
      if (personId) setPersonWitness({ personId, truth });
    },
    [personId],
  );
  const onPersonMetaChange = useCallback(
    (value: PersonRecordMeta) => {
      if (personId) setPersonMeta({ personId, value });
    },
    [personId],
  );
  const onConversationModuleReadOnly = useCallback(() => setLapsed(true), []);
  const missionActionsAvailable = isActionableWitness(missionTruth);
  const obligationActionsAvailable = missionActionsAvailable && isActionableWitness(obligationsTruth);
  const routeMeta = WORKSPACE_ROUTE_META[requestedModule];
  const activeConversationTruth =
    conversationWitness.threadId === conversationThreadId
      ? conversationWitness.truth
      : ({ kind: 'loading' } as const);
  const activeConversationMeta =
    conversationMeta.threadId === conversationThreadId ? conversationMeta.value : null;
  const activePersonTruth =
    personWitness.personId === personId
      ? personWitness.truth
      : ({ kind: 'loading' } as const);
  const activePersonMeta = personMeta.personId === personId ? personMeta.value : null;
  const conversationModule: MissionCommandModule | null = conversationThreadId
    ? {
        id: 'conversation-relay',
        eyebrow: `Relay · ${activeConversationMeta?.kindLabel ?? 'Conversation'}`,
        title: activeConversationMeta?.record ?? 'Conversation Relay',
        detail: 'One runtime conversation beside the command field. Geometry stays; private thread identity and drafts never enter a saved layout.',
        truth: activeConversationTruth,
        actionable: isActionableWitness(activeConversationTruth) && !lapsed,
        unmountWhenClosed: true,
        children: (
          <ConversationRelay
            key={conversationThreadId}
            threadId={conversationThreadId}
            instanceId={`workspace-relay-${conversationThreadId}`}
            live={live}
            enabled={workspaceActive}
            foreground={effectiveForeground === 'conversation-relay'}
            activationKey={workspaceRequestKey}
            hrefForThread={workspaceThreadHref}
            backHref={`/comms?workspace=${missionId}`}
            moduleReadOnly={lapsed}
            onModuleReadOnly={onConversationModuleReadOnly}
            onTruthChange={onConversationTruthChange}
            onMetaChange={onConversationMetaChange}
          />
        ),
      }
    : null;
  const personModule: MissionCommandModule | null = personId
    ? {
        id: 'person-record',
        eyebrow: 'Living Field · Person',
        title: activePersonMeta?.record ?? 'Person Record',
        detail: 'One runtime personnel record. Geometry stays; person identity and sensitive facts never enter a saved workspace view.',
        truth: activePersonTruth,
        unmountWhenClosed: true,
        children: (
          <PersonRecord
            key={personId}
            personId={personId}
            enabled={workspaceActive}
            foreground={effectiveForeground === 'person-record'}
            activationKey={workspaceRequestKey}
            fullRecordHref={`/people/${personId}`}
            onTruthChange={onPersonTruthChange}
            onMetaChange={onPersonMetaChange}
          />
        ),
      }
    : null;
  const workspaceArrivals = live.arrivals.map((arrival) => ({
    id: arrival.key,
    title: arrival.recalled ? 'A message was recalled' : `New message from ${arrival.authorLabel ?? 'a member'}`,
    detail: arrival.recalled ? null : (arrival.preview ?? null),
    href:
      arrival.threadId === firstPage?.thread?.threadId
        ? `/missions/${missionId}/comms#msg-${arrival.messageId}`
        : workspaceThreadHref(arrival.threadId),
  }));

  // Lapse or an untrusted witness removes every governed write surface — the
  // open mint float included. Stale data stays readable, never actionable.
  useEffect(() => {
    if (!workspaceActive) setMintOpen(false);
  }, [workspaceActive]);
  useEffect(() => {
    if (lapsed) setMintOpen(false);
    else if (!obligationActionsAvailable) setMintOpen(false);
  }, [lapsed, obligationActionsAvailable]);

  return (
    <AppFrame
      place={routeMeta.place}
      wide
      workspaceMissionId={missionId}
      active={workspaceActive}
      actor={{ displayName: me?.displayName ?? 'Member', role: me?.role ?? '', tenantName: me?.tenantSlug ?? '' }}
      header={
        <ContextHeader
          place={routeMeta.place}
          origin={routeMeta.origin}
          record={
            requestedModule === 'person-record'
              ? (activePersonMeta?.record ?? 'Person Record')
              : requestedModule === 'seats-standing'
                ? 'Seats & Standing'
                : requestedModule === 'organization-continuity'
                  ? 'Organization Continuity'
                : record
          }
          section={routeMeta.section}
          actions={
            <>
              <Link className="intent-button" to={`/missions/${missionId}`}>
                Open mission workspace
              </Link>
              <Link className="intent-button" to={`/missions/${missionId}/comms`} aria-current={requestedModule === 'mission-current' ? 'page' : undefined}>
                Mission Current
              </Link>
              <Link className="intent-button" to={`/situation?workspace=${missionId}`} aria-current={requestedModule === 'command-constellation' ? 'page' : undefined}>
                Constellation
              </Link>
              <Link className="intent-button" to={`/comms?workspace=${missionId}`} aria-current={requestedModule === 'command-attention' ? 'page' : undefined}>
                My Attention
              </Link>
              <Link className="intent-button" to={`/people?workspace=${missionId}`} aria-current={requestedModule === 'people-field' ? 'page' : undefined}>
                People
              </Link>
              <Link className="intent-button" to={`/members?workspace=${missionId}`} aria-current={requestedModule === 'seats-standing' ? 'page' : undefined}>
                Seats
              </Link>
              <Link className="intent-button" to={`/teams?workspace=${missionId}`} aria-current={requestedModule === 'organization-continuity' ? 'page' : undefined}>
                Organization
              </Link>
              <Link className="intent-button" to={`/missions/${missionId}/comms?open=continuity`} aria-current={requestedModule === 'mission-continuity' ? 'page' : undefined}>
                Continuity
              </Link>
              <Link className="intent-button" to={`/missions/finance?workspace=${missionId}`} aria-current={requestedModule === 'mission-finance' ? 'page' : undefined}>
                Finance
              </Link>
              <Link className="intent-button" to={`/approvals?workspace=${missionId}`} aria-current={requestedModule === 'approvals-register' ? 'page' : undefined}>
                Approvals
              </Link>
              <Link className="intent-button" to={`/calendar?workspace=${missionId}`} aria-current={requestedModule === 'calendar-horizon' ? 'page' : undefined}>
                Calendar
              </Link>
            </>
          }
        />
      }
    >
      {notFound ? (
        <WorkSurface tier="base" className="comms-surface" aria-labelledby="comms-missing-heading">
          <header className="surface-heading">
            <div>
              <h2 id="comms-missing-heading">This mission is not available</h2>
              <p>The mission does not exist or is outside your access.</p>
            </div>
          </header>
          <p className="boundary-note">
            <Link to="/missions">Back to Operations</Link>
          </p>
        </WorkSurface>
      ) : (
        <>
          <ToastStack
            items={workspaceArrivals}
            onDismiss={live.dismiss}
            onOpen={(item) => {
              live.dismiss(item.id);
              if (item.href) navigate(item.href);
            }}
          />
          {lapsed ? (
            <div className="lapsed-banner" role="status" data-tablework="LapsedBanner">
              <strong>Comms access lapsed · retained history is read-only.</strong> Message, upload, obligation, and acceptance controls are absent.
            </div>
          ) : null}
          {actionError && !lapsed ? (
            <div className="lapsed-banner" role="alert">
              {actionError}
            </div>
          ) : null}
          <MissionCommandWorkspace
            missionId={missionId}
            missionName={record}
            requestedModule={activateRequestedModule ? requestedModule : undefined}
            requestKey={workspaceRequestKey}
            onForegroundModuleChange={setForegroundModule}
            onCloseModule={(moduleId) => {
              if (moduleId === 'mission-finance') setFinanceTruth({ kind: 'loading' });
              else if (moduleId === 'approvals-register') setApprovalsTruth({ kind: 'loading' });
              else if (moduleId === 'calendar-horizon') setCalendarTruth({ kind: 'loading' });
              else if (moduleId === 'command-constellation') setConstellationTruth({ kind: 'loading' });
              else if (moduleId === 'command-attention') setCommandAttentionTruth({ kind: 'loading' });
              else if (moduleId === 'people-field') setPeopleTruth({ kind: 'loading' });
              else if (moduleId === 'seats-standing') setSeatsTruth({ kind: 'loading' });
              else if (moduleId === 'organization-continuity') setOrganizationTruth({ kind: 'loading' });
              else if (moduleId === 'person-record') {
                setRememberedPersonId(null);
                setPersonWitness({ personId: null, truth: { kind: 'loading' } });
                setPersonMeta({ personId: null, value: null });
              }
              else if (moduleId === 'conversation-relay') {
                setRememberedConversationThreadId(null);
                setConversationWitness({ threadId: null, truth: { kind: 'loading' } });
                setConversationMeta({ threadId: null, value: null });
              }
              else return;
              if (requestedModule === moduleId) {
                navigate(`/missions/${missionId}/comms`, {
                  replace: true,
                  state: { workspaceRouteNeutral: true },
                });
              }
            }}
            active={workspaceActive}
            modules={[
              {
                id: 'mission-field' satisfies MissionCommandModuleId,
                eyebrow: 'Constellation · Mission',
                title: 'Mission Field',
                detail: 'The durable frame: scope, place, horizon, and the record that everything else orbits.',
                truth: missionTruth,
                children: (
                  <MissionField
                    mission={mission.data?.mission}
                    truth={missionTruth}
                    tenant={me?.tenantSlug ?? ''}
                    receiptsEnabled={prefs.data?.receiptsEnabled}
                    onToggleReceipts={
                      prefs.data
                        ? () => onTogglePrefs({ receiptsEnabled: !prefs.data!.receiptsEnabled })
                        : undefined
                    }
                  />
                ),
              },
              {
                id: 'mission-current' satisfies MissionCommandModuleId,
                eyebrow: 'Relay · Decision log',
                title: 'Mission Current',
                detail: 'The live operational record. Conversation carries context; governed acts stay with their records.',
                truth: threadTruth,
                children: (
                  <Thread
                    missionName={record}
                    threadTitle={firstPage?.thread?.title ?? record}
                    participantsLine="Part of the operational record · readable only within the mission boundary"
                    messages={messages}
                    myLastReadSeq={firstPage?.myLastReadSeq ?? null}
                    lapsed={lapsed}
                    seenLine={seenLine}
                    posting={busy}
                    onPost={onPost}
                    onAttach={onAttach}
                    onReachedEnd={onReachedEnd}
                    receiptEligible={mayRecordRead}
                    hasEarlier={thread.hasNextPage}
                    loadingEarlier={thread.isFetchingNextPage}
                    onLoadEarlier={() => void thread.fetchNextPage()}
                    truth={threadTruth}
                    audienceTreaty={{ text: 'Visible to everyone who can see this mission.', verified: mission.data !== undefined && !mission.error }}
                    onPostKinded={onPostKinded}
                  />
                ),
              },
              {
                id: 'mission-obligations' satisfies MissionCommandModuleId,
                eyebrow: 'Forecast · Governed work',
                title: 'Obligations',
                detail: 'Durable asks and their three independent truths. No pressure scores; no person ranking.',
                truth: obligationsTruth,
                actionable: obligationActionsAvailable && !lapsed,
                children: (
                  <WorkSurface as="aside" className="comms-surface" aria-label="Mission obligations">
                    <header className="surface-heading">
                      <div>
                        <h2>Obligations</h2>
                        <p>Durable asks, not pressure scores</p>
                      </div>
                      {/* D2: minting renders ONLY for operational roles. */}
                      {canManage && !lapsed ? (
                        <button
                          className="secondary-action"
                          type="button"
                          data-governed-control
                          hidden={!obligationActionsAvailable}
                          disabled={!obligationActionsAvailable}
                          onClick={() => {
                            if (obligationActionsAvailable) setMintOpen(true);
                          }}
                        >
                          Create obligation
                        </button>
                      ) : null}
                    </header>
                    <div className="obligation-stack">
                      <TruthPanel state={obligationsTruth} emptyLabel="No obligations recorded for this mission.">
                        {obligationList.map((o) => (
                          <ObligationCard
                            key={o.obligationId}
                            obligation={o}
                            myUserId={me?.userId ?? ''}
                            operational={canManage}
                            lapsed={lapsed}
                            readOnly={!obligationActionsAvailable}
                            busy={busy}
                            nameOf={nameOf}
                            onTransition={(input) => onTransition(o.obligationId, input)}
                            onDeliverEvidence={(file, note) => onDeliverEvidence(o.obligationId, file, note)}
                          />
                        ))}
                      </TruthPanel>
                    </div>
                  </WorkSurface>
                ),
              },
              {
                id: 'mission-finance' satisfies MissionCommandModuleId,
                eyebrow: 'Continuity · Finance',
                title: 'Finance Overview',
                detail: 'An independently witnessed register beside the mission — never borrowed from Comms live health.',
                truth: financeTruth,
                unmountWhenClosed: true,
                children: (
                  <MissionFinanceOverview
                    enabled={workspaceActive}
                    foreground={effectiveForeground === 'mission-finance'}
                    onTruthChange={setFinanceTruth}
                    linkToMission={(nextMissionId) => `/missions/${nextMissionId}/comms?open=finance`}
                  />
                ),
              } satisfies MissionCommandModule,
              {
                id: 'approvals-register' satisfies MissionCommandModuleId,
                eyebrow: 'Relay · Authority',
                title: 'Approvals Register',
                detail: 'Requests for authority, independently witnessed beside the work they govern.',
                truth: approvalsTruth,
                unmountWhenClosed: true,
                children: (
                  <ApprovalsRegister
                    enabled={workspaceActive}
                    foreground={effectiveForeground === 'approvals-register'}
                    onTruthChange={setApprovalsTruth}
                  />
                ),
              } satisfies MissionCommandModule,
              {
                id: 'calendar-horizon' satisfies MissionCommandModuleId,
                eyebrow: 'Forecast · Horizon',
                title: 'Calendar Horizon',
                detail: 'The dated field ahead: obligations, starts, ends, expiries, and delegated authority.',
                truth: calendarTruth,
                unmountWhenClosed: true,
                children: (
                  <CalendarHorizon
                    enabled={workspaceActive}
                    foreground={effectiveForeground === 'calendar-horizon'}
                    onTruthChange={setCalendarTruth}
                  />
                ),
              } satisfies MissionCommandModule,
              {
                id: 'command-constellation' satisfies MissionCommandModuleId,
                eyebrow: 'Constellation · Explainable field',
                title: 'Command Constellation',
                detail: 'Organization signals with their checks and score components visible. Read and navigate only; silence must be earned.',
                truth: constellationTruth,
                unmountWhenClosed: true,
                children: (
                  <CommandConstellation
                    enabled={workspaceActive}
                    foreground={effectiveForeground === 'command-constellation'}
                    onTruthChange={setConstellationTruth}
                  />
                ),
              } satisfies MissionCommandModule,
              {
                id: 'command-attention' satisfies MissionCommandModuleId,
                eyebrow: 'Relay · Personal attention',
                title: 'My Attention',
                detail: 'Only obligations and unread conversations awaiting the signed-in person. Opens records; never acts on them.',
                truth: commandAttentionTruth,
                unmountWhenClosed: true,
                children: (
                  <CommandAttention
                    enabled={workspaceActive}
                    foreground={effectiveForeground === 'command-attention'}
                    channel={live.state}
                    resolveHref={resolveAttentionHref}
                    onTruthChange={setCommandAttentionTruth}
                  />
                ),
              } satisfies MissionCommandModule,
              {
                id: 'mission-continuity' satisfies MissionCommandModuleId,
                eyebrow: 'Continuity · Recorded trace',
                title: 'Mission Continuity',
                detail: 'Messages, decisions, recalls, obligation transitions, and evidence in one trace. Standing and history stay distinct.',
                truth: continuityTruth,
                children: (
                  <MissionContinuity
                    messages={messages}
                    messageTruth={threadTruth}
                    obligations={obligationList}
                    obligationTruth={obligationsTruth}
                    onFocusMessage={(messageId) => navigate(`/missions/${missionId}/comms#msg-${messageId}`)}
                    onFocusObligation={(obligationId) => navigate(`/missions/${missionId}/comms?open=obligations#obl-${obligationId}`)}
                  />
                ),
              } satisfies MissionCommandModule,
              {
                id: 'people-field' satisfies MissionCommandModuleId,
                eyebrow: 'Living field · Personnel',
                title: 'Living Field',
                detail: 'Personnel records beside the work. No presence, ranking, inferred access seat, or invented team relationship.',
                truth: peopleTruth,
                unmountWhenClosed: true,
                children: (
                  <PeopleField
                    enabled={workspaceActive}
                    foreground={effectiveForeground === 'people-field'}
                    requestKey={workspaceRequestKey}
                    hrefForPerson={workspacePersonHref}
                    onTruthChange={setPeopleTruth}
                  />
                ),
              } satisfies MissionCommandModule,
              {
                id: 'seats-standing' satisfies MissionCommandModuleId,
                eyebrow: 'Organization · Access',
                title: 'Seats & Standing',
                detail: 'Current memberships and base tenant roles. Governed seat-change history appears only when independently readable.',
                truth: seatsTruth,
                unmountWhenClosed: true,
                children: (
                  <SeatsStanding
                    enabled={workspaceActive}
                    foreground={effectiveForeground === 'seats-standing'}
                    requestKey={workspaceRequestKey}
                    membersHref="/members"
                    approvalsHref={`/approvals?workspace=${missionId}`}
                    onTruthChange={setSeatsTruth}
                  />
                ),
              } satisfies MissionCommandModule,
              {
                id: 'organization-continuity' satisfies MissionCommandModuleId,
                eyebrow: 'Organization · Continuity',
                title: 'Organization Continuity',
                detail: 'Teams, canonical Team memberships on selection, and legal Entities only where that register is already exposed. No hierarchy is inferred.',
                truth: organizationTruth,
                unmountWhenClosed: true,
                children: (
                  <OrganizationContinuity
                    enabled={workspaceActive}
                    foreground={effectiveForeground === 'organization-continuity'}
                    requestKey={workspaceRequestKey}
                    teamsHref="/teams"
                    entitiesHref="/entities"
                    hrefForPerson={workspacePersonHref}
                    onTruthChange={setOrganizationTruth}
                  />
                ),
              } satisfies MissionCommandModule,
              ...(personModule ? [personModule] : []),
              ...(conversationModule ? [conversationModule] : []),
            ]}
          />
          {canManage && !lapsed ? (
            <MintObligationFloat
              key={missionId}
              open={mintOpen && obligationActionsAvailable}
              onClose={() => setMintOpen(false)}
              focusFallback={focusObligationsWindow}
              members={(members.data?.members ?? []).filter((m) => m.isActive)}
              existing={obligationList}
              serverError={actionError}
              onCreate={async (body) => {
                const ok = await write(async () => {
                  await api.createMissionObligation(missionId, body);
                  await invalidateThread();
                });
                if (ok) setMintOpen(false);
                return ok;
              }}
            />
          ) : null}
        </>
      )}
    </AppFrame>
  );
}

function MissionField({
  mission,
  truth,
  tenant,
  receiptsEnabled,
  onToggleReceipts,
}: {
  mission: MissionDto | undefined;
  truth: WitnessState;
  tenant: string;
  receiptsEnabled: boolean | undefined;
  onToggleReceipts: (() => void) | undefined;
}) {
  return (
    <div className="mission-field-card" data-tablework="MissionField">
      <TruthPanel state={truth} emptyLabel="This mission has no recorded field yet.">
        {mission ? (
          <>
            <section className="mission-field-hero">
              <span className={`mission-field-state${mission.isActive ? '' : ' is-inactive'}`}>
                {mission.isActive ? 'Active mission' : 'Inactive mission'}
              </span>
              <h2>{mission.name}</h2>
              <p>
                {mission.gameTitle ?? 'Game not recorded'}
                {mission.city ? ` · ${mission.city}` : ''}
              </p>
            </section>
            <dl className="mission-field-facts">
              <div>
                <dt>Mission</dt>
                <dd className="mono">{mission.missionId}</dd>
              </div>
              <div>
                <dt>Tournament code</dt>
                <dd className="mono">{mission.code ?? 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Organizer</dt>
                <dd>{mission.organizer ?? 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Horizon</dt>
                <dd>
                  {mission.startsOn}
                  {mission.endsOn ? ` → ${mission.endsOn}` : ' → open'}
                </dd>
              </div>
              <div>
                <dt>Finance stage</dt>
                <dd>{mission.financeStage}</dd>
              </div>
            </dl>
          </>
        ) : null}
      </TruthPanel>
      <p className="boundary-note">
        This Thread is readable only by Members who may read {mission?.name ?? 'this mission'}. Hidden Threads are absent without count or confirmation.
      </p>
      {receiptsEnabled !== undefined && onToggleReceipts ? (
        <div className="panel-actions" data-tablework="PrefsToggle" style={{ justifyContent: 'flex-start' }}>
          <button className="quiet-action" type="button" onClick={onToggleReceipts}>
            My read receipts: {receiptsEnabled ? 'shared' : 'private'}
          </button>
          {/* Presence remains internal-only, entitled, and default OFF. There
              is deliberately no presence surface in Mission Command. */}
        </div>
      ) : null}
      <div className="mission-field-route" aria-label="Mission record continuity">
        <span>{tenant || 'Tenant'}</span>
        <i aria-hidden="true" />
        <span>Current</span>
      </div>
    </div>
  );
}

interface MintMembers {
  userId: string;
  displayName: string;
  role: string;
}

/** The mint form (D2: ops only). One member may hold accountable and internal
 * acceptance authority; assignment overlap is context, while actual
 * same-person delivery + acceptance is derived later from recorded acts. */
function MintObligationFloat({
  open,
  onClose,
  focusFallback,
  members,
  existing,
  serverError,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  focusFallback: () => HTMLElement | null;
  members: MintMembers[];
  existing: CommsObligationDto[];
  /** The page-level write error, surfaced INSIDE the modal (the page banner
   *  sits behind the dialog backdrop and is unreachable while it is open). */
  serverError: string | null;
  onCreate: (body: CommsObligationCreateBody) => Promise<boolean>;
}) {
  const [description, setDescription] = useState('');
  const [accountable, setAccountable] = useState('');
  const [beneficiaryKind, setBeneficiaryKind] = useState<'account' | 'external'>('account');
  const [beneficiaryUser, setBeneficiaryUser] = useState('');
  const [beneficiaryLabel, setBeneficiaryLabel] = useState('');
  const [acceptanceKind, setAcceptanceKind] = useState<'account' | 'external'>('account');
  const [acceptanceUser, setAcceptanceUser] = useState('');
  const [acceptanceLabel, setAcceptanceLabel] = useState('');
  const [proxyUser, setProxyUser] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [evidenceRequirement, setEvidenceRequirement] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const samePersonAssignment = acceptanceKind === 'account' && acceptanceUser !== '' && acceptanceUser === accountable;

  const submit = async () => {
    setProblem(null);
    if (!description.trim() || !accountable || !dueAt || !evidenceRequirement.trim()) {
      setProblem('Description, accountable owner, due time, and the evidence requirement are all part of the record.');
      return;
    }
    if (beneficiaryKind === 'account' ? !beneficiaryUser : !beneficiaryLabel.trim()) {
      setProblem('Name the beneficiary.');
      return;
    }
    if (acceptanceKind === 'account' ? !acceptanceUser : !acceptanceLabel.trim() || !proxyUser) {
      setProblem('Name the acceptance authority (an external authority needs the internal member who records its word).');
      return;
    }
    const body: CommsObligationCreateBody = {
      description: description.trim(),
      accountableUserId: accountable,
      beneficiary: beneficiaryKind === 'account' ? { kind: 'account', userId: beneficiaryUser } : { kind: 'external', label: beneficiaryLabel.trim() },
      acceptance:
        acceptanceKind === 'account'
          ? { kind: 'account', userId: acceptanceUser }
          : { kind: 'external', label: acceptanceLabel.trim(), proxyUserId: proxyUser },
      dueAt: new Date(dueAt).toISOString(),
      evidenceRequirement: evidenceRequirement.trim(),
      clientMutationId: crypto.randomUUID(),
    };
    setCreating(true);
    try {
      if (await onCreate(body)) {
        setDescription('');
        setDueAt('');
        setEvidenceRequirement('');
        setProblem(null);
      } else {
        setProblem('The obligation was not created.');
      }
    } finally {
      setCreating(false);
    }
  };

  const memberOptions = members.map((m) => (
    <option key={m.userId} value={m.userId}>
      {m.displayName} · {m.role}
    </option>
  ));

  return (
    <FloatSurface
      open={open}
      onClose={onClose}
      labelledBy="mint-obligation-title"
      focusFallback={focusFallback}
    >
      <div className="float-header">
        <div>
          <p className="eyebrow">Obligation · durable ask</p>
          <h2 id="mint-obligation-title">Create obligation</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="float-body">
        <p className="boundary-note">
          A durable record with three independent truths — delivery, acceptance, Done. {existing.length > 0 ? `${existing.length} already recorded on this mission.` : ''}
        </p>
        <div style={{ display: 'grid', gap: 'var(--c3-space-3)' }}>
          <label className="tw-field">
            <span>Description</span>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="tw-field">
            <span>Accountable owner</span>
            <select value={accountable} onChange={(e) => setAccountable(e.target.value)}>
              <option value="">Choose a member</option>
              {memberOptions}
            </select>
          </label>
          <label className="tw-field">
            <span>Beneficiary</span>
            <select value={beneficiaryKind} onChange={(e) => setBeneficiaryKind(e.target.value as 'account' | 'external')}>
              <option value="account">A member</option>
              <option value="external">An external party</option>
            </select>
          </label>
          {beneficiaryKind === 'account' ? (
            <label className="tw-field">
              <span>Beneficiary member</span>
              <select value={beneficiaryUser} onChange={(e) => setBeneficiaryUser(e.target.value)}>
                <option value="">Choose a member</option>
                {memberOptions}
              </select>
            </label>
          ) : (
            <label className="tw-field">
              <span>Beneficiary label</span>
              <input type="text" value={beneficiaryLabel} onChange={(e) => setBeneficiaryLabel(e.target.value)} placeholder="e.g. the publisher" />
            </label>
          )}
          <label className="tw-field">
            <span>Acceptance authority</span>
            <select value={acceptanceKind} onChange={(e) => setAcceptanceKind(e.target.value as 'account' | 'external')}>
              <option value="account">A member</option>
              <option value="external">An external authority (recorded by a member)</option>
            </select>
          </label>
          {acceptanceKind === 'account' ? (
            <label className="tw-field">
              <span>Accepting member</span>
              <select value={acceptanceUser} onChange={(e) => setAcceptanceUser(e.target.value)}>
                <option value="">Choose a member</option>
                {memberOptions}
              </select>
            </label>
          ) : (
            <>
              <label className="tw-field">
                <span>External authority</span>
                <input type="text" value={acceptanceLabel} onChange={(e) => setAcceptanceLabel(e.target.value)} placeholder="e.g. the publisher's liaison" />
              </label>
              <label className="tw-field">
                <span>Recorded by (internal proxy)</span>
                <select value={proxyUser} onChange={(e) => setProxyUser(e.target.value)}>
                  <option value="">Choose a member</option>
                  {memberOptions}
                </select>
              </label>
            </>
          )}
          {samePersonAssignment ? (
            <p className="boundary-note">
              This member may hold both roles. If they deliver and accept, C3 will record that same-person act plainly.
            </p>
          ) : null}
          <label className="tw-field">
            <span>Due</span>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </label>
          <label className="tw-field">
            <span>Evidence requirement</span>
            <input type="text" value={evidenceRequirement} onChange={(e) => setEvidenceRequirement(e.target.value)} placeholder="What delivery must produce" />
          </label>
          {problem ? (
            <p className="boundary-note" role="alert">
              {problem}
              {serverError ? ` ${serverError}` : ''}
            </p>
          ) : null}
          <div className="panel-actions">
            <button className="quiet-action" type="button" onClick={onClose}>
              Close
            </button>
            <button className="primary-action" type="button" disabled={creating} onClick={() => void submit()}>
              Create the record
            </button>
          </div>
        </div>
      </div>
    </FloatSurface>
  );
}
