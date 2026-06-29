import { Badge } from '@fluentui/react-components';
import { computeDaysToExpiry } from '@c3/utils/dateUtils';
import { getRenewalStage } from '@c3/utils/renewalCompute';

interface DaysPillProps {
  endDate: string;
}

export const DaysPill = ({ endDate }: DaysPillProps) => {
  const days = computeDaysToExpiry(endDate);
  const stage = getRenewalStage(days);

  if (stage === 'expired') {
    return <Badge color="danger">Expired</Badge>;
  }

  const label = `in ${days} days`;

  if (stage === '7d') {
    return <Badge color="danger">{label}</Badge>;
  }

  if (stage === '14d' || stage === '30d') {
    return <Badge color="warning">{label}</Badge>;
  }

  if (stage === '60d' || stage === '90d') {
    return (
      <Badge appearance="outline" color="warning">
        {label}
      </Badge>
    );
  }

  return (
    <Badge appearance="outline" color="informative">
      {label}
    </Badge>
  );
};
