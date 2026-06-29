import { Card, Text } from '@fluentui/react-components';
import type { ContractKpis } from '@c3/intelligence/contractKpis';

interface ExecutiveKpiStripProps {
  kpis: ContractKpis;
}

export const ExecutiveKpiStrip = ({ kpis }: ExecutiveKpiStripProps) => {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
      <KpiCard label="Total Contracts" value={kpis.totalContracts} />
      <KpiCard label="Active Contracts" value={kpis.activeContracts} />
      <KpiCard label="Renewal Exposure" value={kpis.renewalWindow} />
      <KpiCard label="Amendments" value={kpis.totalAmendments} />
    </div>
  );
};

const KpiCard = ({ label, value }: { label: string; value: number }) => (
  <Card>
    <Text size={200}>{label}</Text>
    <Text weight="semibold" size={700}>
      {value}
    </Text>
  </Card>
);