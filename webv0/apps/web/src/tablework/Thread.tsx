/**
 * Thread.tsx — the Mission Thread surface (Dawn's screen-4 center column).
 *
 * ConversationHeader + the ordered messages (with the derived unread divider)
 * + the composer. The composer carries BOTH governance texts: the D1 warning
 * ("visible to everyone who can see this mission" — owner-ruled, not
 * optional) and the navigate-never-execute boundary note. On lapse the
 * composer is REMOVED (not disabled-but-present) and reads stay live.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { CommsMessageDto } from '@c3web/api-contracts';
import type { CommsLinkInput, CommsLinkTargetType } from '@c3web/domain';
import { Message } from './Message';

/** Auto-detect record references in the body → ObjectLink chips (cap 10). */
export function detectLinks(body: string): CommsLinkInput[] {
  const PATTERNS: ReadonlyArray<{ targetType: CommsLinkTargetType; re: RegExp }> = [
    { targetType: 'Approval', re: /\bAPR-\d{4,}\b/g },
    { targetType: 'Mission', re: /\bMSN-\d{4,}\b/g },
    { targetType: 'Journey', re: /\bJRN-\d{4,}\b/g },
    { targetType: 'Person', re: /\bPER-\d{4,}\b/g },
    { targetType: 'Credential', re: /\bCRED-\d{4,}\b/g },
    { targetType: 'Document', re: /\bDOC-\d{4,}\b/g },
    { targetType: 'Message', re: /\bMSG-\d{4,}\b/g },
    { targetType: 'Obligation', re: /\bOBL-\d{4,}\b/g },
  ];
  const links: CommsLinkInput[] = [];
  const seen = new Set<string>();
  for (const { targetType, re } of PATTERNS) {
    for (const m of body.match(re) ?? []) {
      if (!seen.has(m) && links.length < 10) {
        seen.add(m);
        links.push({ targetType, targetId: m });
      }
    }
  }
  return links;
}

interface ThreadProps {
  missionName: string;
  threadTitle: string;
  participantsLine: string;
  messages: CommsMessageDto[];
  myLastReadSeq: number | null;
  lapsed: boolean;
  /** Disclosed-receipts line for the latest message (already resolved to labels). */
  seenLine: string | null;
  posting: boolean;
  onPost: (body: string, links: CommsLinkInput[]) => Promise<boolean>;
  onAttach: (file: File) => Promise<void>;
  /** Fires when the conversation's end becomes visible — the receipt cursor
   *  advances on SEEING the end, never on mere mount (the page debounces). */
  onReachedEnd?: () => void;
  /** Older messages exist beyond the loaded window (keyset paging). */
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
}

export function Thread({ missionName, threadTitle, participantsLine, messages, myLastReadSeq, lapsed, seenLine, posting, onPost, onAttach, onReachedEnd, hasEarlier, loadingEarlier, onLoadEarlier }: ThreadProps) {
  const [draft, setDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const reachedEnd = useRef(onReachedEnd);
  reachedEnd.current = onReachedEnd;

  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) reachedEnd.current?.();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [messages.length]);

  // The unread divider sits before the first message past my cursor — derived
  // from myLastReadSeq, never a stored flag.
  const firstUnreadSeq = useMemo(() => {
    if (myLastReadSeq === null) return null;
    const next = messages.find((m) => m.seq > myLastReadSeq);
    return next ? next.seq : null;
  }, [messages, myLastReadSeq]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    if (await onPost(body, detectLinks(body))) setDraft('');
  };

  return (
    <section className="comms-surface work-surface raised" data-tablework="Thread ConversationHeader WorkSurface" data-material="work" aria-labelledby="thread-heading">
      <header className="conversation-header" data-tablework="ConversationHeader">
        <div>
          <p className="eyebrow">{missionName} · Mission Thread</p>
          <h2 id="thread-heading">{threadTitle}</h2>
          <p>{participantsLine}</p>
        </div>
        <span className={`state-label ${lapsed ? 'warning' : 'info'}`}>{lapsed ? 'Read-only history' : 'Anchored'}</span>
      </header>
      <div className="conversation">
        {hasEarlier ? (
          <button className="quiet-action" type="button" disabled={loadingEarlier} onClick={onLoadEarlier}>
            {loadingEarlier ? 'Loading earlier messages...' : 'Load earlier messages'}
          </button>
        ) : null}
        {messages.length === 0 ? <p className="boundary-note">No messages yet. The record starts with the first word.</p> : null}
        {messages.map((message) => (
          <div key={message.messageId} style={{ display: 'contents' }}>
            {firstUnreadSeq !== null && message.seq === firstUnreadSeq ? (
              <div className="unread-divider" role="separator" aria-label="Unread messages start here">
                <span>New</span>
              </div>
            ) : null}
            <Message message={message} />
          </div>
        ))}
        {seenLine ? <p className="boundary-note" data-tablework="Receipts">{seenLine}</p> : null}
        <div ref={endRef} aria-hidden="true" />
      </div>
      {lapsed ? null : (
        <form className="compose" data-tablework="Composer" onSubmit={(e) => void submit(e)}>
          <label className="sr-only" htmlFor="thread-message">
            Message {missionName}
          </label>
          <textarea
            id="thread-message"
            name="message"
            placeholder={`Write in the ${missionName} Mission Thread`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {/* D1 (owner-ruled): the cross-tier visibility warning is not optional. */}
          <p className="boundary-note" data-tablework="VisibilityWarning">
            Visible to everyone who can see this mission.
          </p>
          <div className="compose-foot">
            <div className="message-actions">
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                tabIndex={-1}
                aria-label="Attach a file to the conversation"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && !posting) void onAttach(file);
                  e.target.value = '';
                }}
              />
              <button className="mini-action" type="button" disabled={posting} onClick={() => fileRef.current?.click()}>
                Attach to conversation
              </button>
            </div>
            <button className="primary-action" type="submit" disabled={posting || draft.trim().length === 0}>
              Send
            </button>
          </div>
        </form>
      )}
      <p className="boundary-note">
        Approval references only navigate. Conversation cannot approve, reject, execute, accept evidence, or record Done.
      </p>
    </section>
  );
}
