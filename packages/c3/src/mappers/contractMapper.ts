import type { Contract, ContractStage, Disposition, OpsStatus, SPPerson } from '@c3/types';

interface SPUserValue {
  Title?: string;
  EMail?: string;
}

interface SPUrlValue {
  Url?: string;
  Description?: string;
}

export interface SPContractItem {
  Id: number;
  ID?: number;

  Title: string;

  FullName: string;
  DisplayName?: string;
  IGN?: string;
  PlayerCode?: string;
  Nationality?: string;
  PrimaryRole?: string;

  Team?: string;
  GameTitle?: string;

  AgreementCategory?: string;
  ContractYear?: number;

  ContractTypeName: string;
  ContractStage1: ContractStage;
  Disposition1: Disposition;
  OpsStatus: OpsStatus;

  HasSignedContract?: boolean;

  StartDate?: string;
  EndDate: string;
  SignatureDate?: string;
  TerminationDate?: string;

  ApprovalStatus?: string;
  ApprovalDate?: string;
  ApprovedBy?: string;

  Manager?: SPUserValue;
  Reviewer?: SPUserValue;
  Approver?: SPUserValue;

  DocumentCount?: number;
  AmendmentCount?: number;

  PrimaryDocumentURL?: SPUrlValue | string | null;
  LatestAmendmentURL?: SPUrlValue | string | null;

  MonthlyCompensation?: number;
  CurrencyCode?: string;
  PrizeSharePct?: number;

  ContractOwner?: SPUserValue;
}

export const mapContract = (item: SPContractItem): Contract => {
  return {
    Id: item.Id ?? item.ID ?? 0,
    ContractID: item.Title,
    Title: item.Title,

    FullName: item.FullName,
    DisplayName: item.DisplayName,
    IGN: item.IGN,
    PersonnelCode: item.PlayerCode,

    Nationality: item.Nationality,
    Team: item.Team,
    GameTitle: item.GameTitle,
    PrimaryRole: item.PrimaryRole,

    ContractTypeName: item.ContractTypeName,

    AgreementCategory: item.AgreementCategory,
    ContractYear: item.ContractYear,

    ContractStage1: item.ContractStage1,
    OpsStatus: item.OpsStatus,
    Disposition1: item.Disposition1,

    HasSignedContract: item.HasSignedContract,

    StartDate: item.StartDate,
    EndDate: item.EndDate,
    SignatureDate: item.SignatureDate,
    TerminationDate: item.TerminationDate,

    ApprovalStatus: item.ApprovalStatus,
    ApprovalDate: item.ApprovalDate,
    ApprovedBy: item.ApprovedBy,

    Manager: item.Manager?.Title,
    Reviewer: item.Reviewer?.Title,
    Approver: item.Approver?.Title,

    DocumentCount: item.DocumentCount,
    AmendmentCount: item.AmendmentCount,

    PrimaryDocumentURL: normalizeUrl(item.PrimaryDocumentURL),
    LatestAmendmentURL: normalizeUrl(item.LatestAmendmentURL),

    MonthlyCompensation: item.MonthlyCompensation,
    CurrencyCode: item.CurrencyCode,
    PrizeSharePct: item.PrizeSharePct,

    ContractOwner: mapUser(item.ContractOwner),
  };
};

const mapUser = (user?: SPUserValue): SPPerson => {
  return {
    Title: user?.Title ?? 'Unassigned',
    EMail: user?.EMail ?? '',
  };
};

const normalizeUrl = (value?: SPUrlValue | string | null): string | undefined => {
  if (!value) return undefined;

  if (typeof value === 'string') {
    return value;
  }

  return value.Url;
};