/**
 * api.ts — the typed HTTP client. The web app talks ONLY to the API over HTTP;
 * it never imports persistence or SQL. Types come from @c3web/api-contracts.
 *
 * Auth behaviour (Phase 2B):
 *   - every request acquires the API access token from the AuthClient
 *     (silent; Entra = MSAL cache/refresh, dev = stored dev token);
 *   - Authorization: Bearer is attached; the token is NEVER logged and never
 *     placed in URLs or error objects;
 *   - 401 => ONE approved reauthentication hand-off via the AuthClient
 *     (Entra: interactive redirect; dev: session cleared -> sign-in screen).
 *     Governed mutations are NEVER auto-retried;
 *   - 403 => an authorization denial (surfaced truthfully; NOT a sign-in
 *     problem);
 *   - server correlation ids are preserved onto ApiError.
 */
import type { ApprovalDto, MeResponse, MemberDto, PersonDto, SubmitMemberChangeRequest } from '@c3web/api-contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
  }
}

export interface ApiClientDeps {
  baseUrl: string;
  getToken(): Promise<string | null>;
  /** Invoked once on a 401 (expired/invalid session). Must NOT retry the request. */
  onUnauthorized(intendedPath: string): Promise<void>;
  fetchImpl?: typeof fetch;
}

export function createApiClient(deps: ApiClientDeps) {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await deps.getToken();
    const res = await doFetch(deps.baseUrl + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = json?.error;
      const apiError = new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? res.statusText, json?.correlationId);
      if (res.status === 401) {
        // Expired/invalid session: hand off to the approved reauthentication
        // path exactly once. The request itself is NOT retried.
        const intended = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
        await deps.onUnauthorized(intended);
      }
      throw apiError;
    }
    return json as T;
  }

  return {
    request,
    me: () => request<MeResponse>('GET', '/api/v1/me'),
    listPeople: () => request<{ people: PersonDto[] }>('GET', '/api/v1/people'),
    getPerson: (id: string) => request<{ person: PersonDto }>('GET', `/api/v1/people/${id}`),
    personAudit: (id: string) => request<{ events: AuditEventDto[] }>('GET', `/api/v1/people/${id}/audit`),
    listApprovals: () => request<{ approvals: ApprovalDto[] }>('GET', '/api/v1/approvals'),
    getApproval: (id: string) => request<{ approval: ApprovalDto }>('GET', `/api/v1/approvals/${id}`),
    approvalEvents: (id: string) => request<{ events: ApprovalEventDto[] }>('GET', `/api/v1/approvals/${id}/events`),
    submitAddPerson: (input: Record<string, unknown>) => request<{ approval: ApprovalDto }>('POST', '/api/v1/approvals', { input }),
    beginReview: (id: string, expectedVersion: number) => request<{ approval: ApprovalDto }>('POST', `/api/v1/approvals/${id}/begin-review`, { expectedVersion }),
    approve: (id: string, expectedVersion: number) => request<{ approval: ApprovalDto }>('POST', `/api/v1/approvals/${id}/approve`, { expectedVersion }),
    reject: (id: string, expectedVersion: number, reason: string) => request<{ approval: ApprovalDto }>('POST', `/api/v1/approvals/${id}/reject`, { expectedVersion, reason }),
    execute: (id: string, expectedVersion: number) => request<{ approval: ApprovalDto; person: PersonDto | null; idempotent: boolean }>('POST', `/api/v1/approvals/${id}/execute`, { expectedVersion }),
    // Sprint 35 tenant-admin: member directory + governed member changes.
    listMembers: () => request<{ members: MemberDto[] }>('GET', '/api/v1/members'),
    submitMemberChange: (payload: SubmitMemberChangeRequest['payload'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/members/changes', { payload, ...(reason ? { reason } : {}) }),
  };
}

export interface ApprovalEventDto {
  approvalId: string;
  fromStatus: string | null;
  toStatus: string;
  actor: string;
  at: string;
  note: string | null;
}
export interface AuditEventDto {
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type { ApprovalDto, MemberDto, PersonDto, MeResponse };
