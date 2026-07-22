/**
 * materials.tsx — the three Tablework materials (v1.3.0 contract).
 *
 * Room: the opaque canvas a screen's content sits on (one per route).
 * WorkSurface: opaque working panels in four tiers (base|subtle|elevated|raised).
 * FloatSurface: the ONLY glass — an ephemeral <dialog>, fallback-first; the
 *   native dialog gives focus trap + Escape + focus-return for free.
 *
 * The `data-tablework` / `data-material` attributes are the contract's
 * component decomposition, kept in the DOM as stable e2e/test hooks.
 */
import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';

export function Room({ wide, children, ...rest }: { wide?: boolean; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  // The canvas-width law (AppShell's WIDE_ROUTES, carried per-screen): register
  // pages get command width; reading surfaces keep the calm centred measure.
  return (
    <main {...rest} className={wide ? 'room wide' : 'room'} id="tw-room" data-tablework="Room" data-material="room" tabIndex={-1}>
      {children}
    </main>
  );
}

export type WorkTier = 'base' | 'subtle' | 'elevated' | 'raised';

interface WorkSurfaceProps extends HTMLAttributes<HTMLElement> {
  /** Opaque tier — never glass (material law). */
  tier?: WorkTier;
  /** Semantic element to render (section by default). */
  as?: 'section' | 'aside' | 'nav' | 'header' | 'div' | 'article';
  /** Extra data-tablework families this surface embodies (appended after WorkSurface). */
  tablework?: string;
  children: ReactNode;
}

export function WorkSurface({ tier = 'base', as: Tag = 'section', tablework, className, children, ...rest }: WorkSurfaceProps) {
  const tierClass = tier === 'base' ? '' : ` ${tier}`;
  return (
    <Tag
      {...rest}
      className={`work-surface${tierClass}${className ? ` ${className}` : ''}`}
      data-tablework={tablework ? `${tablework} WorkSurface` : 'WorkSurface'}
      data-material="work"
    >
      {children}
    </Tag>
  );
}

interface FloatSurfaceProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
}

/**
 * Modal Float. Opening moves focus into the dialog; closing returns it to the
 * opener (native <dialog> semantics). Glass upgrade + reduced-effects collapse
 * live entirely in tablework.css.
 */
export function FloatSurface({ open, onClose, labelledBy, children }: FloatSurfaceProps) {
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
      className="float-surface"
      data-tablework="FloatSurface"
      data-material="float"
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={onClose}
    >
      {children}
    </dialog>
  );
}
