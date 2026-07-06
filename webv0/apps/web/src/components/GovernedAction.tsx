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
  body: { display: 'flex', flexDirection: 'column', rowGap: '14px', fontSize: '14px', color: 'var(--c3-ink-70)' },
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
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <div className={s.body}>
              <div>{description}</div>
              {extra}
            </div>
          </DialogContent>
          <DialogActions>
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
