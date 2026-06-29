/**
 * DataRow — C3 Design System v1.0
 *
 * The canonical interactive row used in list and dashboard panels.
 * Features hover state, urgency variant (left border accent), and full
 * keyboard accessibility.
 *
 * Layer: UI (components/ui) — no domain types, no hooks, no services.
 */

import { useState, type ReactNode } from 'react';
import { Text } from '@fluentui/react-components';

export type DataRowVariant = 'default' | 'critical' | 'warning';

export interface DataRowProps {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  variant?: DataRowVariant;
  action?: ReactNode;
  onClick?: () => void;
  mono?: boolean;
  ariaLabel?: string;
}

const VARIANT_BORDER: Record<DataRowVariant, string> = {
  default:  'var(--c3-gray-200)',
  critical: 'var(--c3-critical)',
  warning:  'var(--c3-warning)',
};

const VARIANT_HOVER_BG: Record<DataRowVariant, string> = {
  default:  'var(--c3-gray-50)',
  critical: 'var(--c3-critical-bg)',
  warning:  'var(--c3-warning-bg)',
};

export const DataRow = ({
  title,
  subtitle,
  right,
  action,
  variant = 'default',
  onClick,
  mono = true,
  ariaLabel,
}: DataRowProps) => {
  const [hovered, setHovered] = useState(false);
  const interactive = onClick !== undefined;

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? (ariaLabel ?? title) : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? (e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick!();
        }
      }) : undefined}
      onMouseEnter={interactive ? () => setHovered(true) : undefined}
      onMouseLeave={interactive ? () => setHovered(false) : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 'var(--c3-space-3)',
        padding: 'var(--c3-space-3)',
        borderRadius: 'var(--c3-radius-md)',
        border: `1px solid ${interactive && hovered ? VARIANT_BORDER[variant] : 'var(--c3-gray-200)'}`,
        borderLeft: `3px solid ${VARIANT_BORDER[variant]}`,
        background: interactive && hovered ? VARIANT_HOVER_BG[variant] : 'var(--c3-white)',
        cursor: interactive ? 'pointer' : 'default',
        transition: interactive ? [
          `background var(--c3-motion-fast) var(--c3-motion-ease-out)`,
          `border-color var(--c3-motion-fast) var(--c3-motion-ease-out)`,
          `box-shadow var(--c3-motion-fast) var(--c3-motion-ease-out)`,
        ].join(', ') : undefined,
        boxShadow: interactive && hovered ? 'var(--c3-shadow-1)' : 'none',
        userSelect: interactive ? ('none' as const) : undefined,
        outline: 'none',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Text
          weight="semibold"
          style={{
            fontFamily: mono ? 'monospace' : 'inherit',
            color: 'var(--c3-gray-950)',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Text>

        {subtitle && (
          <Text
            size={300}
            style={{
              color: 'var(--c3-gray-500)',
              display: 'block',
              marginTop: 'var(--c3-space-1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </Text>
        )}
      </div>

      {(right || action) && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)' }}>
          {right}
          {action}
        </div>
      )}
    </div>
  );
};
