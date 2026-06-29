import type { SPPerson } from './contracts';

export interface Activity {
  Id: number;
  ActionType: string;
  PerformedBy: string;
  Timestamp: string;
  Notes?: string;
}

export interface Amendment {
  Id: number;

  AmendmentID: string;

  ParentContractID: number;
  ParentContractCode?: string;

  AmendmentTypeCode: string;
  AmendmentTypeName?: string | null;

  EffectiveDate: string;

  Description?: string | null;

  OldValue?: string | null;
  NewValue?: string | null;

  Status?: string | null;
  AmendmentStatus?: string | null;

  ApprovalStatus?: string | null;
  ApprovalDate?: string | null;
  ApprovedBy?: string | null;

  ApprovalNotes?: string | null;
  RejectionNote?: string | null;

  DocumentURL?: string | null;

  CreatedByPerson?: SPPerson;
}