import type { AdapterInfo, DiagnosticsReport } from '@c3/types';
import type { IDiagnosticsService } from '../interfaces/IDiagnosticsService';

export const createSharePointDiagnosticsService = (
  siteUrl: string,
): IDiagnosticsService => ({
  getAdapterInfo(): AdapterInfo {
    return {
      name: 'SharePoint Adapter',
      version: '1.0',
      source: 'sharepoint',
      supportsRead: true,
      supportsWrite: false,
    };
  },

  async getDiagnostics(): Promise<DiagnosticsReport> {
    return {
      mode: 'sharepoint',
      siteUrl,
      generatedAt: new Date().toISOString(),
      overallStatus: 'warning',
      checks: [
        {
          id: 'sharepoint-adapter',
          label: 'SharePoint Adapter',
          status: 'warning',
          adapter: 'SharePoint',
          source: siteUrl,
          message:
            'SharePoint adapter exists but live diagnostics are not fully implemented yet.',
          details: [
            'Contract query is implemented',
            'People query is pending',
            'Amendments query is pending',
            'Users query is pending',
          ],
        },
      ],
    };
  },
});
