/**
 * Thread.tsx — the Mission Thread surface (Dawn's screen-4 center column).
 *
 * ConversationHeader + the ordered messages (with the derived unread divider)
 * + the composer. The composer carries BOTH governance texts: the D1 warning
 * ("visible to everyone who can see this mission" — owner-ruled, not
 * optional) and the navigate-never-execute boundary note. On lapse the
 * composer is REMOVED (not disabled-but-present) and reads stay live.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { CommsMessageDto } from '@c3web/api-contracts';
import type { CommsLinkInput, CommsLinkTargetType } from '@c3web/domain';
import { Message } from './Message';
import { TruthPanel, type WitnessState } from './TruthPanel';
import { isActionableWitness } from './missionCommandModel';

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
  /** Phase A: the region's witness state — the page DERIVES it (truthStateOf),
   *  this surface only renders it. Emptiness is earned, failure is failure. */
  truth: WitnessState;
  /** Phase B — THE AUDIENCE TREATY (Intel's contract, adopted): the composer
   *  names the governing audience BEFORE words leave the box, and when the
   *  audience could not be verified, Send is DISABLED rather than guessing. */
  audienceTreaty: { text: string; verified: boolean };
  /** Phase C: post with a kind (decision records). When provided, the composer
   *  offers the toggle and the supersedes picker. */
  onPostKinded?: (body: string, links: CommsLinkInput[], kind: 'note' | 'decision', supersedes: string | null) => Promise<boolean>;
}

export function Thread({ missionName, threadTitle, participantsLine, messages, myLastReadSeq, lapsed, seenLine, posting, onPost, onAttach, onReachedEnd, hasEarlier, loadingEarlier, onLoadEarlier, truth, audienceTreaty, onPostKinded }: ThreadProps) {
  const [draft, setDraft] = useState('');
  const [asDecision, setAsDecision] = useState(false);
  const [supersedes, setSupersedes] = useState('');
  const actionsFresh = isActionableWitness(truth) && audienceTreaty.verified;
  const composerAvailable = !lapsed && actionsFresh;
  // The chain is DERIVED from the wire, never client state: a later decision
  // that names an earlier message marks it superseded.
  const supersededBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) if (!m.recalled && m.supersedesMessageId) map.set(m.supersedesMessageId, m.messageId);
    return map;
  }, [messages]);
  const priorDecisions = useMemo(
    () => messages.filter((m): m is Extract<CommsMessageDto, { recalled: false }> => !m.recalled && m.messageKind === 'decision'),
    [messages],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLElement>(null);
  const composerHadFocus = useRef(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const reachedEnd = useRef(onReachedEnd);
  const previousLastSeq = useRef<number | null>(null);
  reachedEnd.current = onReachedEnd;

  useLayoutEffect(() => {
    if (!composerAvailable && composerHadFocus.current) {
      composerHadFocus.current = false;
      threadRef.current?.focus();
    }
  }, [composerAvailable]);

  // A thread opens on its Current, like a living conversation rather than a
  // document starting at page one. This scrolls ONLY the conversation pane
  // (never the enclosing Room). The receipt still advances through the
  // IntersectionObserver below: the end has to become visibly present.
  useEffect(() => {
    const scroller = conversationRef.current;
    const latest = messages.at(-1)?.seq ?? 0;
    const previous = previousLastSeq.current;
    const wasNearEnd = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160 : false;
    previousLastSeq.current = latest;
    if (!scroller || !(previous === null || previous === 0 || (latest > previous && wasNearEnd))) return;
    const frame = window.requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => {
    const el = endRef.current;
    const scroller = conversationRef.current;
    if (!el || !scroller) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) reachedEnd.current?.();
    }, { root: scroller });
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
    if (!actionsFresh) return;
    const body = draft.trim();
    if (!body || posting) return;
    const posted = onPostKinded
      ? await onPostKinded(body, detectLinks(body), asDecision ? 'decision' : 'note', asDecision && supersedes ? supersedes : null)
      : await onPost(body, detectLinks(body));
    if (posted) {
      setDraft('');
      setAsDecision(false);
      setSupersedes('');
    }
  };

  return (
    <section
      className="comms-surface work-surface raised"
      data-tablework="Thread ConversationHeader WorkSurface"
      data-material="work"
      aria-labelledby="thread-heading"
      ref={threadRef}
      tabIndex={-1}
    >
      <header className="conversation-header" data-tablework="ConversationHeader">
        <div>
          <p className="eyebrow">{missionName} · Mission Thread</p>
          <h2 id="thread-heading">{threadTitle}</h2>
          <p>{participantsLine}</p>
        </div>
        <span className={`state-label ${lapsed ? 'warning' : 'info'}`}>{lapsed ? 'Read-only history' : 'Anchored'}</span>
      </header>
      <div className="conversation" ref={conversationRef}>
        {hasEarlier ? (
          <button className="quiet-action" type="button" disabled={loadingEarlier} onClick={onLoadEarlier}>
            {loadingEarlier ? 'Loading earlier messages...' : 'Load earlier messages'}
          </button>
        ) : null}
        <TruthPanel state={truth} emptyLabel="No messages yet. The record starts with the first word.">
          {messages.map((message) => (
            <div key={message.messageId} style={{ display: 'contents' }}>
              {firstUnreadSeq !== null && message.seq === firstUnreadSeq ? (
                <div className="unread-divider" role="separator" aria-label="Unread messages start here">
                  <span>New</span>
                </div>
              ) : null}
              <Message message={message} supersededBy={supersededBy.get(message.messageId) ?? null} />
            </div>
          ))}
        </TruthPanel>
        {seenLine ? <p className="boundary-note" data-tablework="Receipts">{seenLine}</p> : null}
        <div ref={endRef} aria-hidden="true" />
      </div>
      {lapsed ? null : (
        <form className="compose"
          data-tablework="Composer"
          hidden={!actionsFresh}
          aria-hidden={!actionsFresh}
          onSubmit={(e) => void submit(e)}
          onFocusCapture={() => {
            composerHadFocus.current = true;
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) composerHadFocus.current = false;
          }}
        >
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
          {onPostKinded ? (
            <div className="message-actions" data-tablework="DecisionToggle">
              <label className="cell-note" style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                <input type="checkbox" checked={asDecision} onChange={(e) => setAsDecision(e.target.checked)} data-testid="as-decision" />
                Record as a DECISION (a ruling, captured where it was made)
              </label>
              {asDecision && priorDecisions.length > 0 ? (
                <select aria-label="Decision this ruling supersedes" value={supersedes} onChange={(e) => setSupersedes(e.target.value)} data-testid="supersedes-picker">
                  <option value="">Supersedes nothing</option>
                  {priorDecisions.map((d) => (
                    <option key={d.messageId} value={d.messageId}>
                      Supersedes {d.messageId}: {d.body.slice(0, 40)}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
          {/* D1 (owner-ruled) generalized into THE AUDIENCE TREATY (Phase B).
              NOTE: `data-tablework` keeps its EXACT value — it is the kit's
              component vocabulary and specs match it exactly; new state rides
              its OWN attribute (`data-treaty`) rather than widening a name
              other surfaces assert against.
              the audience line is a DERIVED truth, and an unverified audience
              disables Send — the failure case is safe at the exact moment a
              disclosure boundary is crossed. */}
          <p className="boundary-note" data-tablework="VisibilityWarning" data-treaty={audienceTreaty.verified ? 'verified' : 'unverified'}>
            {audienceTreaty.verified
              ? audienceTreaty.text
              : 'The audience could not be verified — Send is disabled rather than guessing who would read this.'}
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
                  if (file && !posting && actionsFresh) void onAttach(file);
                  e.target.value = '';
                }}
              />
              <button className="mini-action" type="button" disabled={posting || !actionsFresh} onClick={() => fileRef.current?.click()}>
                Attach to conversation
              </button>
            </div>
            <button
              className="primary-action"
              type="submit"
              disabled={posting || draft.trim().length === 0 || !actionsFresh || !audienceTreaty.verified}
            >
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
