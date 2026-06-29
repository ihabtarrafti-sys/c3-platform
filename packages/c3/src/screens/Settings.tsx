import { EmptyState, PageHeader } from '@c3/components/ui';

export const Settings = () => (
  <div
    style={{
      padding: 'var(--c3-space-8)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--c3-space-6)',
    }}
  >
    <PageHeader
      title="Settings"
      subtitle="Application configuration and preferences."
    />

    <EmptyState
      title="Settings coming soon"
      description="Configuration options will be available in a future release."
    />
  </div>
);
