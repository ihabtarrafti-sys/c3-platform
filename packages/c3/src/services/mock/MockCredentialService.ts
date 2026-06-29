import type { Credential, CreateCredentialInput } from '@c3/types';
import type { ICredentialService } from '../interfaces/ICredentialService';

// ---------------------------------------------------------------------------
// Mock credential data
//
// Realistic credentials for the three demo people (PersonID-keyed).
// Designed to exercise the readiness model:
//   - PER-0001 (Abdulaziz): passport valid, visa expiring soon → At Risk
//   - PER-0002 (Mohammad): no visa on file → Unsatisfied
//   - PER-0003 (Diab): full set, all valid → Satisfied
// ---------------------------------------------------------------------------

const mockCredentials: Credential[] = [
  // ── PER-0001: Abdulaziz Alabdullatif ──────────────────────────────────────
  {
    Id: 1,
    CredentialID: 'CRED-0001',
    HolderPersonID: 'PER-0001',
    Type: 'Passport',
    ReferenceNumber: 'SA-G123456',
    IssuedBy: 'Kingdom of Saudi Arabia',
    IssuedDate: '2022-03-15',
    ExpiryDate: '2032-03-14',
    IsActive: true,
  },
  {
    Id: 2,
    CredentialID: 'CRED-0002',
    HolderPersonID: 'PER-0001',
    Type: 'Visa',
    ReferenceNumber: 'UAE-VISA-889901',
    SubType: 'Employment Visa',
    IssuedBy: 'UAE General Directorate of Residency',
    IssuedDate: '2025-07-10',
    ExpiryDate: '2026-07-09', // expiring ~11 days from today — At Risk
    IsActive: true,
  },
  {
    Id: 3,
    CredentialID: 'CRED-0003',
    HolderPersonID: 'PER-0001',
    Type: 'EmiratesID',
    ReferenceNumber: '784-1990-1234567-1',
    IssuedBy: 'UAE Federal Authority for Identity',
    IssuedDate: '2025-07-10',
    ExpiryDate: '2027-07-09',
    IsActive: true,
  },

  // ── PER-0002: Mohammad Alkhalailah ────────────────────────────────────────
  {
    Id: 4,
    CredentialID: 'CRED-0004',
    HolderPersonID: 'PER-0002',
    Type: 'Passport',
    ReferenceNumber: 'JO-P456789',
    IssuedBy: 'Hashemite Kingdom of Jordan',
    IssuedDate: '2021-11-01',
    ExpiryDate: '2031-10-31',
    IsActive: true,
  },
  // No Visa credential → Unsatisfied obligation when evaluated

  // ── PER-0003: Diab Hassan ─────────────────────────────────────────────────
  {
    Id: 5,
    CredentialID: 'CRED-0005',
    HolderPersonID: 'PER-0003',
    Type: 'Passport',
    ReferenceNumber: 'MA-AB789012',
    IssuedBy: 'Kingdom of Morocco',
    IssuedDate: '2023-05-20',
    ExpiryDate: '2033-05-19',
    IsActive: true,
  },
  {
    Id: 6,
    CredentialID: 'CRED-0006',
    HolderPersonID: 'PER-0003',
    Type: 'Visa',
    ReferenceNumber: 'UAE-VISA-556677',
    SubType: 'Employment Visa',
    IssuedBy: 'UAE General Directorate of Residency',
    IssuedDate: '2025-09-01',
    ExpiryDate: '2027-08-31',
    IsActive: true,
  },
  {
    Id: 7,
    CredentialID: 'CRED-0007',
    HolderPersonID: 'PER-0003',
    Type: 'EmiratesID',
    ReferenceNumber: '784-1995-7654321-3',
    IssuedBy: 'UAE Federal Authority for Identity',
    IssuedDate: '2025-09-01',
    ExpiryDate: '2027-08-31',
    IsActive: true,
  },
];

let nextId = mockCredentials.length + 1;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createMockCredentialService = (): ICredentialService => ({
  listCredentialsForPerson(personId: string): Promise<Credential[]> {
    const results = mockCredentials
      .filter(c => c.HolderPersonID === personId && c.IsActive)
      .sort((a, b) => {
        // Most recently issued first; undefined IssuedDate sorts last
        if (!a.IssuedDate && !b.IssuedDate) return 0;
        if (!a.IssuedDate) return 1;
        if (!b.IssuedDate) return -1;
        return b.IssuedDate.localeCompare(a.IssuedDate);
      });
    return Promise.resolve(results);
  },

  getCredential(credentialId: string): Promise<Credential> {
    const credential = mockCredentials.find(c => c.CredentialID === credentialId);
    if (!credential) {
      return Promise.reject(new Error(`Credential not found: ${credentialId}`));
    }
    return Promise.resolve(credential);
  },

  addCredential(input: CreateCredentialInput): Promise<Credential> {
    const id = nextId++;
    const credential: Credential = {
      ...input,
      Id: id,
      CredentialID: `CRED-${String(id).padStart(4, '0')}`,
      IsActive: true,
    };
    mockCredentials.push(credential);
    return Promise.resolve(credential);
  },

  deactivateCredential(credentialId: string): Promise<void> {
    const credential = mockCredentials.find(c => c.CredentialID === credentialId);
    if (credential) {
      credential.IsActive = false;
    }
    return Promise.resolve();
  },

  listAllCredentials(): Promise<Credential[]> {
    return Promise.resolve(mockCredentials.filter(c => c.IsActive));
  },
});
