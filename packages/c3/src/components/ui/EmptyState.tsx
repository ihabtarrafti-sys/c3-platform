/**
 * EmptyState — C3 Design System v1.0
 *
 * Standardized empty and error state presentation.
 * Replaces bare `<Text size={300}>No contracts in this stage.</Text>` patterns
 * used throughout list panels, and plain-text error divs on screen load failures.
 *
 * Variants:
 *   'empty'   — No data available (neutral, informational)
 *   'error'   — Data failed to load (critical, with optional retry)
 *   'success' — All clear / no action needed (positive confirmation)
 *
 * Design principle:
 *   Empty state is not failure — it is valid information. An empty renewal
 *   list should communicate health ("No renewal decisions pending"), not just
 *   absence ("No data."). Use the `title` and `description` props accordingly.
 *
 * Layer: UI (components/ui) — no domain types, no hooks, no services.
 */

import { type ReactNode } from 'react';
import { Text } from '@fluentui/react-components';

export type EmptyStateVariant = 'empty' | 'error' | 'success';

export interface EmptyStateProps {
  /** Short headline — should communicate the state, not just its absence. */
  title: string;
  /** Supporting detail — explains what happened or what to do next. */
  description?: string;
  /** Optional action element — typically a Button to retry or navigate. */
  action?: ReactNode;
  /**
   * Optional icon element — should be a Fluent icon at ~40px.
   * When omitted, a default glyph is rendered based on variant.
   */
  icon?: ReactNode;
  /** Visual tone. Default: 'empty'. */
  variant?: EmptyStateVariant;
  /** Compact mode — reduces padding for use inside small card panels. */
  compact?: boolean;
}

const DEFAULT_GLYPHS: Record<EmptyStateVariant, string> = {
  empty:   '○',   // Placeholder: replaced by Fluent icon in Phase 2
  error:   '⚠',
  success: '✓',
};

const VARIANT_COLOR: Record<EmptyStateVariant, string> = {
  empty:   'var(--c3-gray-400)',
  error:   'var(--c3-critical)',
  success: 'var(--c3-success)',
};

const VARIANT_BG: Record<EmptyStateVariant, string> = {
  empty:   'transparent',
  error:   'var(--c3-critical-bg)',
  success: 'var(--c3-success-bg)',
};

const VARIANT_BORDER: Record<EmptyStateVariant, string> = {
  empty:   'var(--c3-gray-200)',
  error:   'var(--c3-critical-border)',
  success: 'var(--c3-success-border)',
};

export const EmptyState = ({
  title,
  description,
  action,
  icon,
  variant = 'empty',
  compact = false,
}: EmptyStateProps) => {
  const padding = compact ? 'var(--c3-space-5)' : 'var(--c3-space-10)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding,
        gap: 'var(--c3-space-3)',
        borderRadius: 'var(--c3-radius-md)',
        background: VARIANT_BG[variant],
        border: `1px dashed ${VARIANT_BORDER[variant]}`,
      }}
    >
      {/* Icon */}
      <div
        aria-hidden="true"
        style={{
          fontSize: '32px',
          lineHeight: 1,
          color: VARIANT_COLOR[variant],
          marginBottom: 'var(--c3-space-1)',
        }}
      >
        {icon ?? DEFAULT_GLYPHS[variant]}
      </div>

      {/* Title */}
      <Text
        weight="semibold"
        size={400}
        style={{ color: 'var(--c3-gray-700)' }}
      >
        {title}
      </Text>

      {/* Description */}
      {description && (
        <Text
          size={300}
          style={{ color: 'var(--c3-gray-500)', maxWidth: '360px' }}
        >
          {description}
        </Text>
      )}

      {/* Action */}
      {action && (
        <div style={{ marginTop: 'var(--c3-space-2)' }}>
          {action}
        </div>
      )}
    </div>
  );
};
