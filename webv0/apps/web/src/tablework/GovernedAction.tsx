/**
 * GovernedAction.tsx — the deliberate gate before a governed mutation
 * (pivot W0-2; Fluent B.15 API-identical so pages port mechanically).
 *
 * The confirmation states WHAT will happen and its governance property
 * (immutable submission; approval ≠ execution), then a single explicit
 * confirming action. Never Enter-through; Esc/Cancel dismisses; the confirm
 * is a distinct button. The trigger keeps the caller's test-id; the confirm
 * carries `${testId}-confirm`. A rejecting onConfirm keeps the dialog OPEN
 * (the caller has already surfaced the error). The decision moment is
 * ephemeral — it rides FloatSurface (glass, fallback-first).
 */
import { useState, type ReactNode } from 'react';
import { FloatSurface } from './materials';

export function GovernedAction({
  triggerLabel,
  triggerTestId,
  triggerAppearance = 'primary',
  triggerDisabled = false,
  title,
  description,
  extra,
  confirmLabel,
  confirmDisabled = false,
  onConfirm,
}: {
  triggerLabel: string;
  triggerTestId: string;
  triggerAppearance?: 'primary' | 'secondary';
  triggerDisabled?: boolean;
  title: string;
  description: ReactNode;
  /** Optional in-dialog content, e.g. a reason field for reject. */
  extra?: ReactNode;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleId = `governed-${triggerTestId}`;

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // A rejecting onConfirm keeps the dialog OPEN (the caller has already
      // surfaced the error — e.g. an inline validation message or a notice).
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className={triggerAppearance === 'primary' ? 'primary-action' : 'secondary-action'}
        type="button"
        disabled={triggerDisabled}
        data-testid={triggerTestId}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </button>
      <FloatSurface open={open} onClose={() => setOpen(false)} labelledBy={titleId}>
        <div className="float-header">
          <div>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
        </div>
        <div className="float-body">
          <div className="governed-description">{description}</div>
          {extra ? <div className="governed-extra">{extra}</div> : null}
          <div className="panel-actions">
            <button className="secondary-action" type="button" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary-action" type="button" data-testid={`${triggerTestId}-confirm`} disabled={busy || confirmDisabled} onClick={() => void confirm()}>
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </FloatSurface>
    </>
  );
}
