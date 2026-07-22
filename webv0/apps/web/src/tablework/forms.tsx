/**
 * forms.tsx — the Tablework forms family (pivot W0-2; Aura contract 04).
 *
 * Field: persistent label + the required/optional WORD (never an asterisk) +
 * linked help/format note + field error — all associated via aria-describedby
 * on the ONE native control child. Server validation is authoritative; on a
 * recoverable failure the caller retains input (the pilot's attestation law,
 * generalized — nothing here ever clears a field).
 *
 * FormDrawer: the composer sheet, API-identical to the Fluent FormDrawer so
 * pages port mechanically (open/onClose/eyebrow/mode/intro/children/footer;
 * the taxonomy chip words and the form-drawer-close testid byte-identical;
 * dirty-guard: field state lives in the CALLER — closing hides, reopening
 * restores; nothing is discarded until submit clears it). MATERIAL DECISION
 * (recorded for Aura): a composer holding retained user input is WORK
 * material in a modal frame — Dawn's ceremony panels put composers on
 * work-surface raised; Float glass stays for menus/toasts/confirms.
 */
import { cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';

interface FieldProps {
  label: string;
  /** Renders the quiet 'required' word after the label (contract 04). */
  required?: boolean;
  /** The format/source note under the control. */
  hint?: ReactNode;
  /** The field error (server-authoritative); announced, never clearing input. */
  error?: ReactNode;
  /** Exactly one native control (Input/Select/Textarea/DateInput). */
  children: ReactElement;
}

export function Field({ label, required, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children;
  return (
    <div className="tw-field" data-tablework="Field">
      <label htmlFor={id}>
        <span>
          {label}
          {required ? <em className="field-required"> required</em> : null}
        </span>
      </label>
      {control}
      {hint ? (
        <small className="field-hint" id={hintId}>
          {hint}
        </small>
      ) : null}
      {error ? (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}

/* Thin native controls — tablework.css styles them under .tw-root; these exist
 * so converted pages read like the contract, not like raw HTML. */
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} />;
}

export function DateInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="date" {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}

interface FormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Uppercase taxonomy line, e.g. "New agreement" or "Add person". */
  eyebrow: string;
  /** governed = approval-gated; direct = immediate-but-audited. */
  mode: 'governed' | 'direct';
  /** The honest-copy line (kept verbatim from the certified surfaces). */
  intro: ReactNode;
  children: ReactNode;
  /** The submit control(s) — typically the GovernedAction trigger. */
  footer: ReactNode;
}

export function FormDrawer({ open, onClose, eyebrow, mode, intro, children, footer }: FormDrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="form-sheet work-surface elevated"
      data-tablework="FormDrawer"
      data-material="work"
      aria-label={eyebrow}
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="form-sheet-frame">
        <div className={`form-sheet-rail ${mode}`} aria-hidden="true" />
        <header className="form-sheet-head">
          <span className="eyebrow">{eyebrow}</span>
          <span className="form-sheet-chip">{mode === 'governed' ? 'Governed request' : 'Immediate · recorded'}</span>
          <button className="icon-button" type="button" aria-label="Close panel" data-testid="form-drawer-close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="form-sheet-body">
          <p className="form-sheet-intro">{intro}</p>
          <div className="form-sheet-fields">{children}</div>
        </div>
        <footer className="form-sheet-foot">{footer}</footer>
      </div>
    </dialog>
  );
}
