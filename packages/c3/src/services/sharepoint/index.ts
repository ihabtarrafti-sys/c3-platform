import type { ServiceRegistry } from '../interfaces/ServiceRegistry';
import { createSharePointAmendmentService } from './SharePointAmendmentService';
import { createSharePointContractService } from './SharePointContractService';
import { createSharePointCredentialService } from './SharePointCredentialService';
import { createSharePointDiagnosticsService } from './SharePointDiagnosticsService';
import { createSharePointJourneyService } from './SharePointJourneyService';
import { createSharePointPersonService } from './SharePointPersonService';
import { createSharePointUserService } from './SharePointUserService';

export const createSharePointServiceRegistry = (
  siteUrl: string,
): ServiceRegistry => ({
  contracts: createSharePointContractService(siteUrl),
  people: createSharePointPersonService(siteUrl),
  amendments: createSharePointAmendmentService(),
  credentials: createSharePointCredentialService(siteUrl),
  journeys: createSharePointJourneyService(siteUrl),
  users: createSharePointUserService(),
  diagnostics: createSharePointDiagnosticsService(siteUrl),
});
