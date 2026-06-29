import { useMemo } from 'react';

import { usePersonCredentials } from '@c3/hooks/usePersonCredentials';
import type { ObligationEvaluation, ProtocolContext, ProtocolFn } from '@c3/types';

// ProtocolFn is now defined in types/protocols.ts and re-exported from @c3/types.
// Re-exported here for backward compatibility.
export type { ProtocolFn };

export interface UsePersonReadinessResult {
  evaluation: ObligationEvaluation | null;
  isLoading: boolean;
  error: unknown;
}

export const usePersonReadiness = (
  personId: string,
  protocolFn: ProtocolFn,
  context?: ProtocolContext,
): UsePersonReadinessResult => {
  const { data: credentials, isLoading, error } = usePersonCredentials(personId);

  const evaluation = useMemo(() => {
    if (!personId || personId.trim().length === 0) return null;
    if (isLoading || credentials === undefined) return null;
    return protocolFn(personId, credentials, context);
  }, [credentials, isLoading, personId, protocolFn, context]);

  return { evaluation, isLoading, error };
};
