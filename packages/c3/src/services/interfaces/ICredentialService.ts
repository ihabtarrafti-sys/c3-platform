import type { Credential, CreateCredentialInput } from '@c3/types';

export interface ICredentialService {
  /**
   * List all active credentials held by a Person.
   * Returns credentials in reverse-chronological order by IssuedDate.
   */
  listCredentialsForPerson(personId: string): Promise<Credential[]>;

  /**
   * Retrieve a single credential by its CredentialID.
   */
  getCredential(credentialId: string): Promise<Credential>;

  /**
   * Register a new credential for a Person.
   * The service assigns CredentialID and sets IsActive = true.
   */
  addCredential(input: CreateCredentialInput): Promise<Credential>;

  /**
   * Mark a credential as inactive (superseded by renewal or expired/revoked).
   * Does not delete — the record is retained as operational history.
   */
  deactivateCredential(credentialId: string): Promise<void>;

  /**
   * List all active credentials across all persons.
   *
   * Used by the Situation Room aggregation layer (useOperationalGaps) to batch-fetch
   * credentials for all persons in a single call, avoiding N per-person queries.
   *
   * Returns active credentials only (IsActive === true), unordered.
   * The caller groups by HolderPersonID for per-person evaluation.
   */
  listAllCredentials(): Promise<Credential[]>;
}
