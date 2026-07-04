/**
 * approvalInboxView.ts — Sprint 31 (Approval Query Integrity, consumer pass).
 *
 * Pure assembly of the ApprovalInbox view state from the two S31 queries.
 * Extracted so the failure semantics are compiled-from-source parity-testable
 * (s31 harness) — the screen renders exactly what this module decides.
 *
 * Truthful-failure contract (locked):
 *   - ACTIONABLE failure ⇒ mode 'error'. Nothing renders as data: no zero
 *     counts, no empty tabs, no empty-success state of any kind.
 *   - TERMINAL failure alone ⇒ mode 'ready' with terminalUnavailable=true:
 *     successfully loaded actionable approvals stay fully visible; the
 *     Executed/Rejected tabs and the All count become UNAVAILABLE (null),
 *     never zero; the All tab still lists the actionable rows alongside an
 *     unavailability notice.
 *   - Successful empty results are real zeros / empty arrays — always
 *     distinguishable from null (unavailable).
 *
 * No React, no hooks, no services. Pure functions only.
 */

import type { C3Approval } from '@c3/utils/spApprovalMapper';

export type InboxTabId = 'pending' | 'approved' | 'executed' | 'rejected' | 'failed' | 'all';

/** Statuses that belong to each tab (actionable tabs draw from the complete set). */
export const TAB_STATUS_SETS: Record<InboxTabId, readonly string[]> = {
  pending:  ['Submitted', 'InReview'],
  approved: ['Approved'],
  executed: ['Executed'],
  rejected: ['Rejected'],
  failed:   ['ExecutionFailed'],
  all:      ['Submitted', 'InReview', 'Approved', 'Rejected', 'Executed', 'ExecutionFailed'],
};

export interface ApprovalInboxViewInput {
  actionable: C3Approval[] | undefined;
  /** True when the complete actionable query failed. */
  actionableError: boolean;
  terminal: C3Approval[] | undefined;
  /** True when the windowed terminal query failed. */
  terminalError: boolean;
  /** The terminal window size (DEFAULT_TERMINAL_HISTORY_LIMIT). */
  terminalLimit: number;
}

export interface ApprovalInboxView {
  /** 'error' = actionable data unavailable — the inbox must render an explicit
   *  error state and NOTHING that could read as an empty success. */
  mode: 'error' | 'ready';
  /** Terminal history failed while actionable loaded — terminal tabs are
   *  unavailable; actionable data remains fully visible. */
  terminalUnavailable: boolean;
  /** True once the terminal window is saturated — loaded counts ≠ totals. */
  terminalWindowed: boolean;
  /** All-tab rows: actionable + terminal window (actionable-only when the
   *  terminal query failed), deduped by Id, sorted Id desc. */
  merged: C3Approval[];
  /** Per-tab counts. null = UNAVAILABLE (query failed) — never rendered as 0. */
  counts: Record<InboxTabId, number | null>;
}

export function buildApprovalInboxView(input: ApprovalInboxViewInput): ApprovalInboxView {
  const { actionableError, terminalError, terminalLimit } = input;

  if (actionableError) {
    // Actionable unavailable — nothing may render as data.
    return {
      mode: 'error',
      terminalUnavailable: terminalError,
      terminalWindowed: false,
      merged: [],
      counts: { pending: null, approved: null, executed: null, rejected: null, failed: null, all: null },
    };
  }

  const actionable = input.actionable ?? [];
  const terminal = terminalError ? [] : (input.terminal ?? []);

  // Statuses are disjoint between the two queries; dedupe by Id defensively
  // (a row transitioning between the two fetches), actionable copy wins.
  const byId = new Map<number, C3Approval>();
  for (const a of terminal) byId.set(a.id, a);
  for (const a of actionable) byId.set(a.id, a);
  const merged = [...byId.values()].sort((a, b) => b.id - a.id);

  const countIn = (tab: InboxTabId, source: C3Approval[]) =>
    source.filter(a => TAB_STATUS_SETS[tab].includes(a.approvalStatus)).length;

  return {
    mode: 'ready',
    terminalUnavailable: terminalError,
    terminalWindowed: !terminalError && terminal.length >= terminalLimit,
    merged,
    counts: {
      pending:  countIn('pending', actionable),
      approved: countIn('approved', actionable),
      failed:   countIn('failed', actionable),
      // Terminal counts are window counts; unavailable (null) on failure —
      // a failed window must never display as zero terminal history.
      executed: terminalError ? null : countIn('executed', terminal),
      rejected: terminalError ? null : countIn('rejected', terminal),
      // The All count claims mixed completeness — it is unavailable when the
      // terminal half is missing (content still renders actionable rows).
      all: terminalError ? null : merged.length,
    },
  };
}

/**
 * Rows for a tab. `null` = tab content UNAVAILABLE (render an error notice,
 * never an empty-success message). An empty array is a genuine empty result.
 * The All tab keeps returning rows when only terminal history is missing —
 * actionable approvals are never hidden by a terminal failure.
 */
export function visibleApprovalsForTab(
  view: ApprovalInboxView,
  tab: InboxTabId,
): C3Approval[] | null {
  if (view.mode === 'error') return null;
  if (tab === 'all') return view.merged;
  if ((tab === 'executed' || tab === 'rejected') && view.terminalUnavailable) return null;
  const source = view.merged;
  return source.filter(a => TAB_STATUS_SETS[tab].includes(a.approvalStatus));
}
