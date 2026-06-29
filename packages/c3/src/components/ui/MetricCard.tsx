/**
 * MetricCard — C3 Design System v1.0
 *
 * The canonical KPI card used on all dashboard and list screens.
 * Variant drives the left-border accent and background tint to communicate
 * urgency at a glance without requiring the user to read the number.
 *
 * Layer: UI (components/ui) — no domain types, no hooks, no services.
 */

import { useState } from 'react';
import { Text } from '@fluentui/react-components';

export type MetricCardVariant = 'default' | 'critical' | 'warning' | 'success' | 'info';

export interface MetricCardProps {
  label: string;
  value: number | string;
  context?: string;
  variant?: MetricCardVariant;
  onClick?: () => void;
}

const VARIANT_STYLES: Record<
  MetricCardVariant,
  { borderColor: string; background: string; hoverBackground: string }
> = {
  default:  {
    borderColor:       'transparent',
    background:        'var(--c3-white)',
    hoverBackground:   'var(--c3-gray-50)',
  },
  critical: {
    borderColor:       'var(--c3-critical)',
    background:        'var(--c3-critical-bg)',
    hoverBackground:   '#fde8e8',
  },
  warning:  {
    borderColor:       'var(--c3-warning)',
    background:        'var(--c3-warning-bg)',
    hoverBackground:   '#fef3cd',
  },
  success:  {
    borderColor:       'var(--c3-success)',
    background:        'var(--c3-success-bg)',
    hoverBackground:   '#dcfce7',
  },
  info:     {
    borderColor:       'var(--c3-info)',
    background:        'var(--c3-info-bg)',
    hoverBackground:   '#e0f2fe',
  },
};

export const MetricCard = ({
  label,
  value,
  context,
  variant = 'default',
  onClick,
}: MetricCardProps) => {
  const [hovered, setHovered] = useState(false);
  const { borderColor, background, hoverBackground } = VARIANT_STYLES[variant];
  const isInteractive = Boolean(onClick);

  return (
    <div
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={
        isInteractive
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      onMouseEnter={() => isInteractive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: isInteractive && hovered ? hoverBackground : background,
        borderRadius: 'var(--c3-radius-md)',
        boxShadow: hovered ? 'var(--c3-shadow-4)' : 'var(--c3-shadow-3)',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        borderLeft: `4px solid ${borderColor}`,
        padding: 'var(--c3-space-5)',
        cursor: isInteractive ? 'pointer' : 'default',
        transition: [
          `box-shadow var(--c3-motion-fast) var(--c3-motion-ease-out)`,
          `background var(--c3-motion-fast) var(--c3-motion-ease-out)`,
          `transform var(--c3-motion-fast) var(--c3-motion-ease-out)`,
        ].join(', '),
        display: 'flex',
        flexDirection: 'column' as const,
        gap: 'var(--c3-space-2)',
        userSelect: 'none' as const,
      }}
    >
      <Text
        size={200}
        style={{ color: 'var(--c3-gray-500)', letterSpacing: '0.01em' }}
      >
        {label}
      </Text>

      <Text
        weight="semibold"
        size={800}
        style={{ color: 'var(--c3-gray-950)', lineHeight: '1' }}
      >
        {value}
      </Text>

      {context && (
        <Text
          size={200}
          style={{ color: 'var(--c3-gray-500)', marginTop: 'var(--c3-space-1)' }}
        >
          {context}
        </Text>
      )}
    </div>
  );
};
