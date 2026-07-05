/**
 * auth.test.ts — deterministic frontend auth unit tests (fake AuthClient; no
 * real MSAL/network). Covers: MSAL config construction, token attachment,
 * silent success, interaction-required hand-off, 401-once semantics, 403 as
 * authorization (no reauth), logout, refresh/deep-link restoration, safe
 * callback path handling, and no token logging.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildMsalConfig, apiTokenRequest } from '../src/auth/msalConfig';
import { createDevAuthClient } from '../src/auth/devClient';
import { createApiClient } from '../src/api';
import { safeInternalPath } from '../src/pages/AuthCallback';
import type { AuthClient, AuthSession } from '../src/auth/types';

const ENTRA = {
  clientId: 'spa-client-id',
  tenantId: 'aaaaaaaa-1111-2222-3333-444444444444',
  origin: 'https://staging.c3hq.org/',
  apiScope: 'api://api-client-id/C3.Access',
};

describe('1. MSAL configuration construction', () => {
  it('builds a single-tenant PKCE redirect configuration', () => {
    const cfg = buildMsalConfig(ENTRA);
    expect(cfg.auth.clientId).toBe('spa-client-id');
    expect(cfg.auth.authority).toBe(`https://login.microsoftonline.com/${ENTRA.tenantId}`);
    expect(cfg.auth.redirectUri).toBe('https://staging.c3hq.org/auth/callback');
    expect(cfg.auth.postLogoutRedirectUri).toBe('https://staging.c3hq.org/');
    expect(cfg.cache?.cacheLocation).toBe('sessionStorage');
    expect(apiTokenRequest(ENTRA)).toEqual({ scopes: ['api://api-client-id/C3.Access'] });
  });
  it('refuses incomplete configuration', () => {
    expect(() => buildMsalConfig({ ...ENTRA, clientId: '' })).toThrow(/clientId/);
    expect(() => buildMsalConfig({ ...ENTRA, apiScope: '' })).toThrow(/apiScope/);
  });
  it('never uses common/organizations authorities', () => {
    const cfg = buildMsalConfig(ENTRA);
    expect(cfg.auth.authority).not.toMatch(/common|organizations|consumers/);
  });
});

function fakeAuth(over: Partial<AuthClient> = {}): AuthClient {
  const session: AuthSession = { identity: 'ops@geekay.com', displayName: 'Ops' };
  return {
    kind: 'entra',
    initialize: vi.fn(async () => session),
    signIn: vi.fn(async () => {}),
    completeRedirect: vi.fn(async () => ({ session, intendedPath: '/approvals/APR-0001' })),
    signOut: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => 'token-abc'),
    reauthenticate: vi.fn(async () => {}),
    getSession: vi.fn(() => session),
    ...over,
  };
}

function fetchStub(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('5/6. token attachment + silent success', () => {
  it('attaches Authorization: Bearer from the AuthClient to API calls', async () => {
    const auth = fakeAuth();
    const fetchImpl = fetchStub(200, { people: [] });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: auth.getAccessToken, onUnauthorized: auth.reauthenticate, fetchImpl });
    await api.listPeople();
    expect(auth.getAccessToken).toHaveBeenCalled();
    const [, init] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-abc');
  });
});

describe('7. interaction-required reauthentication', () => {
  it('a 401 hands off to reauthenticate exactly once and does NOT retry the request', async () => {
    const auth = fakeAuth();
    const fetchImpl = fetchStub(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' }, correlationId: 'c1' });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: auth.getAccessToken, onUnauthorized: auth.reauthenticate, fetchImpl });
    await expect(api.listPeople()).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED', correlationId: 'c1' });
    expect(auth.reauthenticate).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never auto-retried
  });

  it('a 403 is an authorization denial: surfaced truthfully, NO reauthentication', async () => {
    const auth = fakeAuth();
    const fetchImpl = fetchStub(403, { error: { code: 'FORBIDDEN', message: 'not your role' }, correlationId: 'c2' });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: auth.getAccessToken, onUnauthorized: auth.reauthenticate, fetchImpl });
    await expect(api.submitAddPerson({ fullName: 'X' })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(auth.reauthenticate).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('silent-token null still sends the request unauthenticated (server decides)', async () => {
    const auth = fakeAuth({ getAccessToken: vi.fn(async () => null) });
    const fetchImpl = fetchStub(401, { error: { code: 'UNAUTHENTICATED', message: 'no token' } });
    const api = createApiClient({ baseUrl: 'https://api.test', getToken: auth.getAccessToken, onUnauthorized: auth.reauthenticate, fetchImpl });
    await expect(api.listPeople()).rejects.toMatchObject({ status: 401 });
    const [, init] = (fetchImpl.mock.calls[0] ?? []) as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});

describe('8. logout (dev client reference implementation)', () => {
  it('signOut clears the persisted session and token', async () => {
    const dev = createDevAuthClient();
    dev.adoptDevLogin('tok-1', { identity: 'ops@alpha.com', displayName: 'Ops' });
    expect(await dev.getAccessToken()).toBe('tok-1');
    await dev.signOut();
    expect(await dev.getAccessToken()).toBeNull();
    expect(dev.getSession()).toBeNull();
    expect(await dev.initialize()).toBeNull();
  });

  it('reauthenticate (dev semantics) drops the session so sign-in renders', async () => {
    const dev = createDevAuthClient();
    dev.adoptDevLogin('tok-2', { identity: 'ops@alpha.com', displayName: 'Ops' });
    await dev.reauthenticate();
    expect(await dev.getAccessToken()).toBeNull();
  });
});

describe('9. refresh / deep-link restoration', () => {
  it('initialize restores a persisted dev session after a refresh', async () => {
    const dev = createDevAuthClient();
    dev.adoptDevLogin('tok-3', { identity: 'owner@alpha.com', displayName: 'Owner' });
    const fresh = createDevAuthClient(); // simulates a new page load
    const restored = await fresh.initialize();
    expect(restored).toEqual({ identity: 'owner@alpha.com', displayName: 'Owner' });
    await fresh.signOut();
  });

  it('3. the callback restores only safe internal paths (open-redirect guard)', () => {
    expect(safeInternalPath('/approvals/APR-0001')).toBe('/approvals/APR-0001');
    expect(safeInternalPath(null)).toBe('/people');
    expect(safeInternalPath('https://evil.example')).toBe('/people');
    expect(safeInternalPath('//evil.example')).toBe('/people');
  });
});

describe('10. no token logging', () => {
  it('API errors and console output never contain the bearer token', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
    const spyErr = vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.join(' ')));
    try {
      const auth = fakeAuth();
      const fetchImpl = fetchStub(500, { error: { code: 'INTERNAL', message: 'boom' } });
      const api = createApiClient({ baseUrl: 'https://api.test', getToken: auth.getAccessToken, onUnauthorized: auth.reauthenticate, fetchImpl });
      const err = await api.listPeople().catch((e) => e as Error);
      expect(String(err)).not.toContain('token-abc');
      expect(JSON.stringify(err)).not.toContain('token-abc');
      expect(logs.join('\n')).not.toContain('token-abc');
    } finally {
      spy.mockRestore();
      spyErr.mockRestore();
    }
  });
});
