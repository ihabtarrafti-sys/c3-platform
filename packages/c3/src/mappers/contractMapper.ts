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
 * fix(s24-p1): Guard deriveOpsStatus against undefined/null EndDate — SP items
 *   may omit EndDate; without the guard the .split('T') call throws at read time.
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
// Canonical row validation (Sprint 32 — read integrity)
//
// Pure, parity-testable guard used by SharePointContractService BEFORE
// mapContract. Rejects (never coerces):
//   - missing/invalid SP Id;
//   - missing required canonical fields (Title/ContractID, PersonID, FullName,
//     ContractTypeName, ContractStage1, EndDate — the documented required set);
//   - lookup-object values where the canonical schema requires flat plain
//     text (the pre-canonical mock list returned expanded lookup objects for
//     person/team/game — those are architecture violations, not data).
// mapContract itself is unchanged (s15 parity surface preserved).
// ---------------------------------------------------------------------------

const REQUIRED_TEXT_FIELDS = ['Title', 'PersonID', 'FullName', 'ContractTypeName', 'ContractStage1', 'EndDate'] as const;
const FLAT_ONLY_FIELDS = [
  'Title', 'PersonID', 'FullName', 'DisplayName', 'ContractTypeName', 'AgreementCategory',
  'ContractStage1', 'Disposition1', 'CurrencyCode', 'ContractOwnerName', 'ContractOwnerEmail',
] as const;

/** Returns error messages; empty array = the row is canonically valid. */
export function validateSpContractItem(item: Partial<SPContractItem> & Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (typeof item.Id !== 'number' || !isFinite(item.Id)) errors.push('Id is missing or not a number.');
  for (const f of FLAT_ONLY_FIELDS) {
    const v = item[f];
    if (v !== null && v !== undefined && typeof v === 'object') {
      errors.push(`${f} is a lookup/object value — the canonical schema requires flat plain text (rejected, not coerced).`);
    }
  }
  for (const f of REQUIRED_TEXT_FIELDS) {
    const v = item[f];
    if (typeof v !== 'string' || v.trim() === '') errors.push(`Required canonical field ${f} is missing or blank.`);
  }
  return errors;
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
 *
 * fix(s24-p1): Returns 'Active' for missing EndDate rather than crashing.
 * SP items from the C3Contracts list may omit EndDate if not yet provisioned.
 */
const deriveOpsStatus = (endDate: string | null | undefined): OpsStatus => {
  if (!endDate) return 'Active';
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
