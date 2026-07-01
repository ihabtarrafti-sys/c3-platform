import type { Contract, Person } from '@c3/types';

export const mockContracts: Contract[] = [
  {
    Id: 1,
    ContractID: 'GKE-PL-2026-003',
    Title: 'GKE-PL-2026-003 | Player Contract | Abdulaziz Alabdullatif',

    PersonID: 'PER-0001',
    FullName: 'Abdulaziz Alabdullatif',
    DisplayName: 'Abdulaziz Alabdullatif',
    IGN: 'Kakarot',
    PersonnelCode: 'FN/PL/001',

    Team: 'GKE Fortnite',
    GameTitle: 'Fortnite',

    ContractTypeName: 'Player',
    AgreementCategory: 'Player Contract',
    ContractYear: 2026,

    ContractStage1: 'Signed',
    OpsStatus: 'Active',
    Disposition1: null,

    HasSignedContract: true,

    StartDate: '2026-06-21T00:00:00Z',
    EndDate: '2026-07-01T00:00:00Z',
    SignatureDate: '2026-06-21T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-06-21T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 4,
    AmendmentCount: 2,

    PrimaryDocumentURL: 'https://geekaygames.sharepoint.com/sites/C3/C3_ContractDocuments/Contracts/2026/GKE/GKE-PL-2026-003',

    MonthlyCompensation: 1000,
    CurrencyCode: 'AED',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },

  {
    Id: 2,
    ContractID: 'GKE-PL-2026-004',
    Title: 'GKE-PL-2026-004 | Player Contract | Mohammad Alkhalailah',

    PersonID: 'PER-0002',
    FullName: 'Mohammad Alkhalailah',
    DisplayName: 'Mohammad Alkhalailah',
    IGN: 'Klownz',
    PersonnelCode: 'OP/OP/001',

    Team: 'Operations',

    ContractTypeName: 'Staff',
    AgreementCategory: 'Staff Contract',
    ContractYear: 2026,

    ContractStage1: 'Signed',
    OpsStatus: 'Active',
    Disposition1: 'Renewing',

    HasSignedContract: true,

    StartDate: '2026-06-21T00:00:00Z',
    EndDate: '2026-07-10T00:00:00Z',
    SignatureDate: '2026-06-21T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-06-21T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 2,
    AmendmentCount: 1,

    PrimaryDocumentURL: 'https://geekaygames.sharepoint.com/sites/C3/C3_ContractDocuments/Contracts/2026/GKE/GKE-PL-2026-004',

    MonthlyCompensation: 1100,
    CurrencyCode: 'AED',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },

  {
    Id: 3,
    ContractID: 'GKD-GD-2026-001',
    Title: 'GKD-GD-2026-001 | Staff Contract | Diab Hassan',

    PersonID: 'PER-0003',
    FullName: 'Diab Hassan',
    DisplayName: 'Diab Hassan',
    IGN: 'Diab',
    PersonnelCode: 'CR/GD/002',

    Team: 'Creative',

    ContractTypeName: 'Staff',
    AgreementCategory: 'Staff Contract',
    ContractYear: 2026,

    ContractStage1: 'Signed',
    OpsStatus: 'Active',
    Disposition1: 'Archived',

    HasSignedContract: true,

    StartDate: '2025-09-01T00:00:00Z',
    EndDate: '2026-08-31T00:00:00Z',
    SignatureDate: '2025-09-01T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2025-09-01T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 3,
    AmendmentCount: 1,

    MonthlyCompensation: 1200,
    CurrencyCode: 'USD',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },

  {
    Id: 4,
    ContractID: 'GKA-AN-2026-001',
    Title: 'GKA-AN-2026-001 | Staff Contract | Elaf Hussein',

    PersonID: 'PER-0004',
    FullName: 'Elaf Hussein',
    DisplayName: 'Elaf Hussein',
    IGN: 'Elaf',
    PersonnelCode: 'PG/AN/001',

    Team: 'GKA PUBG',
    GameTitle: 'PUBG Mobile',

    ContractTypeName: 'Staff',
    AgreementCategory: 'Staff Contract',
    ContractYear: 2026,

    ContractStage1: 'Signed',
    OpsStatus: 'Active',
    Disposition1: 'Terminated',

    HasSignedContract: true,

    StartDate: '2026-01-15T00:00:00Z',
    EndDate: '2026-08-15T00:00:00Z',
    SignatureDate: '2026-01-15T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-01-15T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 2,
    AmendmentCount: 1,

    MonthlyCompensation: 1300,
    CurrencyCode: 'SAR',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },

  {
    Id: 5,
    ContractID: 'GKA-AN-2026-002',
    Title: 'GKA-AN-2026-002 | Staff Contract | Bechir Mettali',

    PersonID: 'PER-0005',
    FullName: 'Bechir Mettali',
    DisplayName: 'Bechir Mettali',
    IGN: 'Boch',
    PersonnelCode: 'LL/AN/002',

    Team: 'GKA League of Legends',
    GameTitle: 'League of Legends',

    ContractTypeName: 'Staff',
    AgreementCategory: 'Staff Contract',
    ContractYear: 2026,

    ContractStage1: 'Draft',
    OpsStatus: 'Active',
    Disposition1: null,

    HasSignedContract: false,

    StartDate: '2026-03-01T00:00:00Z',
    EndDate: '2026-09-30T00:00:00Z',
    SignatureDate: '2026-03-01T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-03-01T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 1,
    AmendmentCount: 0,

    MonthlyCompensation: 1400,
    CurrencyCode: 'SAR',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },

  {
    Id: 6,
    ContractID: 'GKD-GD-2026-002',
    Title: 'GKD-GD-2026-002 | Staff Contract | Sari Al-Khatib',

    PersonID: 'PER-0006',
    FullName: 'Sari Al-Khatib',
    DisplayName: 'Sari Al-Khatib',
    IGN: 'Sari',
    PersonnelCode: 'CR/GD/001',

    Team: 'Creative',

    ContractTypeName: 'Staff',
    AgreementCategory: 'Staff Contract',
    ContractYear: 2026,

    ContractStage1: 'In Review',
    OpsStatus: 'Active',
    Disposition1: 'Active',

    HasSignedContract: true,

    StartDate: '2026-02-01T00:00:00Z',
    EndDate: '2026-09-30T00:00:00Z',
    SignatureDate: '2026-02-01T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-02-01T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 2,
    AmendmentCount: 1,

    MonthlyCompensation: 1500,
    CurrencyCode: 'USD',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },

  {
    Id: 7,
    ContractID: 'GKD-VE-2026-003',
    Title: 'GKD-VE-2026-003 | Staff Contract | Nadia Khoury',

    PersonID: 'PER-0007',
    FullName: 'Nadia Khoury',
    DisplayName: 'Nadia Khoury',
    IGN: 'Nadia',
    PersonnelCode: 'CR/VE/003',

    Team: 'Creative',

    ContractTypeName: 'Staff',
    AgreementCategory: 'Staff Contract',
    ContractYear: 2026,

    ContractStage1: 'Pending Approval',
    OpsStatus: 'Active',
    Disposition1: 'Active',

    HasSignedContract: true,

    StartDate: '2026-02-01T00:00:00Z',
    EndDate: '2026-09-30T00:00:00Z',
    SignatureDate: '2026-02-01T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-02-01T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 1,
    AmendmentCount: 1,

    MonthlyCompensation: 1600,
    CurrencyCode: 'USD',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },

  {
    Id: 8,
    ContractID: 'GKA-PL-2026-001',
    Title: 'GKA-PL-2026-001 | Player Contract | Keon Williams',

    PersonID: 'PER-0008',
    FullName: 'Keon Williams',
    DisplayName: 'Keon Williams',
    IGN: 'Keon',
    PersonnelCode: 'AL/PL/001',

    Team: 'GKA Apex Legends',
    GameTitle: 'Apex Legends',

    ContractTypeName: 'Player',
    AgreementCategory: 'Player Contract',
    ContractYear: 2026,

    ContractStage1: 'Pending Signature',
    OpsStatus: 'Active',
    Disposition1: 'Active',

    HasSignedContract: false,

    StartDate: '2026-04-01T00:00:00Z',
    EndDate: '2026-09-30T00:00:00Z',
    SignatureDate: '2026-04-01T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-04-01T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 1,
    AmendmentCount: 0,

    MonthlyCompensation: 1700,
    CurrencyCode: 'SAR',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },

  {
    Id: 9,
    ContractID: 'GKA-AC-2026-003',
    Title: 'GKA-AC-2026-003 | Coach Contract | Jamison Moore',

    PersonID: 'PER-0009',
    FullName: 'Jamison Moore',
    DisplayName: 'Jamison Moore',
    IGN: 'Jxmo',
    PersonnelCode: 'AL/CH/001',

    Team: 'GKA Apex Legends',
    GameTitle: 'Apex Legends',

    ContractTypeName: 'Head Coach',
    AgreementCategory: 'Coach Contract',
    ContractYear: 2026,

    ContractStage1: 'Signed',
    OpsStatus: 'Active',
    Disposition1: 'Active',

    HasSignedContract: true,

    StartDate: '2026-04-01T00:00:00Z',
    EndDate: '2026-09-30T00:00:00Z',
    SignatureDate: '2026-04-15T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-04-15T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 2,
    AmendmentCount: 1,

    MonthlyCompensation: 2200,
    CurrencyCode: 'SAR',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },

  {
    Id: 10,
    ContractID: 'GKA-PL-2026-002',
    Title: 'GKA-PL-2026-002 | Player Contract | Tyler Johnson',

    PersonID: 'PER-0010',
    FullName: 'Tyler Johnson',
    DisplayName: 'Tyler Johnson',
    IGN: 'Phantom',
    PersonnelCode: 'AL/PL/002',

    Team: 'GKA Apex Legends',
    GameTitle: 'Apex Legends',

    ContractTypeName: 'Player',
    AgreementCategory: 'Player Contract',
    ContractYear: 2026,

    ContractStage1: 'Signed',
    OpsStatus: 'Active',
    Disposition1: 'Active',

    HasSignedContract: true,

    StartDate: '2026-04-01T00:00:00Z',
    EndDate: '2026-09-30T00:00:00Z',
    SignatureDate: '2026-04-20T00:00:00Z',

    ApprovalStatus: 'Approved',
    ApprovalDate: '2026-04-20T00:00:00Z',

    ApprovedBy: 'Ihab Tarrafti',

    DocumentCount: 2,
    AmendmentCount: 0,

    MonthlyCompensation: 1700,
    CurrencyCode: 'SAR',

    ContractOwner: {
      Title: 'Ihab Tarrafti',
      EMail: 'ihab@geekaygroupmea.com',
    },
  },
];

export const mockPeople: Person[] = [
  {
    Id: 1,
    PersonID: 'PER-0001',
    FullName: 'Abdulaziz Alabdullatif',
    IGN: 'Kakarot',
    Nationality: 'Saudi Arabia',
    PrimaryRole: 'Player',
    PersonnelCode: 'FN/PL/001',
    CurrentTeam: 'GKE Fortnite',
    CurrentGameTitle: 'Fortnite',
    PrimaryDepartment: 'Esports',
    IsActive: true,
    FirstContractDate: '2026-01-10T00:00:00Z',
    LatestContractDate: '2026-06-21T00:00:00Z',
    TotalContracts: 2,
  },
  {
    Id: 2,
    PersonID: 'PER-0003',
    FullName: 'Diab Hassan',
    IGN: 'Diab',
    Nationality: 'Morocco',
    PrimaryRole: 'Graphic Designer',
    PersonnelCode: 'CR/GD/002',
    CurrentTeam: 'Creative',
    PrimaryDepartment: 'Creative',
    IsActive: true,
    FirstContractDate: '2025-09-01T00:00:00Z',
    LatestContractDate: '2025-09-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 3,
    PersonID: 'PER-0002',
    FullName: 'Mohammad Alkhalailah',
    IGN: 'Klownz',
    Nationality: 'Jordan',
    PrimaryRole: 'Player Operations Manager',
    PersonnelCode: 'OP/OP/001',
    CurrentTeam: 'Operations',
    PrimaryDepartment: 'Operations',
    IsActive: true,
    FirstContractDate: '2026-02-15T00:00:00Z',
    LatestContractDate: '2026-06-21T00:00:00Z',
    TotalContracts: 2,
  },
  {
    Id: 4,
    PersonID: 'PER-0004',
    FullName: 'Elaf Hussein',
    IGN: 'Elaf',
    Nationality: 'Morocco',
    PrimaryRole: 'Performance Analyst',
    PersonnelCode: 'PG/AN/001',
    CurrentTeam: 'GKA PUBG',
    CurrentGameTitle: 'PUBG Mobile',
    PrimaryDepartment: 'Esports',
    IsActive: true,
    FirstContractDate: '2026-01-15T00:00:00Z',
    LatestContractDate: '2026-01-15T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 5,
    PersonID: 'PER-0005',
    FullName: 'Bechir Mettali',
    IGN: 'Boch',
    Nationality: 'Tunisia',
    PrimaryRole: 'Performance Analyst',
    PersonnelCode: 'LL/AN/002',
    CurrentTeam: 'GKA League of Legends',
    CurrentGameTitle: 'League of Legends',
    PrimaryDepartment: 'Esports',
    IsActive: true,
    FirstContractDate: '2026-03-01T00:00:00Z',
    LatestContractDate: '2026-03-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 6,
    PersonID: 'PER-0006',
    FullName: 'Sari Al-Khatib',
    IGN: 'Sari',
    Nationality: 'Jordan',
    PrimaryRole: 'Graphic Designer',
    PersonnelCode: 'CR/GD/001',
    CurrentTeam: 'Creative',
    PrimaryDepartment: 'Creative',
    IsActive: true,
    FirstContractDate: '2026-02-01T00:00:00Z',
    LatestContractDate: '2026-02-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 7,
    PersonID: 'PER-0007',
    FullName: 'Nadia Khoury',
    IGN: 'Nadia',
    Nationality: 'Lebanon',
    PrimaryRole: 'Video Editor',
    PersonnelCode: 'CR/VE/003',
    CurrentTeam: 'Creative',
    PrimaryDepartment: 'Creative',
    IsActive: true,
    FirstContractDate: '2026-02-01T00:00:00Z',
    LatestContractDate: '2026-02-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 8,
    PersonID: 'PER-0008',
    FullName: 'Keon Williams',
    IGN: 'Keon',
    Nationality: 'United States',
    PrimaryRole: 'Player',
    PersonnelCode: 'AL/PL/001',
    CurrentTeam: 'GKA Apex Legends',
    CurrentGameTitle: 'Apex Legends',
    PrimaryDepartment: 'Esports',
    IsActive: true,
    FirstContractDate: '2026-04-01T00:00:00Z',
    LatestContractDate: '2026-04-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 9,
    PersonID: 'PER-0009',
    FullName: 'Jamison Moore',
    IGN: 'Jxmo',
    Nationality: 'United States',
    PrimaryRole: 'Head Coach',
    PersonnelCode: 'AL/CH/001',
    CurrentTeam: 'GKA Apex Legends',
    CurrentGameTitle: 'Apex Legends',
    PrimaryDepartment: 'Esports',
    IsActive: true,
    FirstContractDate: '2026-04-01T00:00:00Z',
    LatestContractDate: '2026-04-01T00:00:00Z',
    TotalContracts: 1,
  },
  {
    Id: 10,
    PersonID: 'PER-0010',
    FullName: 'Tyler Johnson',
    IGN: 'Phantom',
    Nationality: 'United States',
    PrimaryRole: 'Player',
    PersonnelCode: 'AL/PL/002',
    CurrentTeam: 'GKA Apex Legends',
    CurrentGameTitle: 'Apex Legends',
    PrimaryDepartment: 'Esports',
    IsActive: true,
    FirstContractDate: '2026-04-01T00:00:00Z',
    LatestContractDate: '2026-04-01T00:00:00Z',
    TotalContracts: 1,
  },
];
