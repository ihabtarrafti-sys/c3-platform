import { Card, CardHeader, Text } from '@fluentui/react-components';
import { BreakdownList } from './BreakdownList';
import type { BreakdownItem } from '@c3/intelligence/intelligenceMetrics';

interface WorkflowBreakdownCardProps {
  items: BreakdownItem[];
}

export const WorkflowBreakdownCard = ({ items }: WorkflowBreakdownCardProps) => {
  return (
    <Card>
      <CardHeader
        header={
          <div>
            <Text weight="semibold" size={500}>
              Contract Workflow
            </Text>
            <br />
            <Text size={300}>Distribution by contract workflow stage.</Text>
          </div>
        }
      />

      <div style={{ padding: '0 16px 16px' }}>
        <BreakdownList items={items} />
      </div>
    </Card>
  );
};