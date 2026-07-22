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
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CommsMessageDto, CommsObligationDto } from '@c3web/api-contracts';
import type { CommsLinkInput } from '@c3web/domain';
import { useSession } from '../session';
import { useCommsPrefs, useMembers, useMission, useMissionObligations, useMissionReceipts, useMissionThread } from '../queries';
import { api } from '../apiClient';
import { ApiError, type CommsObligationCreateBody } from '../api';
import { IS_ENTRA } from '../auth';
import { EntraSignIn, AccessNotProvisioned } from './EntraSignIn';
import { LoginGate } from './LoginGate';
import { AppFrame, ContextHeader, FloatSurface, ObligationCard, Thread, WorkSurface, type ObligationActionInput } from '../tablework';

export function MissionCommsPage() {
  const { missionId } = useParams<{ missionId: string }>();
  const { status, providerSession, signOut } = useSession();

  // The AppShell's exact session gate, replicated for the standalone mount.
  // The screen (and its queries) mounts ONLY once authenticated — a query
  // fired pre-auth would 401 and, with the app-wide retry:false, stay stuck.
  if (status === 'loading') {
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>Loading session...</div>;
  }
  if (status === 'anonymous') {
    const intended = `/missions/${missionId}/comms`;
    return IS_ENTRA ? <EntraSignIn intendedPath={intended} /> : <LoginGate intendedPath={intended} />;
  }
  if (status === 'unprovisioned') {
    return <AccessNotProvisioned identity={providerSession?.identity ?? 'This account'} onSignOut={() => void signOut()} />;
  }

  return <MissionCommsScreen missionId={missionId ?? ''} />;
}

function MissionCommsScreen({ missionId }: { missionId: string }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const mission = useMission(missionId);
  const thread = useMissionThread(missionId);
  const obligations = useMissionObligations(missionId);
  const receipts = useMissionReceipts(missionId);
  const prefs = useCommsPrefs();
  const canManage = me?.capabilities.canManageMissions ?? false;
  // D2's mint population: the owner/ops member directory (the API gates it).
  const members = useMembers(canManage);

  // Lapse is reactive truth: set when the API refuses a write as read-only.
  const [lapsed, setLapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mintOpen, setMintOpen] = useState(false);

  const invalidateThread = useCallback(
    () => Promise.all([qc.invalidateQueries({ queryKey: ['commsThread', missionId] }), qc.invalidateQueries({ queryKey: ['commsObligations', missionId] })]),
    [qc, missionId],
  );

  // Lapse removes every write surface — the open mint float included.
  useEffect(() => {
    if (lapsed) setMintOpen(false);
  }, [lapsed]);

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
  const onReachedEnd = useCallback(() => {
    const t = firstPage;
    if (!t?.thread) return;
    const target = t.thread.lastSeq;
    const mine = t.myLastReadSeq ?? 0;
    if (target <= mine || target <= lastAdvancedRef.current) return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
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
    for (const msg of messages) if (msg.authorLabel) map.set(msg.authorUserId, msg.authorLabel);
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

  return (
    <AppFrame
      place="Comms"
      actor={{ displayName: me?.displayName ?? 'Member', role: me?.role ?? '', tenantName: me?.tenantSlug ?? '' }}
      header={
        <ContextHeader
          place="Comms"
          origin="Mission"
          record={record}
          section="Mission Thread"
          actions={
            <Link className="intent-button" to={`/missions/${missionId}`}>
              Open mission workspace
            </Link>
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
          <div className="comms-layout">
            <WorkSurface as="nav" tablework="SectionRail" className="comms-surface" aria-label="Comms places">
              <header className="surface-heading">
                <div>
                  <h2>Comms</h2>
                  <p>{me?.tenantSlug}</p>
                </div>
              </header>
              <div className="thread-list">
                <span className="thread-item active" aria-current="page">
                  <strong>{record}</strong>
                  <small>Mission Thread</small>
                </span>
              </div>
              <p className="boundary-note">
                This Thread is readable only by Members who may read {record}. Hidden Threads are absent without count or confirmation.
              </p>
              {prefs.data ? (
                <div className="panel-actions" data-tablework="PrefsToggle" style={{ justifyContent: 'flex-start' }}>
                  <button className="quiet-action" type="button" onClick={() => onTogglePrefs({ receiptsEnabled: !prefs.data!.receiptsEnabled })}>
                    My read receipts: {prefs.data.receiptsEnabled ? 'shared' : 'private'}
                  </button>
                  <button className="quiet-action" type="button" onClick={() => onTogglePrefs({ presenceEnabled: !prefs.data!.presenceEnabled })}>
                    Presence: {prefs.data.presenceEnabled ? 'shared' : 'private'}
                  </button>
                </div>
              ) : null}
            </WorkSurface>
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
              hasEarlier={thread.hasNextPage}
              loadingEarlier={thread.isFetchingNextPage}
              onLoadEarlier={() => void thread.fetchNextPage()}
            />
            <WorkSurface as="aside" className="comms-surface" aria-label="Mission obligations">
              <header className="surface-heading">
                <div>
                  <h2>Obligations</h2>
                  <p>Durable asks, not pressure scores</p>
                </div>
                {/* D2: minting renders ONLY for operational roles. */}
                {canManage && !lapsed ? (
                  <button className="secondary-action" type="button" onClick={() => setMintOpen(true)}>
                    Create obligation
                  </button>
                ) : null}
              </header>
              <div className="obligation-stack">
                {obligationList.length === 0 ? <p className="boundary-note">No obligations recorded for this mission.</p> : null}
                {obligationList.map((o) => (
                  <ObligationCard
                    key={o.obligationId}
                    obligation={o}
                    myUserId={me?.userId ?? ''}
                    operational={canManage}
                    lapsed={lapsed}
                    busy={busy}
                    nameOf={nameOf}
                    onTransition={(input) => onTransition(o.obligationId, input)}
                    onDeliverEvidence={(file, note) => onDeliverEvidence(o.obligationId, file, note)}
                  />
                ))}
              </div>
            </WorkSurface>
          </div>
          {canManage && !lapsed ? (
            <MintObligationFloat
              open={mintOpen}
              onClose={() => setMintOpen(false)}
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

interface MintMembers {
  userId: string;
  displayName: string;
  role: string;
}

/** The mint form (D2: ops only). The SoD seam renders as the API enforces it:
 *  an ACCOUNT acceptance must not be the accountable owner. */
function MintObligationFloat({
  open,
  onClose,
  members,
  existing,
  serverError,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
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

  const sodViolation = acceptanceKind === 'account' && acceptanceUser !== '' && acceptanceUser === accountable;

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
    if (sodViolation) {
      setProblem('The accountable owner cannot be their own acceptance authority — delivered and accepted stay independent.');
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
    <FloatSurface open={open} onClose={onClose} labelledBy="mint-obligation-title">
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
          {sodViolation ? (
            <p className="boundary-note" role="alert">
              The accountable owner cannot be their own acceptance authority.
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
