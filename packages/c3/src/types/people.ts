export interface Person {
  Id: number;

  // Core Identity
  PersonID: string;
  FullName: string;

  // Public / operational display
  IGN?: string;

  // Classification
  Nationality?: string;
  PrimaryRole?: string;
  PersonnelCode?: string;

  // Lookups flattened for UI
  CurrentTeam?: string;
  CurrentGameTitle?: string;
  PrimaryDepartment?: string;

  // Lifecycle
  IsActive: boolean;

  FirstContractDate?: string;
  LatestContractDate?: string;

  TotalContracts?: number;

  Notes?: string;
}

export interface PersonContract {
  ContractId: number;
  ContractCode: string;
  ContractTypeName?: string;
  ContractStage1: string;
  Disposition1?: string | null;
  EndDate?: string;
}

export interface PersonProfile {
  person: Person;
  contracts: PersonContract[];
}