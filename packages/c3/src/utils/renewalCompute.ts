import type { RenewalStage } from '../types';

export const getRenewalStage = (days: number): RenewalStage | null => {
  if (days < 0) return 'expired';
  if (days <= 7) return '7d';
  if (days <= 14) return '14d';
  if (days <= 30) return '30d';
  if (days <= 60) return '60d';
  if (days <= 90) return '90d';
  return null;
};