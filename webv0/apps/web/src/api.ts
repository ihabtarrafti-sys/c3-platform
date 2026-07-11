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
  DocumentDto,
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
  DataQualityReportDto,
  InvoiceDto,
  TeamDto,
  TeamMembershipDto,
  DistributionDto,
  DistributionShareDto,
  ClaimDto,
  NotificationDto,
  DelegationDto,
  BeneficiaryDto,
  PerDiemPresetsDto,
  RecycleItemDto,
  ActivityItemDto,
  CalendarItemDto,
  CommentDto,
  IntakeLinkDto,
  IntakeSubmissionDto,
  PersonDto,
  PersonMissionMembershipDto,
  SearchResultsDto,
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
  teamId?: string | null;
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
/** S2 + M-03: set/clear one budget cell (null amount clears). expectedVersion
 * is the cell version the caller read — null asserts the cell was EMPTY. */
export interface MissionBudgetBody {
  direction: MissionLineDirection;
  category: string;
  currency: string;
  amountMinor: number | null;
  expectedVersion: number | null;
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
    /** Structured details from the error envelope (e.g. S5 per-row import errors). */
    public readonly details?: Record<string, unknown>,
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

  async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = await deps.getToken();
    const res = await doFetch(deps.baseUrl + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // S3.1/M-04: callers may cancel superseded requests (search keystrokes).
      ...(signal ? { signal } : {}),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = json?.error;
      const apiError = new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? res.statusText, json?.correlationId, err?.details);
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

  /** Multipart upload (S4): the browser sets the boundary; auth header only. */
  async function upload<T>(path: string, form: FormData): Promise<T> {
    const token = await deps.getToken();
    const res = await doFetch(deps.baseUrl + path, {
      method: 'POST',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: form,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = json?.error;
      throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? res.statusText, json?.correlationId, err?.details);
    }
    return json as T;
  }

  /** Binary download (S4): bytes + the server-stated filename. */
  async function download(path: string): Promise<{ blob: Blob; fileName: string }> {
    const token = await deps.getToken();
    const res = await doFetch(deps.baseUrl + path, {
      method: 'GET',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const json = await res.json();
        message = json?.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, 'ERROR', message);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
    return { blob: await res.blob(), fileName };
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
    // Track B1: request corrections — polish before review; revise after.
    editApproval: (id: string, expectedVersion: number, input: Record<string, unknown>) =>
      request<{ approval: ApprovalDto }>('POST', `/api/v1/approvals/${id}/edit`, { expectedVersion, input }),
    reviseApproval: (id: string, expectedVersion: number, input: Record<string, unknown>, reason?: string | null) =>
      request<{ approval: ApprovalDto; superseded: string }>('POST', `/api/v1/approvals/${id}/revise`, { expectedVersion, input, reason }),
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
    // Finance S2 + M-03: set/clear a participant's per-diem daily rate
    // (direct-audited, version-guarded — stale roster reads are refused).
    setParticipantPerDiem: (missionId: string, personId: string, perDiemAmountMinor: number | null, perDiemCurrency: string | null, expectedVersion: number) =>
      request<{ participant: MissionParticipantDto }>('POST', `/api/v1/missions/${missionId}/participants/${personId}/per-diem`, {
        perDiemAmountMinor,
        perDiemCurrency,
        expectedVersion,
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
    // S3: global search (role-aware; denied domains simply absent).
    search: (q: string, signal?: AbortSignal) => request<SearchResultsDto>('GET', `/api/v1/search?q=${encodeURIComponent(q)}`, undefined, signal),
    // S5: import/export — export IS the template; staging returns the batch approval.
    stageImport: (domain: string, file: File) => {
      const form = new FormData();
      form.append('domain', domain);
      form.append('file', file, file.name);
      return upload<{ approval: ApprovalDto; domain: string; rowCount: number }>('/api/v1/imports', form);
    },
    downloadExport: (domain: string) => download(`/api/v1/exports/${encodeURIComponent(domain)}`),
    downloadTemplate: (domain: string) => download(`/api/v1/imports/templates/${encodeURIComponent(domain)}`),
    // S5 riders: the data-quality report (duplicates + review lists).
    dataQuality: () => request<DataQualityReportDto>('GET', '/api/v1/data-quality'),
    // S7: teams — org structure (direct-audited) + the finance-gated money view.
    listTeams: () => request<{ teams: TeamDto[] }>('GET', '/api/v1/teams'),
    getTeam: (teamId: string) => request<{ team: TeamDto }>('GET', `/api/v1/teams/${teamId}`),
    createTeam: (input: { name: string; code: string; kind: string; gameTitle?: string | null; notes?: string | null }) =>
      request<{ team: TeamDto }>('POST', '/api/v1/teams', input),
    updateTeam: (teamId: string, input: { expectedVersion: number; name: string; code: string; gameTitle?: string | null; notes?: string | null }) =>
      request<{ team: TeamDto }>('POST', `/api/v1/teams/${teamId}`, input),
    deactivateTeam: (teamId: string, expectedVersion: number) =>
      request<{ team: TeamDto }>('POST', `/api/v1/teams/${teamId}/deactivate`, { expectedVersion }),
    reactivateTeam: (teamId: string, expectedVersion: number) =>
      request<{ team: TeamDto }>('POST', `/api/v1/teams/${teamId}/reactivate`, { expectedVersion }),
    listTeamMembers: (teamId: string) => request<{ members: TeamMembershipDto[] }>('GET', `/api/v1/teams/${teamId}/members`),
    addTeamMember: (teamId: string, personId: string, role: string) =>
      request<{ member: TeamMembershipDto }>('POST', `/api/v1/teams/${teamId}/members`, { personId, role }),
    removeTeamMember: (teamId: string, personId: string, expectedVersion: number) =>
      request<{ member: TeamMembershipDto }>('POST', `/api/v1/teams/${teamId}/members/${personId}/remove`, { expectedVersion }),
    teamFinance: (teamId: string) => request<TeamFinanceResponse>('GET', `/api/v1/teams/${teamId}/finance`),
    teamAudit: (teamId: string) => request<{ events: AuditEventDto[] }>('GET', `/api/v1/teams/${teamId}/audit`),
    personTeams: (personId: string) => request<{ members: TeamMembershipDto[] }>('GET', `/api/v1/people/${personId}/teams`),
    // S8: distributions — allocate received money, mark payouts, revoke.
    missionDistributions: (missionId: string) => request<{ distributions: Array<{ distribution: DistributionDto; shares: DistributionShareDto[] }> }>('GET', `/api/v1/missions/${missionId}/distributions`),
    distributionSeed: (missionId: string) => request<{ rows: Array<{ personId: string; personName: string; suggestedBps: number | null; sourceTermId: string | null }> }>('GET', `/api/v1/distributions/seed?missionId=${missionId}`),
    createDistribution: (input: { missionId: string; lineId: string; orgShareBps: number; shares: Array<{ personId: string; shareBps: number }>; notes?: string | null }) => request<{ distribution: DistributionDto; shares: DistributionShareDto[] }>('POST', '/api/v1/distributions', input),
    revokeDistribution: (distributionId: string, reason: string, expectedVersion: number) => request<{ distribution: DistributionDto; shares: DistributionShareDto[] }>('POST', `/api/v1/distributions/${distributionId}/revoke`, { reason, expectedVersion }),
    // S12: credentials v2 (facts governed / details direct) + beneficiaries.
    submitCredentialFacts: (credentialId: string, input: { patch: Record<string, unknown>; reason?: string }) => request<{ approval: ApprovalDto }>('POST', '/api/v1/credentials/' + credentialId + '/facts-request', input),
    updateCredentialDetails: (credentialId: string, input: { expectedVersion: number; patch: Record<string, unknown> }) => request<{ credential: CredentialDto }>('PATCH', '/api/v1/credentials/' + credentialId, input),
    listBeneficiaries: () => request<{ beneficiaries: BeneficiaryDto[] }>('GET', '/api/v1/beneficiaries'),
    personBeneficiaries: (personId: string) => request<{ beneficiaries: BeneficiaryDto[] }>('GET', '/api/v1/people/' + personId + '/beneficiaries'),
    submitAddBeneficiary: (input: Record<string, unknown>, reason?: string) => request<{ approval: ApprovalDto }>('POST', '/api/v1/beneficiaries/requests', { input, reason }),
    submitUpdateBeneficiary: (beneficiaryId: string, input: { patch: Record<string, unknown>; reason?: string }) => request<{ approval: ApprovalDto }>('POST', '/api/v1/beneficiaries/' + beneficiaryId + '/update-request', input),
    submitRetireBeneficiary: (beneficiaryId: string, reason: string) => request<{ approval: ApprovalDto }>('POST', '/api/v1/beneficiaries/' + beneficiaryId + '/retire-request', { reason }),
    downloadBankForm: (personId: string) => download('/api/v1/people/' + personId + '/beneficiaries/bank-form'),
    // S11: people v2 — governed identity/lifecycle + direct operational.
    updatePersonOperational: (personId: string, input: { expectedVersion: number; patch: Record<string, unknown> }) => request<{ person: PersonDto }>('PATCH', '/api/v1/people/' + personId, input),
    submitPersonIdentity: (personId: string, input: { patch: Record<string, unknown>; reason?: string }) => request<{ approval: ApprovalDto }>('POST', '/api/v1/people/' + personId + '/identity-request', input),
    submitDeactivatePerson: (personId: string, reason: string) => request<{ approval: ApprovalDto }>('POST', '/api/v1/people/' + personId + '/deactivate-request', { reason }),
    submitReactivatePerson: (personId: string, reason: string) => request<{ approval: ApprovalDto }>('POST', '/api/v1/people/' + personId + '/reactivate-request', { reason }),
    // Tier 0.5: delegations + backup status (Settings).
    listDelegations: () => request<{ delegations: DelegationDto[] }>('GET', '/api/v1/delegations'),
    createDelegation: (input: { granteeIdentity: string; startsOn: string; endsOn: string; reason: string }) => request<{ delegation: DelegationDto }>('POST', '/api/v1/delegations', input),
    revokeDelegation: (delegationId: string, input: { expectedVersion: number; reason: string }) => request<{ delegation: DelegationDto }>('POST', `/api/v1/delegations/${delegationId}/revoke`, input),
    backupStatus: () => request<{ configured: boolean; healthy: boolean | null; lastSuccessUtc: string | null; ageHours: number | null; reason: string | null }>('GET', '/api/v1/settings/backup-status'),
    // HARDEN-2: per-diem presets (the S2 rider) — owner/ops quick-pick config.
    perDiemPresets: () => request<PerDiemPresetsDto>('GET', '/api/v1/settings/per-diem-presets'),
    // Track B2: the recycle bin — cross-domain soft-removed register + restore.
    recycleBin: () => request<{ items: RecycleItemDto[] }>('GET', '/api/v1/recycle-bin'),
    // Track B3: the activity feed — org journal over the audit stream.
    activityFeed: (cursor?: string | null, limit = 40) =>
      request<{ items: ActivityItemDto[]; nextCursor: string | null }>(
        'GET',
        `/api/v1/activity?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    // Track B: ops calendar / timeline (forward horizon).
    calendar: (horizon = 90) =>
      request<{ items: CalendarItemDto[]; horizonDays: number; todayIso: string }>('GET', `/api/v1/calendar?horizon=${horizon}`),
    // Track B4: contextual comments + @mentions on records.
    listComments: (subjectType: string, subjectId: string) =>
      request<{ comments: CommentDto[] }>('GET', `/api/v1/comments?subjectType=${subjectType}&subjectId=${encodeURIComponent(subjectId)}`),
    postComment: (subjectType: string, subjectId: string, body: string, mentions: string[]) =>
      request<{ comment: CommentDto }>('POST', '/api/v1/comments', { subjectType, subjectId, body, mentions }),

    // Track B6: guest intake (staff side). The public peek/submit are NOT here —
    // the guest page calls them directly (no bearer token).
    listIntakeLinks: () => request<{ links: IntakeLinkDto[] }>('GET', '/api/v1/intake/links'),
    createIntakeLink: (input: { kind: string; label?: string | null; expiresInHours?: number }) =>
      request<{ link: IntakeLinkDto; token: string }>('POST', '/api/v1/intake/links', input),
    revokeIntakeLink: (linkId: string) => request<{ link: IntakeLinkDto }>('POST', `/api/v1/intake/links/${linkId}/revoke`),
    listIntakeSubmissions: () => request<{ submissions: IntakeSubmissionDto[] }>('GET', '/api/v1/intake/submissions'),
    getIntakeSubmission: (id: string) => request<{ submission: IntakeSubmissionDto }>('GET', `/api/v1/intake/submissions/${id}`),
    promoteSubmission: (id: string, decisionNote?: string | null) =>
      request<{ approval: ApprovalDto; submission: IntakeSubmissionDto }>('POST', `/api/v1/intake/submissions/${id}/promote`, { decisionNote: decisionNote ?? null }),
    rejectSubmission: (id: string, decisionNote?: string | null) =>
      request<{ submission: IntakeSubmissionDto }>('POST', `/api/v1/intake/submissions/${id}/reject`, { decisionNote: decisionNote ?? null }),
    attachIntakeUploads: (id: string, uploadIds: string[]) =>
      request<{ attachedCount: number; personId: string }>('POST', `/api/v1/intake/submissions/${id}/attach`, { uploadIds }),
    downloadIntakeUpload: (submissionId: string, uploadId: string) =>
      download(`/api/v1/intake/submissions/${submissionId}/uploads/${uploadId}`),
    restoreRecord: (kind: string, id: string, expectedVersion: number, reason?: string | null) =>
      request<{ outcome: 'restored' | 'approval-submitted'; kind: string; id: string; approvalId: string | null }>(
        'POST',
        '/api/v1/recycle-bin/restore',
        { kind, id, expectedVersion, reason },
      ),
    setPerDiemPresets: (presets: Array<{ amountMinor: number; currency: string }>, expectedVersion: number | null) =>
      request<PerDiemPresetsDto>('POST', '/api/v1/settings/per-diem-presets', { presets, expectedVersion }),
    // S10: notifications — the bell.
    listNotifications: () => request<{ notifications: NotificationDto[]; unreadCount: number }>('GET', '/api/v1/notifications'),
    markNotificationRead: (signalKey: string) => request<{ ok: true }>('POST', '/api/v1/notifications/read', { signalKey }),
    markAllNotificationsRead: () => request<{ ok: true }>('POST', '/api/v1/notifications/read-all', {}),
    // S9: expense claims.
    listClaims: () => request<{ claims: ClaimDto[] }>('GET', '/api/v1/claims'),
    getClaim: (claimId: string) => request<{ claim: ClaimDto }>('GET', `/api/v1/claims/${claimId}`),
    claimAudit: (claimId: string) => request<{ events: AuditEventDto[] }>('GET', `/api/v1/claims/${claimId}/audit`),
    submitClaim: (input: { category: string; description: string; amountMinor: number; currency: string; expenseOn: string; personId?: string | null; missionId?: string | null }) => request<{ claim: ClaimDto }>('POST', '/api/v1/claims', input),
    decideClaim: (claimId: string, input: { expectedVersion: number; decision: 'beginReview' | 'approve' | 'reject'; reason?: string | null }) => request<{ claim: ClaimDto }>('POST', `/api/v1/claims/${claimId}/decide`, input),
    payClaim: (claimId: string, input: { expectedVersion: number; paymentSourceLabel: string; refNo?: string | null }) => request<{ claim: ClaimDto }>('POST', `/api/v1/claims/${claimId}/pay`, input),
    markPayout: (distributionId: string, personId: string, input: { expectedVersion: number; paid: boolean; paymentSourceLabel?: string | null; refNo?: string | null }) => request<{ share: DistributionShareDto }>('POST', `/api/v1/distributions/${distributionId}/payouts/${personId}`, input),
    // S6: invoices — issue against an income line; void with a reason; the PDF
    // artifact downloads through the S4 document path (Invoice owner gate).
    listInvoices: () => request<{ invoices: InvoiceDto[] }>('GET', '/api/v1/invoices'),
    getInvoice: (invoiceId: string) => request<{ invoice: InvoiceDto }>('GET', `/api/v1/invoices/${invoiceId}`),
    issueInvoice: (input: { missionId: string; lineId: string; entityId: string; billedToName: string; billedToDetails?: string | null; vatRateBps: number; description?: string | null }) =>
      request<{ invoice: InvoiceDto; pdfError?: string }>('POST', '/api/v1/invoices', input),
    voidInvoice: (invoiceId: string, reason: string, expectedVersion: number) =>
      request<{ invoice: InvoiceDto }>('POST', `/api/v1/invoices/${invoiceId}/void`, { reason, expectedVersion }),
    retryInvoicePdf: (invoiceId: string) => request<{ invoice: InvoiceDto }>('POST', `/api/v1/invoices/${invoiceId}/document`),
    // S4: documents — metadata via JSON, bytes via multipart/binary.
    listDocuments: (ownerType: string, ownerId: string) =>
      request<{ documents: DocumentDto[] }>('GET', `/api/v1/documents?ownerType=${encodeURIComponent(ownerType)}&ownerId=${encodeURIComponent(ownerId)}`),
    uploadDocument: (ownerType: string, ownerId: string, file: File, label?: string) => {
      const form = new FormData();
      // Fields BEFORE the file: @fastify/multipart exposes them on the file part.
      form.append('ownerType', ownerType);
      form.append('ownerId', ownerId);
      if (label) form.append('label', label);
      form.append('file', file, file.name);
      return upload<{ document: DocumentDto }>('/api/v1/documents', form);
    },
    downloadDocument: (documentId: string) => download(`/api/v1/documents/${documentId}/content`),
    removeDocument: (documentId: string, expectedVersion: number) =>
      request<{ document: DocumentDto }>('POST', `/api/v1/documents/${documentId}/remove`, { expectedVersion }),
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
export type TeamFinanceResponse = import('@c3web/api-contracts').TeamFinanceResponse;

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
export type { AgreementDto, AgreementTermDto, ApparelDto, ApprovalDto, CredentialDto, DocumentDto, JourneyDto, KitDto, MemberDto, MissionBudgetDto, MissionDto, MissionFinanceSummaryDto, MissionLineDto, MissionPnlDto, MissionParticipantDto, PersonDto, MeResponse, TeamDto, TeamMembershipDto };
