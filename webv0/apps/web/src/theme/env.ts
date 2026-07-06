/**
 * Environment badge label — staging/dev only, hidden in production (Part A.9).
 * A prod build sets VITE_ENV_LABEL='' (or 'PRODUCTION') to hide the badge; no
 * other plumbing required. Shared by the AppShell IdentityBar and the
 * pre-auth AuthScreen so the badge reads identically everywhere.
 */
export const ENV_LABEL = (
  (import.meta.env.VITE_ENV_LABEL as string | undefined) ?? (import.meta.env.DEV ? 'LOCAL' : 'STAGING')
).toUpperCase();

export const SHOW_ENV = ENV_LABEL !== '' && ENV_LABEL !== 'PRODUCTION' && ENV_LABEL !== 'PROD';
