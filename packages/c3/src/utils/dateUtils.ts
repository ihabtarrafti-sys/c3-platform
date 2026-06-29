const normalizeToMidnight = (isoStr: string): Date => {
  const datePart = isoStr.split('T')[0];
  return new Date(datePart + 'T00:00:00Z');
};

export const computeDaysToExpiry = (endDate: string): number => {
  const today = normalizeToMidnight(new Date().toISOString());
  const end = normalizeToMidnight(endDate);
  return Math.floor((end.getTime() - today.getTime()) / (86_400 * 1000));
};