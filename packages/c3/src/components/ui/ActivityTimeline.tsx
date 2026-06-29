/**
 * ActivityTimeline — C3 Design System v1.0
 *
 * Generic vertical timeline for rendering ordered event histories.
 * Accepts a plain `TimelineEntry[]` — no domain types, no hooks, no services.
 *
 * Callers are responsible for mapping domain objects (Activity, Amendment, etc.)
 * to TimelineEntry before passing them in. This keeps the component reusable
 * across Contract activity, Person history, and future Intelligence Hub timelines.
 *
 * Features:
 *   - Dot + vertical connector layout
 *   - Relative timestamps for recent events, absolute dates for older ones
 *   - Optional actor and detail lines per entry
 *   - Graceful handling of single-entry lists (no trailing connector)
 *
 * Empty state: not handled internally. The caller should check entries.length
 * and render EmptyState before passing a non-empty list to this component.
 *
 * Layer: UI (components/ui) — no domain types, no hooks, no services.
 */

import { Text } from '@fluentui/react-components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  /** Stable key for React reconciliation. */
  id: string | number;
  /** Primary event label — e.g. "Stage changed", "Amendment added". */
  label: string;
  /** Who performed the action. */
  actor?: string;
  /** ISO 8601 date-time string. */
  timestamp: string;
  /** Supporting detail — e.g. "Draft → In Review", a note, or a reason. */
  detail?: string;
}

export interface ActivityTimelineProps {
  /**
   * Ordered list of timeline entries. Rendered top-to-bottom as provided.
   * Sort before passing in (newest-first or oldest-first per context).
   * Must be non-empty — render EmptyState externally when the list is empty.
   */
  entries: TimelineEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dot diameter in px. */
const DOT_SIZE = 10;

/**
 * Format an ISO timestamp for display.
 * Recent events use relative language; older events show a short absolute date.
 */
const formatTimestamp = (iso: string): string => {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ActivityTimeline = ({ entries }: ActivityTimelineProps) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    {entries.map((entry, i) => {
      const isLast = i === entries.length - 1;

      return (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            gap: 'var(--c3-space-3)',
            alignItems: 'flex-start',
          }}
        >
          {/* Left column — dot + vertical connector */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flexShrink: 0,
              paddingTop: '3px', // aligns dot center with first text line
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: DOT_SIZE,
                height: DOT_SIZE,
                borderRadius: 'var(--c3-radius-full)',
                background: 'var(--c3-brand-80)',
                flexShrink: 0,
              }}
            />
            {!isLast && (
              <div
                aria-hidden="true"
                style={{
                  width: '1px',
                  flex: '1 1 0',
                  minHeight: 'var(--c3-space-8)',
                  background: 'var(--c3-gray-200)',
                  marginTop: 'var(--c3-space-1)',
                }}
              />
            )}
          </div>

          {/* Right column — content */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              paddingBottom: isLast ? 'var(--c3-space-1)' : 'var(--c3-space-5)',
            }}
          >
            {/* Label + timestamp row */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 'var(--c3-space-3)',
              }}
            >
              <Text
                weight="semibold"
                size={300}
                style={{
                  color: 'var(--c3-gray-950)',
                  display: 'block',
                }}
              >
                {entry.label}
              </Text>
              <Text
                size={200}
                style={{
                  color: 'var(--c3-gray-400)',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
                title={new Date(entry.timestamp).toLocaleString()}
              >
                {formatTimestamp(entry.timestamp)}
              </Text>
            </div>

            {/* Actor */}
            {entry.actor && (
              <Text
                size={200}
                style={{
                  color: 'var(--c3-gray-500)',
                  display: 'block',
                  marginTop: 'var(--c3-space-1)',
                }}
              >
                {entry.actor}
              </Text>
            )}

            {/* Detail */}
            {entry.detail && (
              <Text
                size={200}
                style={{
                  color: 'var(--c3-gray-500)',
                  display: 'block',
                  marginTop: 'var(--c3-space-1)',
                  fontStyle: 'italic',
                }}
              >
                {entry.detail}
              </Text>
            )}
          </div>
        </div>
      );
    })}
  </div>
);
