import { Text } from '@fluentui/react-components';
import type { BreakdownItem } from '@c3/intelligence/intelligenceMetrics';

interface BreakdownListProps {
  items: BreakdownItem[];
}

export const BreakdownList = ({ items }: BreakdownListProps) => {
  if (items.length === 0) {
    return <Text size={300}>No data available.</Text>;
  }

  const max = Math.max(...items.map(item => item.value), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(item => {
        const width = `${Math.max((item.value / max) * 100, 6)}%`;

        return (
          <div key={item.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text size={300}>{item.label}</Text>
              <Text size={300} weight="semibold">
                {item.value}
              </Text>
            </div>

            <div style={{ height: 8, borderRadius: 999, background: '#E5E7EB' }}>
              <div
                style={{
                  width,
                  height: 8,
                  borderRadius: 999,
                  background: 'var(--c3-accent)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};