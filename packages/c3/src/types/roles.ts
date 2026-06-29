export type C3Role =
  | 'owner'
  | 'operations'
  | 'legal'
  | 'finance'
  | 'hr'
  | 'management'
  | 'visitor';

export interface C3Capabilities {
  canCreate: boolean;
  canEdit: boolean;
  canViewFinancials: boolean;
  canManageSettings: boolean;
  canUploadDocuments: boolean;
  canCaptureRenewal: boolean;
  isReadOnly: boolean;
}