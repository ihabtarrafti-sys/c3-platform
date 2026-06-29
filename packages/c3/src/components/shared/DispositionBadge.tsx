import { Badge } from '@fluentui/react-components';
import type { Disposition } from '@c3/types';

interface DispositionBadgeProps {
  disposition: Disposition;
}

export const DispositionBadge = ({ disposition }: DispositionBadgeProps) => {
  if (disposition === null) {
    return (
      <Badge appearance="outline" color="subtle">
        Unset
      </Badge>
    );
  }

  const colorByDisposition: Record<
    Exclude<Disposition, null>,
    'success' | 'informative' | 'danger' | 'subtle'
  > = {
    Active: 'success',
    Renewing: 'informative',
    Terminated: 'danger',
    Archived: 'subtle',
  };

  return <Badge color={colorByDisposition[disposition]}>{disposition}</Badge>;
};
