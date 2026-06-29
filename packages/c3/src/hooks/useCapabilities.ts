import type { C3Capabilities, C3Role } from '@c3/types';
import { useApp } from './useApp';

const CAPABILITY_MAP: Record<C3Role, C3Capabilities> = {
  owner: {
    canCreate: true,
    canEdit: true,
    canViewFinancials: true,
    canManageSettings: true,
    canUploadDocuments: true,
    canCaptureRenewal: true,
    isReadOnly: false,
  },
  operations: {
    canCreate: true,
    canEdit: true,
    canViewFinancials: false,
    canManageSettings: false,
    canUploadDocuments: true,
    canCaptureRenewal: true,
    isReadOnly: false,
  },
  legal: {
    canCreate: false,
    canEdit: false,
    canViewFinancials: false,
    canManageSettings: false,
    canUploadDocuments: true,
    canCaptureRenewal: false,
    isReadOnly: false,
  },
  finance: {
    canCreate: false,
    canEdit: false,
    canViewFinancials: true,
    canManageSettings: false,
    canUploadDocuments: false,
    canCaptureRenewal: false,
    isReadOnly: true,
  },
  hr: {
    canCreate: false,
    canEdit: false,
    canViewFinancials: false,
    canManageSettings: false,
    canUploadDocuments: false,
    canCaptureRenewal: false,
    isReadOnly: true,
  },
  management: {
    canCreate: false,
    canEdit: false,
    canViewFinancials: true,
    canManageSettings: false,
    canUploadDocuments: false,
    canCaptureRenewal: false,
    isReadOnly: true,
  },
  visitor: {
    canCreate: false,
    canEdit: false,
    canViewFinancials: false,
    canManageSettings: false,
    canUploadDocuments: false,
    canCaptureRenewal: false,
    isReadOnly: true,
  },
};

export const useCapabilities = (): C3Capabilities => {
  const { currentUser } = useApp();
  return CAPABILITY_MAP[currentUser.c3Role];
};