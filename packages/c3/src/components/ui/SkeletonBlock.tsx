/**
 * SkeletonBlock — C3 Design System v1.0
 *
 * Shimmer placeholder components for loading states.
 * Uses Fluent UI's built-in Skeleton/SkeletonItem to ensure visual
 * consistency with the Fluent design system and avoid hand-rolling
 * keyframe animations.
 *
 * Exports:
 *   SkeletonBlock   — single shimmer bar (configurable width/height)
 *   SkeletonLines   — stacked text-line shimmer (for paragraph placeholders)
 *   SkeletonCard    — full MetricCard-shaped shimmer
 *   SkeletonRows    — stacked DataRow-shaped shimmers (for list panels)
 *
 * Usage:
 *   // Replace plain-text loading div:
 *   if (isLoading) return <SkeletonRows count={5} />;
 *
 *   // Replace a KPI strip:
 *   if (isLoading) return <SkeletonMetricStrip />;
 *
 * Layer: UI (components/ui) — no domain types, no hooks, no services.
 */

import { Skeleton, SkeletonItem } from '@fluentui/react-components';

// ---------------------------------------------------------------------------
// SkeletonBlock — single configurable bar
// ---------------------------------------------------------------------------

export interface SkeletonBlockProps {
  width?: string;
  height?: string;
  borderRadius?: string;
}

export const SkeletonBlock = ({
  width = '100%',
  height = '20px',
  borderRadius = 'var(--c3-radius-sm)',
}: SkeletonBlockProps) => (
  <Skeleton>
    <SkeletonItem style={{ width, height, borderRadius }} />
  </Skeleton>
);

// ---------------------------------------------------------------------------
// SkeletonLines — text-line placeholders
// ---------------------------------------------------------------------------

export interface SkeletonLinesProps {
  /** Number of lines to render. Default: 3. */
  lines?: number;
  /** Fade last line to ~60% width to simulate paragraph end. Default: true. */
  fadeLastLine?: boolean;
}

export const SkeletonLines = ({ lines = 3, fadeLastLine = true }: SkeletonLinesProps) => (
  <Skeleton>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonItem
          key={i}
          style={{
            height: '14px',
            borderRadius: 'var(--c3-radius-sm)',
            width: fadeLastLine && i === lines - 1 ? '60%' : '100%',
          }}
        />
      ))}
    </div>
  </Skeleton>
);

// ---------------------------------------------------------------------------
// SkeletonCard — MetricCard-shaped placeholder
// ---------------------------------------------------------------------------

export const SkeletonCard = () => (
  <Skeleton>
    <div
      style={{
        padding: 'var(--c3-space-4)',
        borderRadius: 'var(--c3-radius-md)',
        boxShadow: 'var(--c3-shadow-2)',
        background: 'var(--c3-white)',
        borderLeft: '4px solid var(--c3-gray-200)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-2)',
      }}
    >
      {/* Label */}
      <SkeletonItem style={{ height: '12px', width: '60%', borderRadius: 'var(--c3-radius-sm)' }} />
      {/* Value */}
      <SkeletonItem style={{ height: '32px', width: '40%', borderRadius: 'var(--c3-radius-sm)' }} />
      {/* Context */}
      <SkeletonItem style={{ height: '12px', width: '80%', borderRadius: 'var(--c3-radius-sm)' }} />
    </div>
  </Skeleton>
);

// ---------------------------------------------------------------------------
// SkeletonMetricStrip — 4 SkeletonCards in a row
// ---------------------------------------------------------------------------

export interface SkeletonMetricStripProps {
  /** Number of cards. Default: 4. */
  count?: number;
}

export const SkeletonMetricStrip = ({ count = 4 }: SkeletonMetricStripProps) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
      gap: 'var(--c3-space-3)',
    }}
  >
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// SkeletonRow — single DataRow-shaped placeholder
// ---------------------------------------------------------------------------

const SkeletonRow = () => (
  <Skeleton>
    <div
      style={{
        padding: 'var(--c3-space-3)',
        borderRadius: 'var(--c3-radius-md)',
        border: '1px solid var(--c3-gray-200)',
        borderLeft: '3px solid var(--c3-gray-200)',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 'var(--c3-space-3)',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
        <SkeletonItem style={{ height: '14px', width: '40%', borderRadius: 'var(--c3-radius-sm)' }} />
        <SkeletonItem style={{ height: '12px', width: '65%', borderRadius: 'var(--c3-radius-sm)' }} />
      </div>
      <SkeletonItem style={{ height: '22px', width: '56px', borderRadius: 'var(--c3-radius-sm)' }} />
    </div>
  </Skeleton>
);

// ---------------------------------------------------------------------------
// SkeletonRows — stacked list placeholder
// ---------------------------------------------------------------------------

export interface SkeletonRowsProps {
  /** Number of row shimmers. Default: 5. */
  count?: number;
}

export const SkeletonRows = ({ count = 5 }: SkeletonRowsProps) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonRow key={i} />
    ))}
  </div>
);
