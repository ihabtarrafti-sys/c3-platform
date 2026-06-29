import type { Amendment, Contract, Person } from '@c3/types';
import { computeDaysToExpiry } from '@c3/utils/dateUtils';

export type OperationalInsightSeverity = 'Info' | 'Warning' | 'Critical';

export interface OperationalInsight {
  id: string;
  severity: OperationalInsightSeverity;
  title: string;
  description: string;
}

export const getOperationalInsights = ({
  contracts,
  amendments,
  people,
}: {
  contracts: Contract[];
  amendments: Amendment[];
  people: Person[];
}): OperationalInsight[] => {
  const insights: OperationalInsight[] = [];

  const needsRenewalDecision = contracts.filter(contract => {
    const days = computeDaysToExpiry(contract.EndDate);

    return (
      days >= 0 &&
      days <= 90 &&
      contract.Disposition1 === 'Active'
    );
  });

  if (needsRenewalDecision.length > 0) {
    insights.push({
      id: 'renewal-decisions',
      severity: needsRenewalDecision.length >= 3 ? 'Critical' : 'Warning',
      title: 'Renewal decisions required',
      description: `${needsRenewalDecision.length} active contract(s) are inside the renewal window and need a renewal decision.`,
    });
  }

  const pendingApprovals = contracts.filter(
    contract => contract.ContractStage1 === 'Pending Approval',
  );

  if (pendingApprovals.length > 0) {
    insights.push({
      id: 'pending-approvals',
      severity: 'Warning',
      title: 'Contracts pending approval',
      description: `${pendingApprovals.length} contract(s) are waiting for approval.`,
    });
  }

  const pendingSignatures = contracts.filter(
    contract => contract.ContractStage1 === 'Pending Signature',
  );

  if (pendingSignatures.length > 0) {
    insights.push({
      id: 'pending-signatures',
      severity: 'Warning',
      title: 'Contracts pending signature',
      description: `${pendingSignatures.length} contract(s) are waiting for signature.`,
    });
  }

  const missingGameAssignments = people.filter(person => {
  const maybePerson = person as Person & { GameTitle?: string; Game?: string };

  return !maybePerson.GameTitle && !maybePerson.Game;
});

  if (missingGameAssignments.length > 0) {
    insights.push({
      id: 'missing-game-assignments',
      severity: 'Info',
      title: 'Personnel missing game assignments',
      description: `${missingGameAssignments.length} personnel record(s) are missing game assignments.`,
    });
  }

  const amendmentIssues = amendments.filter(amendment => {
    return (
      amendment.Status === 'Draft' ||
      amendment.ApprovalStatus === 'Pending Approval'
    );
  });

  if (amendmentIssues.length > 0) {
    insights.push({
      id: 'amendment-workflow-health',
      severity: 'Warning',
      title: 'Amendments require workflow attention',
      description: `${amendmentIssues.length} amendment(s) are still in draft or pending approval.`,
    });
  }

  return insights;
};