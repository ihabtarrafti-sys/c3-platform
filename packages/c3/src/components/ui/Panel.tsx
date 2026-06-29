/**
 * Panel — C3 Design System v1.0
 *
 * Standard elevated section container used on all C3 dashboard and inbox screens.
 * Provides a titled panel with optional subtitle and action slot, a 1px header
 * divider, and consistent inner body padding.
 *
 * NOT the same as RegisterPanel (which has no inner padding, used in list/table
 * screens so filter bars and tables are full-bleed). RegisterPanel is a local
 * component defined inside each register screen.
 *
 * PanelSkeleton matches the visual footprint for use in loading states.
 *
 * Layer: UI (components/ui) — no domain types, no hooks, no services.
 */

import { type ReactNode } from 'react';
import { Text } from '@fluentui/react-components';
import { SkeletonRows } from './SkeletonBlock';

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface PanelProps {
  /** Panel heading — rendered at size(500) semibold. */
  title: string;
  /** One-line subtitle below the heading. */
  subtitle: string;
  /** Right-aligned slot in the header — typically a count badge or action button. */
  action?: ReactNode;
  /** Panel body content. */
  children: ReactNode;
}

export const Panel = ({ title, subtitle, action, children }: PanelProps) => (
  <div
    style={{
      backgroundColor: 'var(--c3-white)',
      borderRadius: 'var(--c3-radius-lg)',
      boxShadow: 'var(--c3-shadow-2)',
      overflow: 'hidden',
    }}
  >
    {/* Header */}
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--c3-space-3)',
        padding: 'var(--c3-space-4)',
        borderBottom: '1px solid var(--c3-gray-100)',
      }}
    >
      <div>
        <Text
          weight="semibold"
          size={500}
          style={{ display: 'block', color: 'var(--c3-gray-950)' }}
        >
          {title}
        </Text>
        <Text
          size={200}
          style={{ color: 'var(--c3-gray-500)', display: 'block', marginTop: 2 }}
        >
          {subtitle}
        </Text>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>

    {/* Body */}
    <div style={{ padding: 'var(--c3-space-3) var(--c3-space-4) var(--c3-space-4)' }}>
      {children}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// PanelSkeleton
// ---------------------------------------------------------------------------

export interface PanelSkeletonProps {
  /** Number of DataRow-shaped shimmer rows in the body. Default: 5. */
  rows?: number;
}

export const PanelSkeleton = ({ rows = 5 }: PanelSkeletonProps) => (
  <div
    style={{
      backgroundColor: 'var(--c3-white)',
      borderRadius: 'var(--c3-radius-lg)',
      boxShadow: 'var(--c3-shadow-2)',
      overflow: 'hidden',
    }}
  >
    {/* Header shimmer */}
    <div
      style={{
        padding: 'var(--c3-space-4)',
        borderBottom: '1px solid var(--c3-gray-100)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          height: 16,
          width: 140,
          borderRadius: 'var(--c3-radius-sm)',
          backgroundColor: 'var(--c3-gray-200)',
        }}
      />
      <div
        style={{
          height: 12,
          width: 220,
          borderRadius: 'var(--c3-radius-sm)',
          backgroundColor: 'var(--c3-gray-100)',
        }}
      />
    </div>

    {/* Body shimmer */}
    <div style={{ padding: 'var(--c3-space-3) var(--c3-space-4) var(--c3-space-4)' }}>
      <SkeletonRows count={rows} />
    </div>
  </div>
);
