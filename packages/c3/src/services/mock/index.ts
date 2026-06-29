import type { ServiceRegistry } from '../interfaces/ServiceRegistry';
import { createMockAmendmentService } from './MockAmendmentService';
import { createMockContractService } from './MockContractService';
import { createMockCredentialService } from './MockCredentialService';
import { createMockDiagnosticsService } from './MockDiagnosticsService';
import { createMockJourneyService } from './MockJourneyService';
import { createMockPersonService } from './MockPersonService';
import { createMockUserService } from './MockUserService';

export const createMockServiceRegistry = (): ServiceRegistry => ({
  contracts: createMockContractService(),
  people: createMockPersonService(),
  amendments: createMockAmendmentService(),
  credentials: createMockCredentialService(),
  journeys: createMockJourneyService(),
  users: createMockUserService(),
  diagnostics: createMockDiagnosticsService(),
});
