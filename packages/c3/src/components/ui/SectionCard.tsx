/**
 * SectionCard — C3 Design System v1.0
 *
 * A lightweight section container used inside profile screens.
 * Provides a titled section with an optional action, without creating
 * the double-card nesting that currently exists in ContractProfile
 * (Card > CardHeader + Section > Card + CardHeader + Field grid).
 *
 * SectionCard is NOT a Fluent Card — it is a div-based container that
 * groups a section title with its content. It is designed to live inside
 * an outer Card (or standalone on a page) with consistent padding.
 *
 * Usage:
 *   <SectionCard title="Contract Details" action={<Button>Edit</Button>}>
 *     <FieldGrid>...</FieldGrid>
 *   </SectionCard>
 *
 * Layer: UI (components/ui) — no domain types, no hooks, no services.
 */

import { type ReactNode } from 'react';
import { Text } from '@fluentui/react-components';

export interface SectionCardProps {
  /** Section heading — rendered at h3 semantic level. */
  title: string;
  /** Optional right-aligned action (e.g. an Edit button or navigation link). */
  action?: ReactNode;
  /** Section body content. */
  children: ReactNode;
}

export const SectionCard = ({ title, action, children }: SectionCardProps) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-4)',
        padding: 'var(--c3-space-5)',
        background: 'var(--c3-white)',
        borderRadius: 'var(--c3-radius-md)',
        boxShadow: 'var(--c3-shadow-1)',
        border: `1px solid var(--c3-gray-200)`,
      }}
    >
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--c3-space-4)',
        }}
      >
        <Text
          as="h3"
          weight="semibold"
          size={500}
          style={{ color: 'var(--c3-gray-800)', margin: 0 }}
        >
          {title}
        </Text>

        {action && <div>{action}</div>}
      </div>

      {/* Divider */}
      <div
        style={{
          height: 1,
          background: 'var(--c3-gray-100)',
          margin: '0 calc(-1 * var(--c3-space-5))',
        }}
      />

      {/* Content */}
      <div>{children}</div>
    </div>
  );
};

/**
 * FieldGrid — companion layout component for SectionCard.
 *
 * Renders its children in a responsive grid. Use inside SectionCard
 * to display key/value field tiles (replaces the manual grid in ContractProfile).
 *
 * Default: 4 columns at ≥1280px, 2 columns at 1024px.
 */
export interface FieldGridProps {
  children: ReactNode;
  /** Number of columns at the standard breakpoint (1280px+). Default: 4. */
  columns?: 2 | 3 | 4;
}

export const FieldGrid = ({ children, columns = 4 }: FieldGridProps) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 'var(--c3-space-3)',
      }}
    >
      {children}
    </div>
  );
};

/**
 * FieldTile — a single key/value tile used inside FieldGrid.
 *
 * Replaces the dual InfoTile/Field components in ContractProfile that were
 * functionally identical but defined separately. Handles null/undefined
 * gracefully by rendering "Not specified" instead of raw null or undefined.
 */
export interface FieldTileProps {
  /** Field label — rendered in caption weight. */
  label: string;
  /** Field value — string, number, ReactNode, or nullish. */
  value?: ReactNode;
  /** When true, renders the value in monospace (for IDs, codes, etc.). */
  mono?: boolean;
}

export const FieldTile = ({ label, value, mono = false }: FieldTileProps) => {
  const displayValue =
    value === null || value === undefined || value === ''
      ? 'Not specified'
      : value;

  const isPlaceholder =
    value === null || value === undefined || value === '';

  return (
    <div
      style={{
        padding: 'var(--c3-space-3)',
        background: 'var(--c3-gray-50)',
        borderRadius: 'var(--c3-radius-sm)',
        border: `1px solid var(--c3-gray-200)`,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-1)',
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
        style={{
          fontFamily: mono ? 'monospace' : undefined,
          color: isPlaceholder ? 'var(--c3-gray-400)' : 'var(--c3-gray-950)',
          fontStyle: isPlaceholder ? 'italic' : undefined,
          wordBreak: 'break-word' as const,
        }}
      >
        {displayValue}
      </Text>
    </div>
  );
};
