export const normalizeUserEmail = (email: string | null | undefined): string => {
  return (email ?? '').toLowerCase().trim();
};