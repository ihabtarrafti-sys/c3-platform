/**
 * PageHeader — C3 Design System v1.0
 *
 * The standardized top section for every screen in C3.
 * Replaces the ad-hoc title+subtitle divs that every screen currently
 * renders independently (with varying sizes, gaps, and padding).
 *
 * Provides:
 *   - h1-level title with consistent typography
 *   - Optional subtitle / description line
 *   - Optional breadcrumb (for sub-screens like ContractProfile)
 *   - Optional right-aligned actions slot
 *   - Data freshness timestamp (shown when `lastUpdated` is provided)
 *
 * Layer: UI (components/ui) — no domain types, no hooks, no services.
 */

import { type ReactNode } from 'react';
import { Button, Text } from '@fluentui/react-components';

export interface BreadcrumbItem {
  label: string;
  onClick: () => void;
}

export interface PageHeaderProps {
  /** Screen title — rendered at h1 semantic weight. */
  title: string;
  /** One-line description of the screen's purpose. */
  subtitle?: string;
  /**
   * Breadcrumb trail for sub-screens (e.g. ContractProfile).
   * Renders as "Contracts › GKY-001" above the title.
   */
  breadcrumb?: BreadcrumbItem[];
  /** Right-aligned slot for primary and secondary actions. */
  actions?: ReactNode;
  /**
   * ISO date-time string — when provided, renders a "Last updated" timestamp
   * in the top-right. Helps executives verify data freshness.
   */
  lastUpdated?: string;
}

const formatRelativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
};

export const PageHeader = ({
  title,
  subtitle,
  breadcrumb,
  actions,
  lastUpdated,
}: PageHeaderProps) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--c3-space-4)',
        marginBottom: 'var(--c3-space-6)',
      }}
    >
      {/* Left — breadcrumb + title + subtitle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-1)', minWidth: 0 }}>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--c3-space-2)',
              marginBottom: 'var(--c3-space-2)',
            }}
          >
            {breadcrumb.map((item, index) => (
              <span
                key={index}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)' }}
              >
                <Button
                  appearance="subtle"
                  size="small"
                  onClick={item.onClick}
                  style={{ padding: '0 var(--c3-space-1)', minWidth: 0, height: 'auto' }}
                >
                  <Text size={300} style={{ color: 'var(--c3-brand-80)' }}>
                    {item.label}
                  </Text>
                </Button>
                {index < breadcrumb.length - 1 && (
                  <Text size={300} style={{ color: 'var(--c3-gray-400)' }}>›</Text>
                )}
              </span>
            ))}
          </nav>
        )}

        <Text
          as="h1"
          weight="semibold"
          size={800}
          style={{ color: 'var(--c3-gray-950)', margin: 0 }}
        >
          {title}
        </Text>

        {subtitle && (
          <Text
            size={300}
            style={{ color: 'var(--c3-gray-500)', marginTop: 'var(--c3-space-1)' }}
          >
            {subtitle}
          </Text>
        )}
      </div>

      {/* Right — actions + optional timestamp */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 'var(--c3-space-2)',
          flexShrink: 0,
        }}
      >
        {actions && (
          <div style={{ display: 'flex', gap: 'var(--c3-space-2)', alignItems: 'center' }}>
            {actions}
          </div>
        )}
        {lastUpdated && (
          <Text
            size={200}
            style={{ color: 'var(--c3-gray-400)' }}
            title={new Date(lastUpdated).toLocaleString()}
          >
            Updated {formatRelativeTime(lastUpdated)}
          </Text>
        )}
      </div>
    </div>
  );
};
