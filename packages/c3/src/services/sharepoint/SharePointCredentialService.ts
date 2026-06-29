import type { Credential, CreateCredentialInput } from '@c3/types';
import type { ICredentialService } from '../interfaces/ICredentialService';

export const createSharePointCredentialService = (): ICredentialService => ({
  async listCredentialsForPerson(personId: string): Promise<Credential[]> {
    void personId;
    console.warn('[C3] SharePointCredentialService.listCredentialsForPerson: not implemented');
    return [];
  },

  async getCredential(credentialId: string): Promise<Credential> {
    void credentialId;
    console.warn('[C3] SharePointCredentialService.getCredential: not implemented');
    return null as unknown as Credential;
  },

  async addCredential(input: CreateCredentialInput): Promise<Credential> {
    void input;
    console.warn('[C3] SharePointCredentialService.addCredential: not implemented');
    return null as unknown as Credential;
  },

  async deactivateCredential(credentialId: string): Promise<void> {
    void credentialId;
    console.warn('[C3] SharePointCredentialService.deactivateCredential: not implemented');
  },

  async listAllCredentials(): Promise<Credential[]> {
    console.warn('[C3] SharePointCredentialService.listAllCredentials: not implemented');
    return [];
  },
});
