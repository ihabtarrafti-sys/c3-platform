import { useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  makeStyles,
} from '@fluentui/react-components';

/**
 * GovernedAction (B.15) — the deliberate gate before a governed mutation
 * (submit / approve / reject / execute). The confirmation states WHAT will
 * happen and its governance property (immutable submission; approval ≠
 * execution), then a single explicit confirming action. Never Enter-through;
 * Esc / Cancel dismisses; the confirm is a distinct button.
 *
 * The trigger keeps the caller's test-id; the confirm carries `${testId}-confirm`.
 */
const useStyles = makeStyles({
  // Sprint 44 (Command Desk elevation): the confirmation surface carries a
  // Command-Black top rail, deliberate title weight, and a hairline above the
  // action row — the same language as the Situation Room cards. Style only:
  // this component fronts BOTH governed submits and direct-audited confirms,
  // so the surface makes no semantic claim; the copy does.
  surface: {
    borderTop: '3px solid var(--c3-ink-strong)',
    borderRadius: 'var(--c3-radius)',
    boxShadow: 'var(--c3-e2)',
    maxWidth: '480px',
  },
  title: { fontSize: '17px', lineHeight: '24px', fontWeight: 600, color: 'var(--c3-ink-strong)' },
  body: { display: 'flex', flexDirection: 'column', rowGap: '14px', fontSize: '14px', color: 'var(--c3-ink-muted)' },
  description: {
    fontSize: '13px',
    lineHeight: '20px',
    color: 'var(--c3-ink-muted)',
    borderLeft: '2px solid var(--c3-border-subtle)',
    paddingLeft: '12px',
  },
  actions: { borderTop: '1px solid var(--c3-border-subtle)', paddingTop: '12px', marginTop: '4px' },
});

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
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // A rejecting onConfirm keeps the dialog OPEN (the caller has already
      // surfaced the error — e.g. an inline validation message or a toast).
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog modalType="modal" open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement action="open">
        <Button appearance={triggerAppearance} disabled={triggerDisabled} data-testid={triggerTestId}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle className={s.title}>{title}</DialogTitle>
          <DialogContent>
            <div className={s.body}>
              <div className={s.description}>{description}</div>
              {extra}
            </div>
          </DialogContent>
          <DialogActions className={s.actions}>
            <DialogTrigger disableButtonEnhancement action="close">
              <Button appearance="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogTrigger>
            <Button appearance="primary" data-testid={`${triggerTestId}-confirm`} disabled={busy || confirmDisabled} onClick={confirm}>
              {busy ? 'Working…' : confirmLabel}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
