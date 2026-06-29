import type { Amendment, SPPerson } from '@c3/types';

interface SPUserValue {
  Title?: string;
  EMail?: string;
}

interface SPUrlValue {
  Url?: string;
  Description?: string;
}

export interface SPAmendmentItem {
  Id: number;
  ID?: number;

  Title: string;

  ParentContractIDId: number;
  ParentContractID0?: string;

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

  DocumentURL?: SPUrlValue | string | null;

  CreatedByPerson?: SPUserValue | null;
}

export const mapAmendment = (item: SPAmendmentItem): Amendment => {
  return {
    Id: item.Id ?? item.ID ?? 0,

    AmendmentID: item.Title,

    ParentContractID: item.ParentContractIDId,
    ParentContractCode: item.ParentContractID0,

    AmendmentTypeCode: item.AmendmentTypeCode,
    AmendmentTypeName: item.AmendmentTypeName ?? undefined,

    EffectiveDate: item.EffectiveDate,

    Description: item.Description ?? undefined,

    OldValue: item.OldValue ?? undefined,
    NewValue: item.NewValue ?? undefined,

    Status: item.Status ?? undefined,
    AmendmentStatus: item.AmendmentStatus ?? undefined,

    ApprovalStatus: item.ApprovalStatus ?? undefined,
    ApprovalDate: item.ApprovalDate ?? undefined,
    ApprovedBy: item.ApprovedBy ?? undefined,

    ApprovalNotes: item.ApprovalNotes ?? undefined,
    RejectionNote: item.RejectionNote ?? undefined,

    DocumentURL: normalizeUrl(item.DocumentURL),

    CreatedByPerson: item.CreatedByPerson
      ? mapUser(item.CreatedByPerson)
      : undefined,
  };
};

const mapUser = (user: SPUserValue): SPPerson => {
  return {
    Title: user.Title ?? 'Unassigned',
    EMail: user.EMail ?? '',
  };
};

const normalizeUrl = (value?: SPUrlValue | string | null): string | undefined => {
  if (!value) return undefined;

  if (typeof value === 'string') {
    return value;
  }

  return value.Url;
};