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
// ---------------------------------------------------------------------------
// CreatePersonInput
//
// Input type for governed AddPerson approval execution.
// Fields mirror the writable columns of C3People (IsActive defaults to true
// on creation; Id and PersonID are assigned by the service layer).
//
// Email is intentionally absent — it does not exist in the current C3People
// SP list schema. Duplicate protection is FullName-based. See TD-24.
//
// Sprint 25.
// ---------------------------------------------------------------------------

export interface CreatePersonInput {
  /** Full legal name. Required — cannot create a person without a name. */
  FullName: string;
  /** In-game name / alias. Optional. */
  IGN?: string;
  /** Country of nationality, plain text. Optional. */
  Nationality?: string;
  /** Primary role or job title, plain text. Optional. */
  PrimaryRole?: string;
  /** Internal HR personnel code (e.g. "FN/PL/001"). Optional. */
  PersonnelCode?: string;
  /** Current team assignment, plain text (e.g. "GKE Fortnite"). Optional. */
  CurrentTeam?: string;
  /** Game title the person competes in or supports. Optional. */
  CurrentGameTitle?: string;
  /** Organisational department, plain text (e.g. "Esports"). Optional. */
  PrimaryDepartment?: string;
  /** Operational notes. Optional. */
  Notes?: string;
}
