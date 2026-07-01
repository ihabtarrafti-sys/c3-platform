export type ContractStage =
  | 'Draft'
  | 'In Review'
  | 'Pending Approval'
  | 'Pending Signature'
  | 'Signed';

export type OpsStatus = 'Active' | 'Expiring30' | 'Expiring7' | 'Expired';

export type Disposition =
  | 'Active'
  | 'Renewing'
  | 'Terminated'
  | 'Archived'
  | null;

export interface SPPerson {
  Title: string;
  EMail: string;
}

export interface Contract {
  // Core identity
  Id: number;
  ContractID: string;
  Title: string;

  // Person
  PersonID: string;
  FullName: string;
  DisplayName?: string;
  IGN?: string;
  PersonnelCode?: string;

  Nationality?: string;
  Team?: string;
  GameTitle?: string;
  PrimaryRole?: string;

  // Classification
  ContractTypeName: string;
  AgreementCategory?: string;
  ContractYear?: number;

  // Lifecycle
  ContractStage1: ContractStage;
  OpsStatus: OpsStatus;
  Disposition1: Disposition;

  HasSignedContract?: boolean;

  StartDate?: string;
  EndDate: string;
  SignatureDate?: string;
  TerminationDate?: string;

  // Approval
  ApprovalStatus?: string;
  ApprovalDate?: string;

  Manager?: string;
  Reviewer?: string;
  Approver?: string;
  ApprovedBy?: string;

  // Documents
  DocumentCount?: number;
  AmendmentCount?: number;

  PrimaryDocumentURL?: string;
  LatestAmendmentURL?: string;

  // Financial
  MonthlyCompensation?: number;
  CurrencyCode?: string;
  PrizeSharePct?: number;

  // Ownership
  ContractOwner: SPPerson;
}