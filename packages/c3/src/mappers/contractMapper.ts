/**
 * contractMapper.ts
 *
 * Sprint 24 Phase 1 — Rewritten for flat C3Contracts schema.
 *
 * Changes from legacy mapper:
 *   - Removed SPUserValue / SPUrlValue types (no SP lookup columns in C3Contracts).
 *   - Removed mapUser / normalizeUrl helpers.
 *   - Added flat SPContractItem matching the C3Contracts 19-column schema.
 *   - Added inline deriveOpsStatus() to avoid circular import with contractKpis.ts.
 *   - ContractOwner is two plain-text columns (ContractOwnerName, ContractOwnerEmail).
 *   - PersonID propagated from SP item to Contract (PER-XXXX canonical FK).
 *
 * See: docs/architecture/C3Contracts SP List Schema.md
 */

import type { Contract, OpsStatus, SPPerson } from '@c3/types';

// ---------------------------------------------------------------------------
// SP item shape — mirrors C3Contracts list columns exactly
// ---------------------------------------------------------------------------

export interface SPContractItem {
  Id: number;
  Title: string;                // ContractID (e.g. GKE-PL-2026-003)
  PersonID: string;             // PER-XXXX — plain text FK to C3People
  FullName: string;
  DisplayName?: string;
  ContractTypeName: string;
  AgreementCategory?: string;
  ContractStage1: import('@c3/types').ContractStage;
  Disposition1: import('@c3/types').Disposition;
  StartDate?: string;
  EndDate: string;
  SignatureDate?: string;
  TerminationDate?: string;
  HasSignedContract?: boolean;
  MonthlyCompensation?: number;
  CurrencyCode?: string;
  PrizeSharePct?: number;
  ContractOwnerName?: string;
  ContractOwnerEmail?: string;
  IsActive?: boolean;
}

// ---------------------------------------------------------------------------
// OpsStatus derivation
// ---------------------------------------------------------------------------

/**
 * Derive OpsStatus from EndDate at read time.
 * OpsStatus is NOT stored in C3Contracts — it is computed in the mapper.
 * Defined inline here to avoid a circular import with contractKpis.ts.
 *
 * Thresholds (calendar days, UTC midnight comparison):
 *   <= 0  → Expired
 *   <= 7  → Expiring7
 *   <= 30 → Expiring30
 *   > 30  → Active
 */
const deriveOpsStatus = (endDate: string): OpsStatus => {
  const today = new Date(
    new Date().toISOString().split('T')[0] + 'T00:00:00Z',
  );
  const end = new Date(endDate.split('T')[0] + 'T00:00:00Z');
  const days = Math.floor(
    (end.getTime() - today.getTime()) / (86_400 * 1000),
  );
  if (days <= 0) return 'Expired';
  if (days <= 7) return 'Expiring7';
  if (days <= 30) return 'Expiring30';
  return 'Active';
};

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export const mapContract = (item: SPContractItem): Contract => {
  const contractOwner: SPPerson = {
    Title: item.ContractOwnerName ?? 'Unassigned',
    EMail: item.ContractOwnerEmail ?? '',
  };

  return {
    Id: item.Id,
    ContractID: item.Title,
    Title: item.Title,

    PersonID: item.PersonID ?? '',
    FullName: item.FullName,
    DisplayName: item.DisplayName,

    ContractTypeName: item.ContractTypeName,
    AgreementCategory: item.AgreementCategory,

    ContractStage1: item.ContractStage1,
    OpsStatus: deriveOpsStatus(item.EndDate),
    Disposition1: item.Disposition1 ?? null,

    StartDate: item.StartDate,
    EndDate: item.EndDate,
    SignatureDate: item.SignatureDate,
    TerminationDate: item.TerminationDate,

    HasSignedContract: item.HasSignedContract,

    MonthlyCompensation: item.MonthlyCompensation,
    CurrencyCode: item.CurrencyCode,
    PrizeSharePct: item.PrizeSharePct,

    ContractOwner: contractOwner,
  };
};
