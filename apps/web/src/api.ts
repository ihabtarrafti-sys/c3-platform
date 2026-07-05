/**
 * api.ts — the typed HTTP client. The web app talks ONLY to the API over HTTP;
 * it never imports persistence, domain-write logic, or SQL. Types come from the
 * shared @c3web/api-contracts package.
 */
import type {
  ApprovalDto,
  MeResponse,
  PersonDto,
} from '@c3web/api-contracts';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000';
const TOKEN_KEY = 'c3web.token';

let token: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

export function setToken(t: string | null): void {
  token = t;
  if (typeof localStorage === 'undefined') return;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getToken(): string | null {
  return token;
}

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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
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
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? res.statusText, json?.correlationId);
  }
  return json as T;
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

export const api = {
  devLogin: (body: { email: string; displayName?: string; role: string; tenantSlug: string }) =>
    request<{ token: string; identity: string; displayName: string; role: string; tenantSlug: string }>('POST', '/api/v1/dev/login', body),
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
};

export type { ApprovalDto, PersonDto, MeResponse };
