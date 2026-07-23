/**
 * records.tsx — the Tablework record family (the pivot's parallel-lane
 * front-load; Aura contract 05, Dawn's mission/ceremony craft).
 *
 * RecordPage/ObjectIdentity + SectionRail: the record hub's anatomy. The
 * WRITTEN RULE for converting lanes: Breadcrumbs do NOT port — the
 * ContextHeader's working-from band replaces them (detail pages pass
 * origin/record into TableworkPage).
 *
 * DocumentsSection / CommentThread / AuditTimeline: API-identical ports of
 * the Fluent cross-cutting detail components (testids + copy verbatim; the
 * e2e oracle drives documents + comments heavily). The mention picker is
 * spec-free and becomes honest member CHIPS (toggle to mention) — same
 * container testid, no Fluent TagPicker.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CommentSubjectType } from '@c3web/domain';
import { useComments, useDocuments, useMembers } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { WorkSurface } from './materials';
import { GovernedAction } from './GovernedAction';
import { EmptyState, usePageTitle } from './collections';

// ── RecordPage / ObjectIdentity / SectionRail (contract 05) ──────────────────

interface RecordPageProps {
  /** The eyebrow above the record's name (e.g. "Live mission · Rabat"). */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** The browser-tab name — pass the record's NAME ("C3 — Verify Cup") so
   *  tabs/history/bookmarks distinguish records; falls back to a string
   *  eyebrow's noun when absent. */
  documentTitle?: string;
  titleTestId?: string;
  /** The lead sentence under the name. */
  lead?: ReactNode;
  /** The identity-meta row (ids, dates, chips). */
  meta?: ReactNode;
  /** The record's local actions (top-right). */
  actions?: ReactNode;
  children: ReactNode;
}

export function RecordPage({ eyebrow, title, documentTitle, titleTestId, lead, meta, actions, children }: RecordPageProps) {
  usePageTitle(documentTitle ?? (typeof eyebrow === 'string' ? eyebrow : ''));
  return (
    <>
      <WorkSurface as="header" tier="raised" tablework="ObjectIdentity RecordPage" className="object-identity">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 data-testid={titleTestId}>{title}</h1>
          {lead ? <p className="record-lead">{lead}</p> : null}
          {meta ? <div className="identity-meta">{meta}</div> : null}
        </div>
        {actions ? <div className="local-actions">{actions}</div> : null}
      </WorkSurface>
      {children}
    </>
  );
}

export interface RecordSection {
  key: string;
  label: string;
  testId?: string;
}

/** The record's local sections — in-page tabs (Dawn's section-rail). */
export function SectionRail({
  sections,
  active,
  onSelect,
  label,
}: {
  sections: RecordSection[];
  active: string;
  onSelect: (key: string) => void;
  label: string;
}) {
  return (
    <WorkSurface as="nav" tablework="SectionRail" className="section-rail" aria-label={label}>
      {sections.map((s) => (
        <button
          key={s.key}
          type="button"
          className="secondary-action section-tab"
          aria-current={s.key === active ? 'page' : undefined}
          data-testid={s.testId}
          onClick={() => onSelect(s.key)}
        >
          {s.label}
        </button>
      ))}
    </WorkSurface>
  );
}

// ── DocumentsSection (S4 port) ───────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsSection({ ownerType, ownerId, canManage }: { ownerType: string; ownerId: string; canManage: boolean }) {
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading } = useDocuments(ownerType, ownerId);
  const docs = data?.documents ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['documents', ownerType, ownerId] });
    void qc.invalidateQueries({ queryKey: [`${ownerType.toLowerCase()}Audit`, ownerId] });
    void qc.invalidateQueries({ queryKey: ['missionAudit', ownerId] });
    void qc.invalidateQueries({ queryKey: ['agreementAudit', ownerId] });
    void qc.invalidateQueries({ queryKey: ['personAudit', ownerId] });
  };

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadDocument(ownerType, ownerId, file);
      notify('success', `"${file.name}" attached and recorded.`);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onDownload(documentId: string) {
    try {
      const { blob, fileName } = await api.downloadDocument(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The download failed.');
    }
  }

  return (
    <div className="record-section" data-testid="documents-panel">
      <div className="record-section-head">
        <h2>Documents</h2>
        {canManage && (
          <>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv,.txt"
              onChange={(e) => void onPick(e.target.files)}
              data-testid="document-file-input"
            />
            <button className="secondary-action" type="button" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="attach-document">
              {busy ? 'Uploading…' : 'Attach file…'}
            </button>
          </>
        )}
      </div>

      {isLoading && <span className="record-quiet">Loading documents…</span>}
      {!isLoading && docs.length === 0 && (
        <span className="record-quiet" data-testid="documents-empty">
          No documents attached.
        </span>
      )}
      {docs.length > 0 && (
        <div className="record-rows" data-testid="documents-list">
          {docs.map((d) => (
            <div key={d.documentId} className="record-row-item" data-testid={`document-row-${d.documentId}`}>
              <span className="record-row-name">
                {d.fileName}
                {d.label ? ` — ${d.label}` : ''}
              </span>
              <span className="record-row-meta">{`${formatSize(d.sizeBytes)} · ${d.uploadedBy}`}</span>
              <span className="record-row-spacer" />
              <button className="mini-action" type="button" onClick={() => void onDownload(d.documentId)} data-testid={`download-document-${d.documentId}`}>
                Download
              </button>
              {canManage && (
                <GovernedAction
                  triggerLabel="Remove…"
                  triggerTestId={`remove-document-${d.documentId}`}
                  triggerAppearance="secondary"
                  title={`Remove "${d.fileName}"?`}
                  description="The document disappears from this record immediately and the removal is recorded. The stored bytes are retained for the audit trail but are no longer reachable."
                  confirmLabel="Remove document"
                  onConfirm={async () => {
                    try {
                      await api.removeDocument(d.documentId, d.version);
                      notify('success', `"${d.fileName}" removed and recorded.`);
                      invalidate();
                    } catch (err) {
                      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
                      throw err instanceof Error ? err : new Error('failed');
                    }
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CommentThread (Track B4 port — Comments stay Record notes) ───────────────

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function CommentThread({ subjectType, subjectId }: { subjectType: CommentSubjectType; subjectId: string }) {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading } = useComments(subjectType, subjectId);
  // The member list drives the @mention chips — fetched only when the viewer
  // can read members (owner/ops). Other roles still comment, just without
  // the mention affordance (no 403 noise).
  const members = useMembers(me?.capabilities.canReadMembers ?? false);
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const memberOptions = (members.data?.members ?? []).map((m) => ({ value: m.email, label: `${m.displayName} (${m.email})` }));
  const comments = data?.comments ?? [];

  async function post() {
    if (body.trim() === '') return;
    setBusy(true);
    try {
      await api.postComment(subjectType, subjectId, body.trim(), mentions);
      setBody('');
      setMentions([]);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['comments', subjectType, subjectId] }),
        qc.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
      notify('success', mentions.length > 0 ? `Comment posted — ${mentions.length} member(s) notified.` : 'Comment posted.');
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not post the comment.');
    } finally {
      setBusy(false);
    }
  }

  const toggleMention = (email: string) =>
    setMentions((m) => (m.includes(email) ? m.filter((x) => x !== email) : [...m, email]));

  return (
    <div className="record-section comment-thread" data-testid="comment-thread">
      <h2>Discussion</h2>

      <div className="comment-list">
        {isLoading && <span className="record-quiet">Loading discussion…</span>}
        {!isLoading && comments.length === 0 && (
          <span className="record-quiet" data-testid="comments-empty">
            No comments yet. Start the thread.
          </span>
        )}
        {comments.map((c) => (
          <div key={c.id} className="comment-item" data-testid={`comment-${c.id}`}>
            <div className="comment-head">
              <span className="comment-author">{c.author}</span>
              <span className="comment-when">{fmt(c.createdAt)}</span>
            </div>
            <div className="comment-body">{c.body}</div>
            {c.mentions.length > 0 && <div className="comment-mentions-line">@ {c.mentions.join(', ')}</div>}
          </div>
        ))}
      </div>

      <div className="comment-composer">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" data-testid="comment-body" />
        {memberOptions.length > 0 && (
          <div>
            <div className="comment-mention-label">Mention members (they’ll be notified)</div>
            <div className="comment-mention-chips" data-testid="comment-mentions" role="group" aria-label="Mention members">
              {memberOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={mentions.includes(o.value) ? 'mini-action active' : 'mini-action'}
                  aria-pressed={mentions.includes(o.value)}
                  onClick={() => toggleMention(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="panel-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="primary-action" type="button" disabled={busy || body.trim() === ''} onClick={() => void post()} data-testid="comment-submit">
            {busy ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AuditTimeline (port) ─────────────────────────────────────────────────────

export interface TimelineEntry {
  at: string;
  label: string;
  actor: string;
  detail?: string | null;
}

export function AuditTimeline({
  entries,
  emptyMessage = 'No events recorded.',
  testId,
}: {
  entries: TimelineEntry[];
  emptyMessage?: string;
  testId?: string;
}) {
  if (entries.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <ol className="audit-timeline" data-tablework="History" data-testid={testId}>
      {entries.map((e, i) => (
        <li className="audit-entry" key={i}>
          <span className="audit-ts">{new Date(e.at).toLocaleString()}</span>
          <div>
            <div className="audit-action">{e.label}</div>
            <div className="audit-actor">{e.actor}</div>
            {e.detail && <div className="audit-detail">{e.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
