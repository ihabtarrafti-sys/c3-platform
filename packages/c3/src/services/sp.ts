import { mockSpService } from './mockSpService';
import { createSharePointSPService } from './sharepointSpService';
import type { SPService } from './spService.types';

export type DataSourceMode = 'mock' | 'sharepoint';

interface CreateSPServiceOptions {
  siteUrl: string;
  mode: DataSourceMode;
}

export const createSPService = ({
  siteUrl,
  mode,
}: CreateSPServiceOptions): SPService => {
if (mode === 'sharepoint') {
  return createSharePointSPService(siteUrl);
}

return mockSpService();
};