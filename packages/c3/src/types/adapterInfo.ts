export interface AdapterInfo {
  name: string;
  version: string;
  source: 'mock' | 'sharepoint';
  supportsRead: boolean;
  supportsWrite: boolean;
}