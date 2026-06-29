import type { AdapterInfo, DiagnosticsReport } from '@c3/types';

export interface IDiagnosticsService {
  getDiagnostics(): Promise<DiagnosticsReport>;
  getAdapterInfo(): AdapterInfo;
}
