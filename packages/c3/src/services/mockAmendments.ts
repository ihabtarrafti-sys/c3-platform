import type { Amendment } from '@c3/types';

export const mockAmendments: Amendment[] = [
  {
    Id: 1,
    AmendmentID: 'GKE-PL-2026-003-EXT-202606220731',

    ParentContractID: 1,
    ParentContractCode: 'GKE-PL-2026-003',

    AmendmentTypeCode: 'EXT',
    AmendmentTypeName: 'Extension',

    EffectiveDate: '2026-07-01T07:00:00Z',

    Description: 'Test amendment from C3',

    OldValue: 'End date 2026-12-31',
    NewValue: 'End date 2027-03-31',

    Status: 'Draft',
    AmendmentStatus: null,

    ApprovalStatus: null,
    ApprovalDate: null,
    ApprovedBy: null,

    ApprovalNotes: null,
    RejectionNote: null,

    DocumentURL: null,
    CreatedByPerson: undefined,
  },

  {
    Id: 2,
    AmendmentID: 'GKE-PL-2026-003-EXT-202606220851',

    ParentContractID: 1,
    ParentContractCode: 'GKE-PL-2026-003',

    AmendmentTypeCode: 'EXT',
    AmendmentTypeName: 'Extension',

    EffectiveDate: '2026-07-01T07:00:00Z',

    Description: 'Test amendment from C3',

    OldValue: 'End date 2026-12-31',
    NewValue: 'End date 2027-03-31',

    Status: 'Draft',
    AmendmentStatus: null,

    ApprovalStatus: null,
    ApprovalDate: null,
    ApprovedBy: null,

    ApprovalNotes: null,
    RejectionNote: null,

    DocumentURL: null,
    CreatedByPerson: undefined,
  },

  // Additional realistic scenarios for UI testing

  {
    Id: 3,
    AmendmentID: 'GKE-PL-2026-004-SAL-202606230915',

    ParentContractID: 2,
    ParentContractCode: 'GKE-PL-2026-004',

    AmendmentTypeCode: 'SAL',
    AmendmentTypeName: 'Salary Adjustment',

    EffectiveDate: '2026-08-01T07:00:00Z',

    Description: 'Monthly compensation increased following performance review.',

    OldValue: 'USD 10,000',
    NewValue: 'USD 11,000',

    Status: 'Submitted',
    AmendmentStatus: 'In Review',

    ApprovalStatus: 'Pending Approval',
    ApprovalDate: null,
    ApprovedBy: null,

    ApprovalNotes: null,
    RejectionNote: null,

    DocumentURL: null,
    CreatedByPerson: undefined,
  },

  {
    Id: 4,
    AmendmentID: 'GKD-GD-2026-001-ROL-202606240800',

    ParentContractID: 3,
    ParentContractCode: 'GKD-GD-2026-001',

    AmendmentTypeCode: 'ROL',
    AmendmentTypeName: 'Role Change',

    EffectiveDate: '2026-07-15T07:00:00Z',

    Description: 'Updated player role and responsibilities.',

    OldValue: 'Substitute',
    NewValue: 'Starting Roster',

    Status: 'Approved',
    AmendmentStatus: 'Implemented',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-06-24T08:00:00Z',
    ApprovedBy: 'Ihab Tarrafti',

    ApprovalNotes: 'Approved after management review.',
    RejectionNote: null,

    DocumentURL: 'https://example.com/amendments/GKE-PL-2026-005-ROL.pdf',
    CreatedByPerson: undefined,
  },

  {
    Id: 5,
    AmendmentID: 'GKA-AN-2026-001-TER-202606241030',

    ParentContractID: 4,
    ParentContractCode: 'GKA-AN-2026-001',

    AmendmentTypeCode: 'TER',
    AmendmentTypeName: 'Termination Amendment',

    EffectiveDate: '2026-07-31T07:00:00Z',

    Description: 'Early contract termination agreement.',

    OldValue: 'Contract Active',
    NewValue: 'Contract Terminated',

    Status: 'Rejected',
    AmendmentStatus: 'Closed',

    ApprovalStatus: 'Rejected',
    ApprovalDate: '2026-06-24T10:30:00Z',
    ApprovedBy: 'Executive Review Board',

    ApprovalNotes: null,
    RejectionNote: 'Insufficient supporting documentation.',

    DocumentURL: null,
    CreatedByPerson: undefined,
  },

  {
    Id: 6,
    AmendmentID: 'GKA-AN-2026-002-TER-202606241032',

    ParentContractID: 5,
    ParentContractCode: 'GKA-AN-2026-002',

    AmendmentTypeCode: 'TER',
    AmendmentTypeName: 'Termination Amendment',

    EffectiveDate: '2026-07-31T07:00:00Z',

    Description: 'Early contract termination agreement.',

    OldValue: 'Contract Active',
    NewValue: 'Contract Terminated',

    Status: 'Rejected',
    AmendmentStatus: 'Closed',

    ApprovalStatus: 'Rejected',
    ApprovalDate: '2026-06-24T10:30:00Z',
    ApprovedBy: 'Executive Review Board',

    ApprovalNotes: null,
    RejectionNote: 'Insufficient supporting documentation.',

    DocumentURL: null,
    CreatedByPerson: undefined,
  },

  {
    Id: 7,
    AmendmentID: 'GKD-GD-2026-002-TER-202606241033',

    ParentContractID: 6,
    ParentContractCode: 'GKD-GD-2026-002',

    AmendmentTypeCode: 'TER',
    AmendmentTypeName: 'Termination Amendment',

    EffectiveDate: '2026-07-31T07:00:00Z',

    Description: 'Early contract termination agreement.',

    OldValue: 'Contract Active',
    NewValue: 'Contract Terminated',

    Status: 'Rejected',
    AmendmentStatus: 'Closed',

    ApprovalStatus: 'Rejected',
    ApprovalDate: '2026-06-24T10:30:00Z',
    ApprovedBy: 'Executive Review Board',

    ApprovalNotes: null,
    RejectionNote: 'Insufficient supporting documentation.',

    DocumentURL: null,
    CreatedByPerson: undefined,
  },

    {
    Id: 8,
    AmendmentID: 'GKD-VE-2026-003-TER-202606241034',

    ParentContractID: 7,
    ParentContractCode: 'GKD-VE-2026-003',

    AmendmentTypeCode: 'TER',
    AmendmentTypeName: 'Termination Amendment',

    EffectiveDate: '2026-07-31T07:00:00Z',

    Description: 'Early contract termination agreement.',

    OldValue: 'Contract Active',
    NewValue: 'Contract Terminated',

    Status: 'Rejected',
    AmendmentStatus: 'Closed',

    ApprovalStatus: 'Rejected',
    ApprovalDate: '2026-06-24T10:30:00Z',
    ApprovedBy: 'Executive Review Board',

    ApprovalNotes: null,
    RejectionNote: 'Insufficient supporting documentation.',

    DocumentURL: null,
    CreatedByPerson: undefined,
  },

      {
    Id: 9,
    AmendmentID: 'GKA-PL-2026-001-TER-202606241035',

    ParentContractID: 8,
    ParentContractCode: 'GKA-PL-2026-001',

    AmendmentTypeCode: 'TER',
    AmendmentTypeName: 'Termination Amendment',

    EffectiveDate: '2026-07-31T07:00:00Z',

    Description: 'Early contract termination agreement.',

    OldValue: 'Contract Active',
    NewValue: 'Contract Terminated',

    Status: 'Rejected',
    AmendmentStatus: 'Closed',

    ApprovalStatus: 'Rejected',
    ApprovalDate: '2026-06-24T10:30:00Z',
    ApprovedBy: 'Executive Review Board',

    ApprovalNotes: null,
    RejectionNote: 'Insufficient supporting documentation.',

    DocumentURL: null,
    CreatedByPerson: undefined,
  },

      {
    Id: 10,
    AmendmentID: 'GKA-AC-2026-003-TER-202606241036',

    ParentContractID: 9,
    ParentContractCode: 'GKA-AC-2026-003',

    AmendmentTypeCode: 'TER',
    AmendmentTypeName: 'Termination Amendment',

    EffectiveDate: '2026-07-31T07:00:00Z',

    Description: 'Early contract termination agreement.',

    OldValue: 'Contract Active',
    NewValue: 'Contract Terminated',

    Status: 'Rejected',
    AmendmentStatus: 'Closed',

    ApprovalStatus: 'Rejected',
    ApprovalDate: '2026-06-24T10:30:00Z',
    ApprovedBy: 'Executive Review Board',

    ApprovalNotes: null,
    RejectionNote: 'Insufficient supporting documentation.',

    DocumentURL: null,
    CreatedByPerson: undefined,
  },
        {
    Id: 11,
    AmendmentID: 'GKA-AC-2026-004-TER-202606241037',

    ParentContractID: 11,
    ParentContractCode: 'GKA-AC-2026-004',

    AmendmentTypeCode: 'TER',
    AmendmentTypeName: 'Termination Amendment',

    EffectiveDate: '2026-07-31T07:00:00Z',

    Description: 'Early contract termination agreement.',

    OldValue: 'Contract Active',
    NewValue: 'Contract Terminated',

    Status: 'Rejected',
    AmendmentStatus: 'Closed',

    ApprovalStatus: 'Rejected',
    ApprovalDate: '2026-06-24T10:30:00Z',
    ApprovedBy: 'Executive Review Board',

    ApprovalNotes: null,
    RejectionNote: 'Insufficient supporting documentation.',

    DocumentURL: null,
    CreatedByPerson: undefined,
  },
];