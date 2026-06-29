import { Badge } from '@fluentui/react-components';
import type { ContractStage } from '@c3/types';

interface StageBadgeProps {
  stage: ContractStage;
}

export const StageBadge = ({ stage }: StageBadgeProps) => {
  const colorByStage: Record<
    ContractStage,
    'success' | 'informative' | 'warning' | 'subtle'
  > = {
    Draft: 'subtle',
    'In Review': 'informative',
    'Pending Approval': 'warning',
    'Pending Signature': 'informative',
    Signed: 'success',
  };

  return <Badge color={colorByStage[stage]}>{stage}</Badge>;
};