import { Card, CardHeader, Text } from '@fluentui/react-components';
import { BreakdownList } from './BreakdownList';
import type { BreakdownItem } from '@c3/intelligence/intelligenceMetrics';

interface PortfolioBreakdownCardProps {
  title: string;
  items: BreakdownItem[];
}

export const PortfolioBreakdownCard = ({ title, items }: PortfolioBreakdownCardProps) => {
  return (
    <Card>
      <CardHeader
        header={
          <div>
            <Text weight="semibold" size={500}>
              {title}
            </Text>
            <br />
            <Text size={300}>Portfolio composition breakdown.</Text>
          </div>
        }
      />

      <div style={{ padding: '0 16px 16px' }}>
        <BreakdownList items={items} />
      </div>
    </Card>
  );
};