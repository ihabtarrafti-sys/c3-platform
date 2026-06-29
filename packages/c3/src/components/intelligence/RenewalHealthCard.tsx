import { Card, CardHeader, Text } from '@fluentui/react-components';
import type { ContractKpis } from '@c3/intelligence/contractKpis';

interface RenewalHealthCardProps {
  kpis: ContractKpis;
}

export const RenewalHealthCard = ({ kpis }: RenewalHealthCardProps) => {
  return (
    <Card>
      <CardHeader
        header={
          <div>
            <Text weight="semibold" size={500}>
              Renewal Health
            </Text>
            <br />
            <Text size={300}>Operational renewal workload.</Text>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, padding: '0 16px 16px' }}>
        <MiniMetric label="Needs Attention" value={kpis.needsAttention} />
        <MiniMetric label="Critical ≤30d" value={kpis.criticalRenewals} />
        <MiniMetric label="Renewal Window" value={kpis.renewalWindow} />
        <MiniMetric label="Active Contracts" value={kpis.activeContracts} />
      </div>
    </Card>
  );
};

const MiniMetric = ({ label, value }: { label: string; value: number }) => (
  <div style={{ padding: 12, border: '1px solid #E5E7EB', borderRadius: 8 }}>
    <Text size={200}>{label}</Text>
    <br />
    <Text weight="semibold" size={500}>
      {value}
    </Text>
  </div>
);