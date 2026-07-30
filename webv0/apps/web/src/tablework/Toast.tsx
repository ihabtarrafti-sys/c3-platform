/**
 * Toast.tsx — Phase B-LIVE: the notice primitive (kit, tokens only).
 *
 * ⛔ THE TOAST IS A DISCLOSURE SURFACE. Its content ceiling is enforced at the
 * SERVER (the per-subscriber gate decides what is pushed at all), so this
 * component renders what arrived and never fetches, guesses, or widens.
 *
 * ⚖️ REDUCED MOTION / REDUCED EFFECTS — degrade to no EFFECTS, not to no
 * NOTICE (owner-ruled through Neural, who amended his own spec line):
 * reduced-motion is a VESTIBULAR accommodation, and silently dropping the
 * notice would make the notifier unreliable for exactly the people who
 * configured accessibility. So: no slide, no glass, no float material — the
 * notice still appears, plain and static.
 *
 * Instance 48: `data-toast` and `data-toast-kind` are the artifacts; tests
 * assert those, never the words.
 */
import { useEffect, useRef } from 'react';

export interface ToastItem {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  /** Where it came from, so the reader can act rather than hunt. */
  readonly href: string | null;
}

export function ToastStack({
  items,
  onDismiss,
  onOpen,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
  onOpen?: (item: ToastItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" data-tablework="ToastStack" role="region" aria-label="New messages">
      {items.map((t) => (
        <Toast key={t.id} item={t} onDismiss={() => onDismiss(t.id)} onOpen={onOpen ? () => onOpen(t) : undefined} />
      ))}
    </div>
  );
}

function Toast({ item, onDismiss, onOpen }: { item: ToastItem; onDismiss: () => void; onOpen?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Announce politely: a live notice must reach a screen reader without
  // stealing focus from whatever the person is doing.
  useEffect(() => {
    ref.current?.setAttribute('aria-live', 'polite');
  }, []);
  return (
    <div ref={ref} className="toast" data-toast="message" data-tablework="Toast">
      <div className="toast-copy">
        <strong>{item.title}</strong>
        {item.detail ? <p className="cell-note">{item.detail}</p> : null}
      </div>
      <div className="message-actions">
        {onOpen ? (
          <button className="mini-action" type="button" onClick={onOpen} data-toast-action="open">
            Open
          </button>
        ) : null}
        <button className="quiet-action" type="button" onClick={onDismiss} aria-label="Dismiss this notice" data-toast-action="dismiss">
          Dismiss
        </button>
      </div>
    </div>
  );
}
