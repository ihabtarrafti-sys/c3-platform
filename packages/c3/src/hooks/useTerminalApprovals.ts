/**
 * useTerminalApprovals.ts — Sprint 31 (Approval Query Integrity).
 *
 * DELIBERATELY WINDOWED terminal history: the newest `limit` Executed and
 * Rejected approvals by Id. Consumers MUST label the result as recent history
 * ("Showing latest N") and never present loaded counts as authoritative
 * totals — the truthful-display rule for this window lives in the UI.
 *
 * No polling: terminal rows are immutable audit records; invalidation via the
 * approvals root key refreshes the window after any mutation.
 */

import { useQuery } from '@tanstack/react-query';
import { DEFAULT_TERMINAL_HISTORY_LIMIT } from '@c3/services/interfaces/IApprovalsService';
import { queryKeys } from './queryKeys';
import { useApprovalsService } from './useApprovalsService';

export { DEFAULT_TERMINAL_HISTORY_LIMIT };

export const useTerminalApprovals = (limit: number = DEFAULT_TERMINAL_HISTORY_LIMIT) => {
  const service = useApprovalsService();

  return useQuery({
    queryKey: queryKeys.approvals.terminalRecent(limit),
    queryFn:  ({ signal }) => service.listRecentTerminalApprovals({ signal, limit }),
    refetchInterval: false,
    staleTime: 15_000,
  });
};
