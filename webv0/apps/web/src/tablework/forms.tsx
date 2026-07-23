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
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

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

/** Checkbox under the Fluent use-site contract (label/checked/disabled/
 *  onChange(boolean)/testid) so ports are one-line. Pre-landed for Wave 2's
 *  reachable boolean fields (departures, distributions); the corrections
 *  boolean branch itself is dead code today (Neural's census). */
export function Checkbox({
  label,
  checked,
  disabled,
  onChange,
  'data-testid': testId,
}: {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  'data-testid'?: string;
}) {
  return (
    <label className="tw-checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>{label}</span>
    </label>
  );
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

export interface SelectorOption {
  value: string;
  label: string;
}

/**
 * Selector (contract 04) — an in-page listbox the e2e oracle can see: the
 * trigger opens a popup whose role="option" rows are REAL page elements
 * (native <select> pickers are OS-level and invisible to the suite), Escape
 * closes and returns focus, arrows move the active option, Enter selects.
 */
export function Selector({
  value,
  display,
  placeholder,
  options,
  onSelect,
  'data-testid': testId,
  ...rest
}: {
  value: string;
  /** The trigger text when a value is chosen (defaults to the option's label). */
  display?: string;
  placeholder?: string;
  options: SelectorOption[];
  onSelect: (value: string, label: string) => void;
  'data-testid'?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (opt: SelectorOption) => {
    setOpen(false);
    onSelect(opt.value, opt.label);
    triggerRef.current?.focus();
  };

  const selected = options.find((o) => o.value === value);
  const label = display ?? selected?.label ?? placeholder ?? '';

  return (
    <div className="selector" ref={rootRef} {...rest}>
      <button
        ref={triggerRef}
        type="button"
        className="selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            // Consume the key ENTIRELY: preventDefault suppresses the native
            // <dialog> cancel — Escape here closes the POPUP, not the sheet
            // the selector sits in. (A synthetic keydown never exercises the
            // UA cancel path; the e2e suite's real keypress does.)
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
          if ((e.key === 'ArrowDown' || e.key === 'Enter') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={selected ? undefined : 'selector-placeholder'}>{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          className="selector-float"
          role="listbox"
          id={listId}
          aria-activedescendant={`${listId}-${active}`}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              triggerRef.current?.focus();
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const opt = options[active];
              if (opt) choose(opt);
            }
          }}
        >
          {options.map((opt, i) => (
            <div
              key={opt.value || '∅'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={opt.value === value}
              className={i === active ? 'selector-option active' : 'selector-option'}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(opt)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
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
  // The closed sheet UNMOUNTS (Fluent OverlayDrawer parity — specs assert
  // absent fields by count). Deterministic lifecycle: rendered only while
  // open; showModal() on mount; close() in the unmount CLEANUP (cleanups run
  // before node removal — the native focus-return happens first). The
  // dirty-guard is untouched: field state lives in the CALLER, so reopening
  // restores exactly what was typed.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Explicit focus-return (same law as FloatSurface): the opener is
    // captured at open time and focused on teardown — passive cleanups run
    // after detachment, so the native close() restore can't be relied on.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className="form-sheet work-surface elevated"
      data-tablework="FormDrawer"
      data-material="work"
      aria-label={eyebrow}
      onClose={onClose}
      onCancel={(e) => {
        // Same law as FloatSurface: suppress the UA close so the unmount
        // cleanup's close() (node still attached) carries the focus-return.
        e.preventDefault();
        onClose();
      }}
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
