/**
 * FormField — C3 Design System v1.0
 *
 * Generic form field wrapper: label + input slot + optional hint/error line.
 * Accepts any input element as children — Input, Select, Textarea, Combobox, etc.
 *
 * Validation state is caller-controlled: pass `error` to trigger the error style.
 * The component itself does no validation — it is purely presentational.
 *
 * Layer: UI (components/ui) — no domain types, no hooks, no services.
 */

import type { ReactNode } from 'react';
import { Label, Text } from '@fluentui/react-components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormFieldProps {
  /** Field label rendered above the input. */
  label: string;
  /** Marks the field with a required indicator (*). */
  required?: boolean;
  /** Subtle hint text shown below the input when there is no error. */
  hint?: string;
  /** Error message — replaces hint and renders in --c3-critical color. */
  error?: string;
  /** Input element(s) — rendered between label and hint/error. */
  children: ReactNode;
  /** Wires the label to an input's id for accessibility. */
  htmlFor?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FormField = ({
  label,
  required,
  hint,
  error,
  children,
  htmlFor,
}: FormFieldProps) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--c3-space-1)',
    }}
  >
    <Label
      htmlFor={htmlFor}
      required={required}
      style={{
        color: 'var(--c3-gray-700)',
        fontSize: '13px',
        fontWeight: 600,
      }}
    >
      {label}
    </Label>

    {children}

    {error ? (
      <Text
        size={100}
        style={{ color: 'var(--c3-critical)', display: 'block' }}
      >
        {error}
      </Text>
    ) : hint ? (
      <Text
        size={100}
        style={{ color: 'var(--c3-gray-400)', display: 'block' }}
      >
        {hint}
      </Text>
    ) : null}
  </div>
);
