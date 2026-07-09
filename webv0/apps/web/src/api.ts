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
import type {
  AgreementDto,
  AgreementTermDto,
  ApparelDto,
  ApprovalDto,
  CredentialDto,
  EntityDto,
  FxRateDto,
  JourneyDto,
  KitDto,
  MeResponse,
  MemberDto,
  MissionBudgetDto,
  MissionDto,
  MissionFinanceSummaryDto,
  MissionLineDto,
  MissionPnlDto,
  MissionParticipantDto,
  PersonDto,
  PersonMissionMembershipDto,
  SituationResponse,
  SubmitAddAgreementRequest,
  SubmitAddCredentialRequest,
  SubmitAddMissionParticipantRequest,
  SubmitDeactivateCredentialRequest,
  SubmitInitiateJourneyRequest,
  SubmitMemberChangeRequest,
  SubmitRemoveMissionParticipantRequest,
  SubmitRenewAgreementRequest,
  SubmitTerminateAgreementRequest,
} from '@c3web/api-contracts';
import type { AgreementTermKind, EquipmentTransition, MissionFinanceStage, MissionLineDirection, PaymentStatus } from '@c3web/domain';

export interface EquipmentCreateBody {
  name: string;
  category: string;
  size?: string | null;
  assignedPersonId?: string | null;
  notes?: string | null;
}
export interface EquipmentUpdateBody extends Partial<EquipmentCreateBody> {
  expectedVersion: number;
}

export interface EntityCreateBody {
  name: string;
  code?: string | null;
  jurisdiction: string;
  registrationId?: string | null;
  localCurrency: string;
}
export interface EntityUpdateBody extends Partial<EntityCreateBody> {
  expectedVersion: number;
}

export interface MissionCreateBody {
  name: string;
  code?: string | null;
  organizer?: string | null;
  city?: string | null;
  gameTitle?: string | null;
  startsOn: string; // plain ISO date
  endsOn?: string | null;
  notes?: string | null;
}
export interface MissionUpdateBody extends Partial<MissionCreateBody> {
  expectedVersion: number;
}

/** Finance S4 + S2: mission income/expense lines (direction+category immutable on update). */
export interface MissionLineCreateBody {
  direction: MissionLineDirection;
  category: string;
  label: string;
  amountMinor: number;
  currency: string;
}
export interface MissionLineUpdateBody {
  expectedVersion: number;
  label?: string;
  amountMinor?: number;
  currency?: string;
}
/** S2: the audited income-payment update. */
export interface MissionLinePaymentBody {
  expectedVersion: number;
  paymentStatus: PaymentStatus;
  receivedAmountMinor?: number | null;
  receivedUsdPerUnit?: number | null;
  paymentSourceLabel?: string | null;
  refNo?: string | null;
}
/** S2: set/clear one budget cell (null amount clears). */
export interface MissionBudgetBody {
  direction: MissionLineDirection;
  category: string;
  currency: string;
  amountMinor: number | null;
}

/** NON-MATERIAL agreement patch (material terms move through governed ops). */
export interface AgreementUpdateBody {
  expectedVersion: number;
  agreementCode?: string | null;
  agreementType?: string;
  linkedAgreementId?: string | null;
  notes?: string | null;
}

/** Finance S3.5: governed term changes carry the value set (monetary XOR percent). */
export interface SubmitAddTermBody {
  agreementId: string;
  kind: AgreementTermKind;
  amountMinor?: number | null;
  currency?: string | null;
  percentBps?: number | null;
  label?: string | null;
}
export interface SubmitUpdateTermBody {
  agreementId: string;
  termId: string;
  amountMinor?: number | null;
  currency?: string | null;
  percentBps?: number | null;
  label?: string | null;
}
export interface SubmitRemoveTermBody {
  agreementId: string;
  termId: string;
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
    withdrawApproval: (id: string, expectedVersion: number) => request<{ approval: ApprovalDto }>('POST', `/api/v1/approvals/${id}/withdraw`, { expectedVersion }),
    execute: (id: string, expectedVersion: number) => request<{ approval: ApprovalDto; person: PersonDto | null; idempotent: boolean }>('POST', `/api/v1/approvals/${id}/execute`, { expectedVersion }),
    // Sprint 35 tenant-admin: member directory + governed member changes.
    listMembers: () => request<{ members: MemberDto[] }>('GET', '/api/v1/members'),
    submitMemberChange: (payload: SubmitMemberChangeRequest['payload'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/members/changes', { payload, ...(reason ? { reason } : {}) }),
    // Sprint 36: credentials.
    listCredentials: () => request<{ credentials: CredentialDto[] }>('GET', '/api/v1/credentials'),
    personCredentials: (personId: string) => request<{ credentials: CredentialDto[] }>('GET', `/api/v1/people/${personId}/credentials`),
    submitAddCredential: (input: SubmitAddCredentialRequest['input'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/credentials/requests', { input, ...(reason ? { reason } : {}) }),
    submitDeactivateCredential: (input: SubmitDeactivateCredentialRequest['input'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/credentials/deactivations', { input, ...(reason ? { reason } : {}) }),
    // Sprint 37: journeys.
    listJourneys: () => request<{ journeys: JourneyDto[] }>('GET', '/api/v1/journeys'),
    personJourneys: (personId: string) => request<{ journeys: JourneyDto[] }>('GET', `/api/v1/people/${personId}/journeys`),
    submitInitiateJourney: (input: SubmitInitiateJourneyRequest['input'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/journeys/requests', { input, ...(reason ? { reason } : {}) }),
    transitionJourney: (journeyId: string, action: 'suspend' | 'resume' | 'complete' | 'cancel', expectedVersion: number, reason?: string) =>
      request<{ journey: JourneyDto }>('POST', `/api/v1/journeys/${journeyId}/transitions/${action}`, {
        expectedVersion,
        ...(reason ? { reason } : {}),
      }),
    // Sprint 38: equipment (direct CRUD).
    listKit: () => request<{ kit: KitDto[] }>('GET', '/api/v1/kit'),
    createKit: (body: EquipmentCreateBody) => request<{ kit: KitDto }>('POST', '/api/v1/kit', body),
    updateKit: (kitId: string, body: EquipmentUpdateBody) => request<{ kit: KitDto }>('POST', `/api/v1/kit/${kitId}`, body),
    deactivateKit: (kitId: string, expectedVersion: number) =>
      request<{ kit: KitDto }>('POST', `/api/v1/kit/${kitId}/deactivate`, { expectedVersion }),
    transitionKit: (kitId: string, action: EquipmentTransition, expectedVersion: number) =>
      request<{ kit: KitDto }>('POST', `/api/v1/kit/${kitId}/transitions/${action}`, { expectedVersion }),
    // Sprint 39: missions (direct-audited shell + governed participants).
    listMissions: () => request<{ missions: MissionDto[] }>('GET', '/api/v1/missions'),
    getMission: (missionId: string) => request<{ mission: MissionDto }>('GET', `/api/v1/missions/${missionId}`),
    missionParticipants: (missionId: string) =>
      request<{ participants: MissionParticipantDto[] }>('GET', `/api/v1/missions/${missionId}/participants`),
    missionAudit: (missionId: string) => request<{ events: AuditEventDto[] }>('GET', `/api/v1/missions/${missionId}/audit`),
    createMission: (body: MissionCreateBody) => request<{ mission: MissionDto }>('POST', '/api/v1/missions', body),
    updateMission: (missionId: string, body: MissionUpdateBody) =>
      request<{ mission: MissionDto }>('POST', `/api/v1/missions/${missionId}`, body),
    deactivateMission: (missionId: string, expectedVersion: number) =>
      request<{ mission: MissionDto }>('POST', `/api/v1/missions/${missionId}/deactivate`, { expectedVersion }),
    submitAddMissionParticipant: (input: SubmitAddMissionParticipantRequest['input'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/missions/participants/requests', { input, ...(reason ? { reason } : {}) }),
    submitRemoveMissionParticipant: (input: SubmitRemoveMissionParticipantRequest['input'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/missions/participants/removals', { input, ...(reason ? { reason } : {}) }),
    // Finance S4 + S2: mission P&L (canViewFinancials; lines direct-audited).
    missionPnl: (missionId: string) =>
      request<{ lines: MissionLineDto[]; budgets: MissionBudgetDto[]; pnl: MissionPnlDto }>('GET', `/api/v1/missions/${missionId}/pnl`),
    missionsFinanceSummary: () => request<MissionFinanceSummaryDto>('GET', '/api/v1/missions/finance-summary'),
    setMissionLinePayment: (missionId: string, lineId: string, body: MissionLinePaymentBody) =>
      request<{ line: MissionLineDto }>('POST', `/api/v1/missions/${missionId}/lines/${lineId}/payment`, body),
    setMissionBudget: (missionId: string, body: MissionBudgetBody) =>
      request<{ budget: MissionBudgetDto | null }>('POST', `/api/v1/missions/${missionId}/budgets`, body),
    setMissionFinanceStage: (missionId: string, expectedVersion: number, stage: MissionFinanceStage) =>
      request<{ mission: MissionDto }>('POST', `/api/v1/missions/${missionId}/finance-stage`, { expectedVersion, stage }),
    addMissionLine: (missionId: string, body: MissionLineCreateBody) =>
      request<{ line: MissionLineDto }>('POST', `/api/v1/missions/${missionId}/lines`, body),
    updateMissionLine: (missionId: string, lineId: string, body: MissionLineUpdateBody) =>
      request<{ line: MissionLineDto }>('POST', `/api/v1/missions/${missionId}/lines/${lineId}`, body),
    removeMissionLine: (missionId: string, lineId: string, expectedVersion: number) =>
      request<{ line: MissionLineDto }>('POST', `/api/v1/missions/${missionId}/lines/${lineId}/remove`, { expectedVersion }),
    // Finance S2: set/clear a participant's per-diem daily rate (direct-audited).
    setParticipantPerDiem: (missionId: string, personId: string, perDiemAmountMinor: number | null, perDiemCurrency: string | null) =>
      request<{ participant: MissionParticipantDto }>('POST', `/api/v1/missions/${missionId}/participants/${personId}/per-diem`, {
        perDiemAmountMinor,
        perDiemCurrency,
      }),
    // Sprint 41: agreements (governed material lifecycle + direct patch).
    listAgreements: () => request<{ agreements: AgreementDto[] }>('GET', '/api/v1/agreements'),
    getAgreement: (agreementId: string) => request<{ agreement: AgreementDto }>('GET', `/api/v1/agreements/${agreementId}`),
    agreementAudit: (agreementId: string) => request<{ events: AuditEventDto[] }>('GET', `/api/v1/agreements/${agreementId}/audit`),
    personAgreements: (personId: string) => request<{ agreements: AgreementDto[] }>('GET', `/api/v1/people/${personId}/agreements`),
    // Sprint 42: the person hub.
    personMissionMemberships: (personId: string) =>
      request<{ missions: PersonMissionMembershipDto[] }>('GET', `/api/v1/people/${personId}/missions`),
    personApprovals: (personId: string) => request<{ approvals: ApprovalDto[] }>('GET', `/api/v1/people/${personId}/approvals`),
    // Sprint 43: the Situation Room.
    situation: () => request<SituationResponse>('GET', '/api/v1/situation'),
    submitAddAgreement: (input: SubmitAddAgreementRequest['input'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/agreements/requests', { input, ...(reason ? { reason } : {}) }),
    submitRenewAgreement: (input: SubmitRenewAgreementRequest['input'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/agreements/renewals', { input, ...(reason ? { reason } : {}) }),
    submitTerminateAgreement: (input: SubmitTerminateAgreementRequest['input'], reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/agreements/terminations', { input, ...(reason ? { reason } : {}) }),
    updateAgreement: (agreementId: string, body: AgreementUpdateBody) =>
      request<{ agreement: AgreementDto }>('POST', `/api/v1/agreements/${agreementId}`, body),
    // Finance S3 read + S3.5 governed writes: term money is material, so changes
    // ride the approval pipeline (submit → owner executes).
    agreementTerms: (agreementId: string) =>
      request<{ terms: AgreementTermDto[] }>('GET', `/api/v1/agreements/${agreementId}/terms`),
    submitAddAgreementTerm: (input: SubmitAddTermBody, reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/agreements/terms/requests', { input, ...(reason ? { reason } : {}) }),
    submitUpdateAgreementTerm: (input: SubmitUpdateTermBody, reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/agreements/terms/updates', { input, ...(reason ? { reason } : {}) }),
    submitRemoveAgreementTerm: (input: SubmitRemoveTermBody, reason?: string) =>
      request<{ approval: ApprovalDto }>('POST', '/api/v1/agreements/terms/removals', { input, ...(reason ? { reason } : {}) }),
    // S48: entities (direct-audited).
    listEntities: () => request<{ entities: EntityDto[] }>('GET', '/api/v1/entities'),
    createEntity: (body: EntityCreateBody) => request<{ entity: EntityDto }>('POST', '/api/v1/entities', body),
    updateEntity: (entityId: string, body: EntityUpdateBody) =>
      request<{ entity: EntityDto }>('POST', `/api/v1/entities/${entityId}`, body),
    deactivateEntity: (entityId: string, expectedVersion: number) =>
      request<{ entity: EntityDto }>('POST', `/api/v1/entities/${entityId}/deactivate`, { expectedVersion }),
    reactivateEntity: (entityId: string, expectedVersion: number) =>
      request<{ entity: EntityDto }>('POST', `/api/v1/entities/${entityId}/reactivate`, { expectedVersion }),
    // Finance S1: FX rates.
    listFxRates: () => request<{ rates: FxRateDto[] }>('GET', '/api/v1/fx-rates'),
    setFxRate: (currency: string, usdPerUnit: number) =>
      request<{ rate: FxRateDto }>('POST', '/api/v1/fx-rates', { currency, usdPerUnit }),
    listApparel: () => request<{ apparel: ApparelDto[] }>('GET', '/api/v1/apparel'),
    createApparel: (body: EquipmentCreateBody) => request<{ apparel: ApparelDto }>('POST', '/api/v1/apparel', body),
    updateApparel: (apparelId: string, body: EquipmentUpdateBody) =>
      request<{ apparel: ApparelDto }>('POST', `/api/v1/apparel/${apparelId}`, body),
    deactivateApparel: (apparelId: string, expectedVersion: number) =>
      request<{ apparel: ApparelDto }>('POST', `/api/v1/apparel/${apparelId}/deactivate`, { expectedVersion }),
    transitionApparel: (apparelId: string, action: EquipmentTransition, expectedVersion: number) =>
      request<{ apparel: ApparelDto }>('POST', `/api/v1/apparel/${apparelId}/transitions/${action}`, { expectedVersion }),
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
export type { AgreementDto, AgreementTermDto, ApparelDto, ApprovalDto, CredentialDto, JourneyDto, KitDto, MemberDto, MissionBudgetDto, MissionDto, MissionFinanceSummaryDto, MissionLineDto, MissionPnlDto, MissionParticipantDto, PersonDto, MeResponse };
