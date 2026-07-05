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
  ENTRA_ISSUER: 'https://login.microsoftonline.com/t/v2.0',
  ENTRA_AUDIENCE: 'api://c3web',
  ENTRA_JWKS_URI: 'https://login.microsoftonline.com/t/discovery/v2.0/keys',
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

  it('accepts a correct production entra configuration', () => {
    const env = loadEnv({
      ...base,
      ...entraVars,
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://staging.c3hq.org',
    } as NodeJS.ProcessEnv);
    expect(env.authProvider).toBe('entra');
    expect(env.databaseAdminUrl).toBeUndefined();
    expect(env.databaseAuthUrl).toContain('c3_auth');
  });
});

describe('provider configuration guards', () => {
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
