import { Card, CardHeader, Text } from '@fluentui/react-components';
import { BreakdownList } from './BreakdownList';
import type { BreakdownItem } from '@c3/intelligence/intelligenceMetrics';

interface AmendmentHealthCardProps {
  items: BreakdownItem[];
}

export const AmendmentHealthCard = ({ items }: AmendmentHealthCardProps) => {
  return (
    <Card>
      <CardHeader
        header={
          <div>
            <Text weight="semibold" size={500}>
              Amendment Activity
            </Text>
            <br />
            <Text size={300}>Distribution by amendment status.</Text>
          </div>
        }
      />

      <div style={{ padding: '0 16px 16px' }}>
        <BreakdownList items={items} />
      </div>
    </Card>
  );
};