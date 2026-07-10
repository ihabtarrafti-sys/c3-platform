/**
 * env.test.ts — fail-closed production guarantees at the configuration boundary.
 */
import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/env';

const base = {
  DATABASE_URL: 'postgres://c3_app:pw@db:5432/c3web',
};
const entraVars = {
  AUTH_PROVIDER: 'entra',
  ENTRA_TENANT_ID: '11111111-2222-3333-4444-555555555555',
  ENTRA_ISSUER: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0',
  ENTRA_AUDIENCE: 'api://c3web',
  ENTRA_JWKS_URI: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/discovery/v2.0/keys',
  DATABASE_AUTH_URL: 'postgres://c3_auth:pw@db:5432/c3web',
};

describe('production fail-closed guarantees', () => {
  it('forbids AUTH_PROVIDER=dev in production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', AUTH_PROVIDER: 'dev', DEV_AUTH_SECRET: 'x'.repeat(20) } as NodeJS.ProcessEnv),
    ).toThrow(/forbidden/i);
  });

  it('fails when NODE_ENV=production and no provider is set (default dev is refused)', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/forbidden/i);
  });

  it('fails closed when DEV_AUTH_SECRET is merely PRESENT in production (even with entra)', () => {
    expect(() =>
      loadEnv({ ...base, ...entraVars, NODE_ENV: 'production', CORS_ORIGIN: 'https://staging.c3hq.org', DEV_AUTH_SECRET: 'leftover' } as NodeJS.ProcessEnv),
    ).toThrow(/DEV_AUTH_SECRET must not be set in production/);
  });

  it('requires an explicit CORS origin in production', () => {
    expect(() => loadEnv({ ...base, ...entraVars, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/CORS_ORIGIN/);
  });

  it('refuses the privileged migration credentials in a production API process', () => {
    expect(() =>
      loadEnv({
        ...base,
        ...entraVars,
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://staging.c3hq.org',
        DATABASE_ADMIN_URL: 'postgres://c3_admin:pw@db:5432/c3web',
      } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_ADMIN_URL must not be provided to the production API/);
  });

  // S4: production also requires the documents R2 configuration.
  const r2Vars = {
    R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET_DOCUMENTS: 'c3-docs',
  };

  it('accepts a correct production entra configuration', () => {
    const env = loadEnv({
      ...base,
      ...entraVars,
      ...r2Vars,
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://staging.c3hq.org',
    } as NodeJS.ProcessEnv);
    expect(env.authProvider).toBe('entra');
    expect(env.databaseAdminUrl).toBeUndefined();
    expect(env.databaseAuthUrl).toContain('c3_auth');
    expect(env.documents.driver).toBe('r2');
  });

  it('S4 fail-closed: production without R2 refuses; partial R2 config refuses anywhere', () => {
    expect(() =>
      loadEnv({ ...base, ...entraVars, NODE_ENV: 'production', CORS_ORIGIN: 'https://staging.c3hq.org' } as NodeJS.ProcessEnv),
    ).toThrow(/documents R2 configuration/);
    expect(() =>
      loadEnv({
        ...base,
        ...entraVars,
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://staging.c3hq.org',
        R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      } as NodeJS.ProcessEnv),
    ).toThrow(/partial/);
  });

  it('S10 fail-closed: no SMTP config → smtp null (rows-only); partial SMTP refuses', () => {
    expect(loadEnv({ ...base, ...entraVars } as NodeJS.ProcessEnv).smtp).toBeNull();
    expect(() => loadEnv({ ...base, ...entraVars, SMTP_HOST: 'smtp.example.com' } as NodeJS.ProcessEnv)).toThrow(/partial/i);
    const full = loadEnv({
      ...base,
      ...entraVars,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'secret',
      SMTP_FROM: 'c3@example.com',
    } as NodeJS.ProcessEnv);
    expect(full.smtp).toEqual({ host: 'smtp.example.com', port: 587, user: 'mailer', pass: 'secret', from: 'c3@example.com' });
  });

  it('Tier 0.5 fail-closed: no BACKUP_STATUS config → null (tile says not configured); partial refuses', () => {
    expect(loadEnv({ ...base, ...entraVars } as NodeJS.ProcessEnv).backupStatus).toBeNull();
    expect(() => loadEnv({ ...base, ...entraVars, BACKUP_STATUS_R2_BUCKET: 'c3-backups' } as NodeJS.ProcessEnv)).toThrow(/partial/i);
    const full = loadEnv({
      ...base,
      ...entraVars,
      BACKUP_STATUS_R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      BACKUP_STATUS_R2_ACCESS_KEY_ID: 'ak',
      BACKUP_STATUS_R2_SECRET_ACCESS_KEY: 'sk',
      BACKUP_STATUS_R2_BUCKET: 'c3-backups',
    } as NodeJS.ProcessEnv);
    expect(full.backupStatus).toEqual({ endpoint: 'https://acct.r2.cloudflarestorage.com', accessKeyId: 'ak', secretAccessKey: 'sk', bucket: 'c3-backups' });
  });
});

describe('provider configuration guards', () => {
  it('entra refuses common/organizations/consumers issuers (tenant-specific v2 only)', () => {
    const base2 = { ...base, ...entraVars, NODE_ENV: 'production', CORS_ORIGIN: 'https://x' };
    for (const bad of ['common', 'organizations', 'consumers']) {
      expect(() =>
        loadEnv({ ...base2, ENTRA_ISSUER: 'https://login.microsoftonline.com/' + bad + '/v2.0' } as NodeJS.ProcessEnv),
      ).toThrow(/tenant-specific/);
    }
  });

  it('entra requires the issuer to embed ENTRA_TENANT_ID and end with /v2.0', () => {
    const base2 = { ...base, ...entraVars, NODE_ENV: 'production', CORS_ORIGIN: 'https://x' };
    expect(() => loadEnv({ ...base2, ENTRA_ISSUER: 'https://login.microsoftonline.com/other-tenant/v2.0' } as NodeJS.ProcessEnv)).toThrow(/ENTRA_TENANT_ID/);
    expect(() => loadEnv({ ...base2, ENTRA_ISSUER: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/' } as NodeJS.ProcessEnv)).toThrow(/v2/);
  });

  it('entra requires ENTRA_TENANT_ID', () => {
    const { ENTRA_TENANT_ID: _omit, ...noTid } = entraVars;
    expect(() => loadEnv({ ...base, ...noTid, NODE_ENV: 'production', CORS_ORIGIN: 'https://x' } as NodeJS.ProcessEnv)).toThrow(/ENTRA_TENANT_ID/);
  });

  it('entra requires issuer/audience/jwks', () => {
    expect(() => loadEnv({ ...base, AUTH_PROVIDER: 'entra' } as NodeJS.ProcessEnv)).toThrow(/ENTRA_ISSUER/);
  });

  it('entra requires a membership directory connection', () => {
    const { DATABASE_AUTH_URL: _omit, ...noAuth } = entraVars;
    expect(() => loadEnv({ ...base, ...noAuth, NODE_ENV: 'production', CORS_ORIGIN: 'https://x' } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_AUTH_URL/,
    );
  });

  it('dev provider requires a sufficiently long secret and the dev directory', () => {
    expect(() => loadEnv({ ...base, AUTH_PROVIDER: 'dev', DEV_AUTH_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/16 characters/);
    expect(() => loadEnv({ ...base, AUTH_PROVIDER: 'dev', DEV_AUTH_SECRET: 'x'.repeat(20) } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_ADMIN_URL/,
    );
  });

  it('TRUST_PROXY defaults to false and must be explicitly enabled', () => {
    const devOk = {
      ...base,
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: 'x'.repeat(20),
      DATABASE_ADMIN_URL: 'postgres://a:b@db:5432/c3web',
    };
    expect(loadEnv(devOk as NodeJS.ProcessEnv).trustProxy).toBe(false);
    expect(loadEnv({ ...devOk, TRUST_PROXY: 'true' } as NodeJS.ProcessEnv).trustProxy).toBe(true);
  });
});
