import { Badge } from '@fluentui/react-components';
import type { OpsStatus } from '@c3/types';

interface OpsStatusBadgeProps {
  status: OpsStatus;
}

const COLOR_BY_STATUS: Record<OpsStatus, 'success' | 'warning' | 'danger'> = {
  Active:     'success',
  Expiring30: 'warning',
  Expiring7:  'danger',
  Expired:    'danger',
};

// Maps internal domain values to user-facing labels.
// Domain type OpsStatus is intentionally preserved unchanged.
const LABEL_BY_STATUS: Record<OpsStatus, string> = {
  Active:     'Active',
  Expiring30: 'Expiring 30d',
  Expiring7:  'Expiring 7d',
  Expired:    'Expired',
};

export const OpsStatusBadge = ({ status }: OpsStatusBadgeProps) => (
  <Badge color={COLOR_BY_STATUS[status]}>{LABEL_BY_STATUS[status]}</Badge>
);
