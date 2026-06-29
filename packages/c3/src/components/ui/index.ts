/**
 * C3 Design System — UI Component Layer
 *
 * Public surface for all Layer 2 UI components.
 * Import from this barrel in screens and feature components.
 *
 * Rules (from Design System v1.0, Section 9.1):
 *   - Screens may import from components/ui.
 *   - UI components must not import screens, hooks, services, or domain types.
 *   - UI components must not import SharePoint-specific code.
 *
 * Reference: docs/C3 Design System v1.0.md
 */

export { MetricCard } from './MetricCard';
export type { MetricCardProps, MetricCardVariant } from './MetricCard';

export { DataRow } from './DataRow';
export type { DataRowProps, DataRowVariant } from './DataRow';

export { PageHeader } from './PageHeader';
export type { PageHeaderProps, BreadcrumbItem } from './PageHeader';

export { SectionCard, FieldGrid, FieldTile } from './SectionCard';
export type { SectionCardProps, FieldGridProps, FieldTileProps } from './SectionCard';

export {
  SkeletonBlock,
  SkeletonLines,
  SkeletonCard,
  SkeletonMetricStrip,
  SkeletonRows,
} from './SkeletonBlock';
export type { SkeletonBlockProps, SkeletonLinesProps, SkeletonMetricStripProps, SkeletonRowsProps } from './SkeletonBlock';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps, EmptyStateVariant } from './EmptyState';

export { Panel, PanelSkeleton } from './Panel';
export type { PanelProps, PanelSkeletonProps } from './Panel';

export { ActivityTimeline } from './ActivityTimeline';
export type { ActivityTimelineProps, TimelineEntry } from './ActivityTimeline';

export { FormField } from './FormField';
export type { FormFieldProps } from './FormField';
