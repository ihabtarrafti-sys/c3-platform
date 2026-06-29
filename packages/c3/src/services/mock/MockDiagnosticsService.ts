import type { AdapterInfo, DiagnosticsReport } from '@c3/types';
import type { IDiagnosticsService } from '../interfaces/IDiagnosticsService';
import { mockAmendments } from '../mockAmendments';
import { mockContracts, mockPeople } from '../mockData';

export const createMockDiagnosticsService = (): IDiagnosticsService => ({
  getAdapterInfo(): AdapterInfo {
    return {
      name: 'Mock Adapter',
      version: '1.0',
      source: 'mock',
      supportsRead: true,
      supportsWrite: false,
    };
  },

  getDiagnostics(): Promise<DiagnosticsReport> {
    return Promise.resolve({
      mode: 'mock',
      siteUrl: 'mock',
      generatedAt: new Date().toISOString(),
      overallStatus: 'warning',
      checks: [
        {
          id: 'contracts',
          label: 'Contracts',
          status: 'pass',
          adapter: 'Mock',
          source: 'mockContracts.ts',
          count: mockContracts.length,
          durationMs: 1,
          message: 'Contracts loaded successfully.',
          details: ['DTO validated', 'Contract relationships available'],
        },
        {
          id: 'people',
          label: 'People',
          status: 'pass',
          adapter: 'Mock',
          source: 'mockPeople.ts',
          count: mockPeople.length,
          durationMs: 1,
          message: 'People loaded successfully.',
          details: [
            'DTO validated',
            'Person-contract relationships available',
          ],
        },
        {
          id: 'amendments',
          label: 'Amendments',
          status: 'pass',
          adapter: 'Mock',
          source: 'mockAmendments.ts',
          count: mockAmendments.length,
          durationMs: 1,
          message: 'Amendments loaded successfully.',
          details: [
            'DTO validated',
            'Parent contract relationships available',
          ],
        },
        {
          id: 'users',
          label: 'Users',
          status: 'warning',
          adapter: 'Mock',
          source: 'mockSpService.ts',
          count: 0,
          durationMs: 0,
          message: 'User adapter pending Sprint 3A-8.',
          details: [
            'C3_Users exists but live adapter is not implemented yet',
          ],
        },
      ],
    });
  },
});
