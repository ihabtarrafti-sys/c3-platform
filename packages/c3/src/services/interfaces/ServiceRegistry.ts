import type { IAmendmentService } from './IAmendmentService';
import type { IContractService } from './IContractService';
import type { ICredentialService } from './ICredentialService';
import type { IDiagnosticsService } from './IDiagnosticsService';
import type { IJourneyService } from './IJourneyService';
import type { IPersonService } from './IPersonService';
import type { IUserService } from './IUserService';

export interface ServiceRegistry {
  contracts: IContractService;
  people: IPersonService;
  amendments: IAmendmentService;
  credentials: ICredentialService;
  journeys: IJourneyService;
  users: IUserService;
  diagnostics: IDiagnosticsService;
}
