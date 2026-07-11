/**
 * app.ts — build the Fastify application (not listening). Used by the server,
 * the OpenAPI generator, and the integration tests. Every /api/v1 route is
 * authenticated (except the dev login), validated against zod request/response
 * schemas, and answered with a structured error envelope carrying the
 * correlation id.
 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import {
  agreementIdParamSchema,
  agreementResponseSchema,
  agreementsListSchema,
  agreementUpdateInputSchema,
  agreementTermsListSchema,
  submitAddAgreementTermRequestSchema,
  submitUpdateAgreementTermRequestSchema,
  submitRemoveAgreementTermRequestSchema,
  approvalIdParamSchema,
  approvalResponseSchema,
  approvalsListSchema,
  approvalEventsListSchema,
  auditEventsListSchema,
  apparelIdParamSchema,
  apparelListSchema,
  apparelResponseSchema,
  apparelTransitionParamSchema,
  kitTransitionParamSchema,
  entitiesListSchema,
  entityResponseSchema,
  entityIdParamSchema,
  entityCreateInputSchema,
  entityUpdateInputSchema,
  fxRatesListSchema,
  fxRateResponseSchema,
  setFxRateInputSchema,
  missionParticipantParamSchema,
  missionParticipantResponseSchema,
  missionLineCreateInputSchema,
  missionLineUpdateInputSchema,
  missionLineParamSchema,
  missionLineRemoveBodySchema,
  missionLineResponseSchema,
  missionLinePaymentInputSchema,
  missionBudgetResponseSchema,
  missionFinanceStageInputSchema,
  missionFinanceSummarySchema,
  missionPnlResponseSchema,
  importDomainParamSchema,
  exportDomainParamSchema,
  documentsListSchema,
  documentResponseSchema,
  documentIdParamSchema,
  documentsQuerySchema,
  documentRemoveBodySchema,
  searchQuerySchema,
  searchResultsSchema,
  dataQualityReportSchema,
  invoicesListSchema,
  teamsListSchema,
  teamResponseSchema,
  teamMembersListSchema,
  teamMembershipSchema,
  teamFinanceSchema,
  teamIdParamSchema,
  teamMemberRemoveParamSchema,
  flipVersionBodySchema,
  distributionsListSchema,
  distributionViewSchema,
  distributionSeedSchema,
  distributionShareSchema,
  createDistributionRequestSchema,
  revokeDistributionRequestSchema,
  markPayoutRequestSchema,
  distributionIdParamSchema,
  payoutParamSchema,
  claimsListSchema,
  claimResponseSchema,
  submitClaimRequestSchema,
  decideClaimRequestSchema,
  payClaimRequestSchema,
  notificationsInboxSchema,
  markNotificationReadRequestSchema,
  okResponseSchema,
  submitPersonIdentityRequestSchema,
  personLifecycleRequestSchema,
  updatePersonOperationalRequestSchema,
  submitCredentialFactsRequestSchema,
  credentialIdParamSchema,
  beneficiaryIdParamSchema,
  credentialResponseSchema,
  updateCredentialDetailsRequestSchema,
  beneficiariesListSchema,
  submitAddBeneficiaryRequestSchema,
  submitUpdateBeneficiaryRequestSchema,
  submitRetireBeneficiaryRequestSchema,
  delegationsListSchema,
  delegationResponseSchema,
  createDelegationRequestSchema,
  revokeDelegationRequestSchema,
  backupStatusSchema,
  claimIdParamSchema,
  teamCreateInputSchema,
  teamUpdateInputSchema,
  teamMemberInputSchema,
  invoiceResponseSchema,
  issueInvoiceRequestSchema,
  voidInvoiceRequestSchema,
  invoiceIdParamSchema,
  setMissionBudgetInputSchema,
  participantPerDiemBodySchema,
  credentialsListSchema,
  equipmentCreateInputSchema,
  equipmentUpdateInputSchema,
  errorResponseSchema,
  executeResponseSchema,
  kitIdParamSchema,
  kitListSchema,
  kitResponseSchema,
  journeyResponseSchema,
  journeysListSchema,
  journeyTransitionParamSchema,
  journeyTransitionRequestSchema,
  membersListSchema,
  meResponseSchema,
  missionCreateInputSchema,
  missionIdParamSchema,
  missionParticipantsListSchema,
  missionResponseSchema,
  missionsListSchema,
  missionUpdateInputSchema,
  peopleListSchema,
  personIdParamSchema,
  personMissionsListSchema,
  personResponseSchema,
  rejectRequestSchema,
  roleSchema,
  situationResponseSchema,
  submitAddAgreementRequestSchema,
  submitAddCredentialRequestSchema,
  submitAddMissionParticipantRequestSchema,
  submitAddPersonRequestSchema,
  submitDeactivateCredentialRequestSchema,
  submitInitiateJourneyRequestSchema,
  submitMemberChangeRequestSchema,
  submitRemoveMissionParticipantRequestSchema,
  submitRenewAgreementRequestSchema,
  submitTerminateAgreementRequestSchema,
  versionedRequestSchema,
} from '@c3web/api-contracts';
// (withdrawApproval imported with the application use-cases below)
import { DOCUMENT_MAX_BYTES, isAllowedDocumentContentType, type DocumentOwnerType } from '@c3web/domain';
import { capabilityView, canViewPerDiem, canViewPersonPII, disclosureOf, assertManageDelegations } from '@c3web/authz';
import { buildInvoicePdf } from './invoicePdf';
import {
  approveApproval,
  beginReview,
  createApparel,
  createKit,
  createMission,
  getAgreement,
  getSituation,
  listAgreements,
  listAgreementsForPerson,
  listAgreementTerms,
  submitAddAgreementTerm,
  submitUpdateAgreementTerm,
  submitRemoveAgreementTerm,
  submitAddAgreement,
  submitRenewAgreement,
  submitTerminateAgreement,
  updateAgreement,
  getMissionPnl,
  getMissionsFinanceSummary,
  globalSearch,
  getDataQualityReport,
  issueInvoice,
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  deactivateTeam,
  reactivateTeam,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  listTeamMembershipsForPerson,
  getTeamFinance,
  listMissionDistributions,
  getDistribution,
  getDistributionSeed,
  createDistribution,
  revokeDistribution,
  markPayout,
  listClaims,
  getClaim,
  submitClaim,
  decideClaim,
  payClaim,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  listDelegations,
  createDelegation,
  revokeDelegation,
  hasEffectiveReviewStanding,
  submitUpdatePersonIdentity,
  submitDeactivatePerson,
  submitReactivatePerson,
  updatePersonOperational,
  updateCredentialDetails,
  listBeneficiaries,
  listPersonBeneficiaries,
  submitUpdateCredentialFacts,
  submitAddBeneficiary,
  submitUpdateBeneficiary,
  submitRetireBeneficiary,
  voidInvoice,
  listInvoices,
  getInvoice,
  linkInvoiceDocument,
  stageImport,
  exportDomainCsv,
  exportAuditCsv,
  templateCsv,
  attachDocument,
  listDocuments,
  getDocumentForDownload,
  removeDocument,
  addMissionLine,
  updateMissionLine,
  removeMissionLine,
  setMissionLinePayment,
  setMissionBudget,
  setMissionFinanceStage,
  createEntity,
  deactivateApparel,
  deactivateEntity,
  deactivateKit,
  deactivateMission,
  listEntities,
  listFxRates,
  reactivateEntity,
  setFxRate,
  setParticipantPerDiem,
  transitionApparel,
  transitionKit,
  updateEntity,
  executeApproval,
  getApproval,
  getMission,
  getPerson,
  listApparel,
  listApprovalEvents,
  listApprovals,
  listAuditEvents,
  listApprovalsForPerson,
  listCredentials,
  listCredentialsForPerson,
  listMissionMembershipsForPerson,
  listJourneys,
  listJourneysForPerson,
  listKit,
  listMembers,
  listMissionParticipants,
  listMissions,
  listPeople,
  rejectApproval,
  submitAddCredential,
  submitAddMissionParticipant,
  submitAddPerson,
  submitDeactivateCredential,
  submitInitiateJourney,
  submitMemberChange,
  submitRemoveMissionParticipant,
  transitionJourney,
  updateApparel,
  updateKit,
  updateMission,
  withdrawApproval,
  type SubmitMemberChangeCommand,
} from '@c3web/application';
import type { Deps } from './deps';
import { buildBankRegistrationForm } from './bankForm';
import { loggerOptions } from './logger';
import { mapError } from './httpErrors';
import { AccessNotProvisionedError, AuthError } from './auth/types';
import { signDevToken } from './auth/devIdp';
import { toAgreementDto, toAgreementTermDto, toApparelDto, toApprovalDto, toApprovalEventDto, toAuditEventDto, toCredentialDto, toDocumentDto, toInvoiceDto, toTeamDto, toTeamMembershipDto, toDistributionDto, toDistributionShareDto, toClaimDto, toDelegationDto, toBeneficiaryDto, toApprovalSummaryDto, toEntityDto, toFxRateDto, toJourneyDto, toKitDto, toMemberDto, toMissionBudgetDto, toMissionDto, toMissionLineDto, toMissionParticipantDto, toMissionPnlDto, toPersonDto } from './dto';

function sendError(req: FastifyRequest, reply: FastifyReply, status: number, code: string, message: string, details?: Record<string, unknown>): void {
  reply.status(status).send({ error: { code, message, ...(details ? { details } : {}) }, correlationId: req.id });
}

export function buildApp(deps: Deps): FastifyInstance {
  // Correlation ids from clients are accepted only in a safe shape (log-injection guard).
  const CORRELATION_RE = /^[A-Za-z0-9_-]{1,64}$/;

  const app = Fastify({
    logger: loggerOptions(deps.env),
    // X-Forwarded-* headers are trusted ONLY when the deployment boundary
    // explicitly enables it (TRUST_PROXY=true behind a known proxy).
    trustProxy: deps.env.trustProxy,
    // Bounded request bodies: the largest legitimate payload (AddPerson) is
    // a few KB; 128 KiB leaves ample headroom.
    bodyLimit: 128 * 1024,
    genReqId: (req) => {
      const h = req.headers['x-correlation-id'];
      return typeof h === 'string' && CORRELATION_RE.test(h) ? h : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Bearer-token auth: no cookies, so no credentialed CORS. content-disposition
  // must be EXPOSED for the S4 download filename to survive cross-origin fetch.
  app.register(cors, { origin: deps.env.corsOrigin, exposedHeaders: ['content-disposition'] });

  // S4 documents: multipart uploads, hard-capped at the domain ceiling and a
  // single file per request. Attach-then-register handles the rest.
  app.register(multipart, { limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1, fields: 4 } });

  // F-1: per-client request ceiling (keyed by IP; trustProxy governs req.ip at
  // the deployment boundary). Health/readiness are exempt (platform probes).
  // 429 carries the same structured envelope as every other error.
  if (deps.env.rateLimitMax > 0) {
    app.register(rateLimit, {
      global: true,
      max: deps.env.rateLimitMax,
      timeWindow: '1 minute',
      allowList: (req) => {
        const url = req.url.split('?')[0] ?? '';
        return url === '/health' || url === '/ready';
      },
      // The plugin THROWS this return value; statusCode routes it through the
      // global error handler's 4xx branch, which emits the structured envelope
      // ({ error: { code, message }, correlationId }) like every other error.
      errorResponseBuilder: (_req, context) => ({
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: `Too many requests. Limit is ${context.max} per ${context.after}.`,
      }),
    });
  }
  app.register(swagger, {
    openapi: {
      info: { title: 'C3 Web V0 API', version: '0.1.0', description: 'People + AddPerson governed vertical slice.' },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });

  // Correlation id + security headers on every response; API responses are
  // authorization-dependent and must never be cached by intermediaries.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    if (req.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
    }
  });

  // Authentication: all /api/v1 routes except the dev login require a bearer
  // token. Runs at preValidation (NOT onRequest) so the rate limiter's
  // onRequest hook — registered via deferred plugin boot — always executes
  // first: unauthenticated 401 spam is therefore rate-limited too. Body size
  // is already bounded (128 KiB) before parsing, so pre-auth parsing is safe.
  app.addHook('preValidation', async (req, reply) => {
    const url = req.url.split('?')[0] ?? '';
    if (!url.startsWith('/api/v1/') || url === '/api/v1/dev/login') return;

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return sendError(req, reply, 401, 'UNAUTHENTICATED', 'A bearer token is required.');
    }
    try {
      const principal = await deps.authAdapter.authenticate(header.slice('Bearer '.length));
      req.principal = principal;
      req.actor = { identity: principal.identity, displayName: principal.displayName, role: principal.role, tenantId: principal.tenantId };
    } catch (err) {
      // Authenticated-but-unprovisioned is an AUTHORIZATION state (truthful 403),
      // distinct from an authentication failure (401).
      if (err instanceof AccessNotProvisionedError) {
        // A-8 Phase 1: a token-VALID identity was denied — record it in the
        // platform-level access_event stream (no tenant is resolvable, by
        // definition). Non-fatal: an audit-write failure never changes the 403.
        if (err.identityKey) {
          try {
            await deps.persistence.pool.query(
              `INSERT INTO access_event (provider, issuer_tenant_id, subject, outcome, detail)
               VALUES ($1, $2, $3, 'AccessDenied', $4)`,
              [err.identityKey.provider, err.identityKey.issuerTenantId, err.identityKey.subject, 'ACCESS_NOT_PROVISIONED'],
            );
          } catch (auditErr) {
            req.log.error({ err: auditErr }, 'access-denial audit write failed');
          }
        }
        return sendError(req, reply, 403, 'ACCESS_NOT_PROVISIONED', err.message);
      }
      return sendError(req, reply, 401, 'UNAUTHENTICATED', err instanceof AuthError ? err.message : 'Authentication failed.');
    }
  });

  app.setErrorHandler((error, req, reply) => {
    // zod request-validation errors surfaced by the type provider.
    const anyErr = error as { validation?: unknown; name?: string; issues?: unknown; statusCode?: number };
    if (anyErr.validation || anyErr.name === 'ZodError' || Array.isArray(anyErr.issues)) {
      return sendError(req, reply, 400, 'VALIDATION', 'Request failed validation.', { issues: anyErr.issues ?? anyErr.validation });
    }
    if (error instanceof AuthError) return sendError(req, reply, 401, 'UNAUTHENTICATED', error.message);
    // Fastify framework errors (body too large, malformed JSON, …) carry a 4xx
    // statusCode — surface them truthfully instead of a generic 500.
    if (typeof anyErr.statusCode === 'number' && anyErr.statusCode >= 400 && anyErr.statusCode < 500) {
      const fwErr = error as { code?: string; message?: string };
      return sendError(req, reply, anyErr.statusCode, fwErr.code ?? 'BAD_REQUEST', fwErr.message ?? 'Request refused.');
    }
    const mapped = mapError(error);
    if (mapped.status >= 500) req.log.error({ err: error }, 'unhandled error');
    return sendError(req, reply, mapped.status, mapped.code, mapped.message, mapped.details);
  });

  // Register routes inside a plugin that loads AFTER @fastify/swagger, so the
  // swagger onRoute hook captures every route into the generated document.
  app.register(async (instance) => {
    registerRoutes(instance.withTypeProvider<ZodTypeProvider>(), deps);
  });
  return app;
}

function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const P = deps.persistence;
  const actorOf = (req: FastifyRequest) => req.actor!;

  // ── health / readiness (public) ────────────────────────────────────────────
  const statusSchema = z.object({ status: z.string() });
  r.get('/health', { schema: { response: { 200: statusSchema } } }, async () => ({ status: 'ok' }));
  r.get('/ready', { schema: { response: { 200: statusSchema, 503: statusSchema } } }, async (_req, reply) => {
    const ok = await deps.ready();
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ready' : 'unavailable' });
  });

  // ── dev login ───────────────────────────────────────────────────────────────
  // Registered ONLY when the dev IdP is the active provider (never in
  // production — env validation forbids AUTH_PROVIDER=dev there, so this route
  // does not exist in a production process). Hidden from the OpenAPI contract.
  if (deps.env.authProvider === 'dev' && deps.directory && deps.env.devAuthSecret) {
    const devSecret = deps.env.devAuthSecret;
    const directory = deps.directory;
    r.post(
      '/api/v1/dev/login',
      {
        schema: {
          hide: true,
          body: submitDevLoginSchema(),
          response: { 200: devLoginResponseSchema(), 400: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (req, reply) => {
        const { email, displayName, role, tenantSlug } = req.body as DevLoginBody;
        const tenant = await directory.resolveTenantBySlug(tenantSlug);
        if (!tenant) return sendError(req, reply, 404, 'NOT_FOUND', `Unknown tenant '${tenantSlug}'.`);
        const name = displayName ?? email;
        await directory.upsertDevMembership(tenant.tenantId, email, name, role);
        const token = await signDevToken(devSecret, {
          identity: email,
          displayName: name,
          role,
          tenantId: tenant.tenantId,
          tenantSlug,
        });
        return reply.send({ token, identity: email, displayName: name, role, tenantSlug });
      },
    );
  }

  // ── me ─────────────────────────────────────────────────────────────────────
  r.get('/api/v1/me', { schema: { response: { 200: meResponseSchema } } }, async (req) => {
    const pr = req.principal!;
    // A-8 Phase 1: session establishment — /me resolution is the truthful
    // "signed in" moment in a stateless per-request API (the SPA calls it once
    // per session load). Non-fatal: an audit failure never blocks sign-in.
    try {
      await P.writes.transaction(actorOf(req), (tx) =>
        tx.appendAuditEvent({ entityType: 'Access', entityId: pr.identity, action: 'SessionEstablished', actor: pr.identity }),
      );
    } catch (auditErr) {
      req.log.error({ err: auditErr }, 'session-established audit write failed');
    }
    // Tier 0.5: /me stays truthful for active delegates — the buttons a
    // delegate sees are buttons the API accepts. Role view first; one
    // indexed lookup only when the role itself has no review standing.
    let capabilities = capabilityView(pr.role);
    if (!capabilities.canReviewApproval && (await hasEffectiveReviewStanding(P, actorOf(req)))) {
      capabilities = { ...capabilities, canReviewApproval: true, canExecuteApproval: true };
    }
    return { identity: pr.identity, displayName: pr.displayName, role: pr.role, tenantSlug: pr.tenantSlug, capabilities };
  });

  // ── people ───────────────────────────────────────────────────────────────
  // S11: the PII tier resolves per request — owner/ops/hr get the block,
  // everyone else gets structural omission (absence, not masking).
  const piiOf = (req: FastifyRequest) => canViewPersonPII(actorOf(req).role);
  // H-01: payload disclosure is ROLE-derived — delegation never widens it.
  const discOf = (req: FastifyRequest) => disclosureOf(actorOf(req).role);

  r.get('/api/v1/people', { schema: { response: { 200: peopleListSchema } } }, async (req) => {
    const people = await listPeople(P, actorOf(req));
    const pii = piiOf(req);
    return { people: people.map((p) => toPersonDto(p, pii)) };
  });

  r.get('/api/v1/people/:personId', { schema: { params: personIdParamSchema, response: { 200: personResponseSchema } } }, async (req) => {
    const { personId } = req.params as { personId: string };
    return { person: toPersonDto(await getPerson(P, actorOf(req), personId), piiOf(req)) };
  });

  // S11: operational facts move fast — direct-but-audited, version-guarded.
  r.patch(
    '/api/v1/people/:personId',
    { schema: { params: personIdParamSchema, body: updatePersonOperationalRequestSchema, response: { 200: personResponseSchema } } },
    async (req) => {
      const { personId } = req.params as { personId: string };
      const person = await updatePersonOperational(P, actorOf(req), personId, req.body as import('@c3web/domain').UpdatePersonOperationalInput);
      return { person: toPersonDto(person, piiOf(req)) };
    },
  );

  // S11: identity-material + lifecycle are GOVERNED — these submit requests.
  r.post(
    '/api/v1/people/:personId/identity-request',
    { schema: { params: personIdParamSchema, body: submitPersonIdentityRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const { personId } = req.params as { personId: string };
      const body = req.body as { patch: Record<string, unknown>; reason?: string };
      const approval = await submitUpdatePersonIdentity(P, actorOf(req), {
        input: { personId, patch: body.patch } as import('@c3web/domain').UpdatePersonIdentityInput,
        reason: body.reason ?? null,
      });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/people/:personId/deactivate-request',
    { schema: { params: personIdParamSchema, body: personLifecycleRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const { personId } = req.params as { personId: string };
      const { reason } = req.body as { reason: string };
      const approval = await submitDeactivatePerson(P, actorOf(req), { input: { personId, reason } });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/people/:personId/reactivate-request',
    { schema: { params: personIdParamSchema, body: personLifecycleRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const { personId } = req.params as { personId: string };
      const { reason } = req.body as { reason: string };
      const approval = await submitReactivatePerson(P, actorOf(req), { input: { personId, reason } });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.get('/api/v1/people/:personId/audit', { schema: { params: personIdParamSchema, response: { 200: auditEventsListSchema } } }, async (req) => {
    const { personId } = req.params as { personId: string };
    const events = await listAuditEvents(P, actorOf(req), 'Person', personId);
    return { events: events.map(toAuditEventDto) };
  });

  // ── approvals ──────────────────────────────────────────────────────────────
  r.get('/api/v1/approvals', { schema: { response: { 200: approvalsListSchema } } }, async (req) => {
    const approvals = await listApprovals(P, actorOf(req));
    return { approvals: approvals.map(toApprovalSummaryDto) };
  });

  r.post('/api/v1/approvals', { schema: { body: submitAddPersonRequestSchema, response: { 201: approvalResponseSchema } } }, async (req, reply) => {
    const body = req.body as { input: import('@c3web/domain').AddPersonInput; reason?: string };
    const approval = await submitAddPerson(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
    return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
  });

  r.get('/api/v1/approvals/:approvalId', { schema: { params: approvalIdParamSchema, response: { 200: approvalResponseSchema } } }, async (req) => {
    const { approvalId } = req.params as { approvalId: string };
    return { approval: toApprovalDto(await getApproval(P, actorOf(req), approvalId), discOf(req)) };
  });

  const versionedAction =
    (fn: (approvalId: string, req: FastifyRequest) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { approvalId } = req.params as { approvalId: string };
      const result = await fn(approvalId, req);
      // S10: email = a delivery channel of the L2 row the transaction already
      // wrote. Post-commit, fire-and-forget; the requester hears about
      // decisions on their request, never about their own actions. V1 scope:
      // transition emails only — submission alerts stay in-app (cockpit+bell).
      const approval = (result as { approval?: { approvalId: string; status: string; submittedBy: string } }).approval;
      if (deps.mailer && approval && approval.submittedBy.toLowerCase() !== actorOf(req).identity.toLowerCase()) {
        deps.mailer.send(
          approval.submittedBy,
          `[C3] ${approval.approvalId} is now ${approval.status}`,
          `Your request ${approval.approvalId} moved to ${approval.status}.\n\nOpen it in C3: /approvals/${approval.approvalId}`,
        );
      }
      return reply.send(result);
    };

  r.post(
    '/api/v1/approvals/:approvalId/begin-review',
    { schema: { params: approvalIdParamSchema, body: versionedRequestSchema, response: { 200: approvalResponseSchema } } },
    versionedAction(async (approvalId, req) => {
      const { expectedVersion } = req.body as { expectedVersion: number };
      return { approval: toApprovalDto(await beginReview(P, actorOf(req), approvalId, expectedVersion), discOf(req)) };
    }),
  );

  r.post(
    '/api/v1/approvals/:approvalId/approve',
    { schema: { params: approvalIdParamSchema, body: versionedRequestSchema, response: { 200: approvalResponseSchema } } },
    versionedAction(async (approvalId, req) => {
      const { expectedVersion } = req.body as { expectedVersion: number };
      return { approval: toApprovalDto(await approveApproval(P, actorOf(req), approvalId, expectedVersion), discOf(req)) };
    }),
  );

  r.post(
    '/api/v1/approvals/:approvalId/reject',
    { schema: { params: approvalIdParamSchema, body: rejectRequestSchema, response: { 200: approvalResponseSchema } } },
    versionedAction(async (approvalId, req) => {
      const { expectedVersion, reason } = req.body as { expectedVersion: number; reason: string };
      return { approval: toApprovalDto(await rejectApproval(P, actorOf(req), approvalId, expectedVersion, reason), discOf(req)) };
    }),
  );

  r.post(
    '/api/v1/approvals/:approvalId/execute',
    { schema: { params: approvalIdParamSchema, body: versionedRequestSchema, response: { 200: executeResponseSchema } } },
    versionedAction(async (approvalId, req) => {
      const { expectedVersion } = req.body as { expectedVersion: number };
      const res = await executeApproval(P, actorOf(req), approvalId, expectedVersion);
      return {
        approval: toApprovalDto(res.approval, discOf(req)),
        person: res.person ? toPersonDto(res.person, piiOf(req)) : null,
        credential: res.credential ? toCredentialDto(res.credential, piiOf(req)) : null,
        journey: res.journey ? toJourneyDto(res.journey) : null,
        participant: res.participant ? toMissionParticipantDto(res.participant) : null,
        agreement: res.agreement ? toAgreementDto(res.agreement) : null,
        idempotent: res.idempotent,
      };
    }),
  );

  // Sprint 42: the submitter withdraws their own request (the use-case
  // enforces submitter-only + Submitted/InReview; the S41 wedge remedy).
  r.post(
    '/api/v1/approvals/:approvalId/withdraw',
    { schema: { params: approvalIdParamSchema, body: versionedRequestSchema, response: { 200: approvalResponseSchema } } },
    versionedAction(async (approvalId, req) => {
      const { expectedVersion } = req.body as { expectedVersion: number };
      return { approval: toApprovalDto(await withdrawApproval(P, actorOf(req), approvalId, expectedVersion), discOf(req)) };
    }),
  );

  r.get('/api/v1/approvals/:approvalId/events', { schema: { params: approvalIdParamSchema, response: { 200: approvalEventsListSchema } } }, async (req) => {
    const { approvalId } = req.params as { approvalId: string };
    const events = await listApprovalEvents(P, actorOf(req), approvalId);
    return { events: events.map(toApprovalEventDto) };
  });

  r.get('/api/v1/approvals/:approvalId/audit', { schema: { params: approvalIdParamSchema, response: { 200: auditEventsListSchema } } }, async (req) => {
    const { approvalId } = req.params as { approvalId: string };
    const events = await listAuditEvents(P, actorOf(req), 'Approval', approvalId);
    return { events: events.map(toAuditEventDto) };
  });

  // ── credentials (Sprint 36) ────────────────────────────────────────────────
  r.get('/api/v1/credentials', { schema: { response: { 200: credentialsListSchema } } }, async (req) => {
    const credentials = await listCredentials(P, actorOf(req));
    const pii = piiOf(req);
    return { credentials: credentials.map((c) => toCredentialDto(c, pii)) };
  });

  r.get(
    '/api/v1/people/:personId/credentials',
    { schema: { params: personIdParamSchema, response: { 200: credentialsListSchema } } },
    async (req) => {
      const { personId } = req.params as { personId: string };
      const credentials = await listCredentialsForPerson(P, actorOf(req), personId);
      const pii = piiOf(req);
      return { credentials: credentials.map((c) => toCredentialDto(c, pii)) };
    },
  );

  // Credential changes are governed: submission creates an approval that flows
  // through the standard review/approve/execute routes above.
  r.post(
    '/api/v1/credentials/requests',
    { schema: { body: submitAddCredentialRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').AddCredentialInput; reason?: string };
      const approval = await submitAddCredential(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/credentials/deactivations',
    { schema: { body: submitDeactivateCredentialRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').DeactivateCredentialInput; reason?: string };
      const approval = await submitDeactivateCredential(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  // ── S12: credential FACTS are governed; DETAILS are direct-audited ─────────
  r.post(
    '/api/v1/credentials/:credentialId/facts-request',
    { schema: { params: credentialIdParamSchema, body: submitCredentialFactsRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const { credentialId } = req.params as { credentialId: string };
      const body = req.body as { patch: Record<string, unknown>; reason?: string };
      const approval = await submitUpdateCredentialFacts(P, actorOf(req), {
        input: { credentialId, patch: body.patch } as import('@c3web/domain').UpdateCredentialFactsInput,
        reason: body.reason ?? null,
      });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.patch(
    '/api/v1/credentials/:credentialId',
    { schema: { params: credentialIdParamSchema, body: updateCredentialDetailsRequestSchema, response: { 200: credentialResponseSchema } } },
    async (req) => {
      const { credentialId } = req.params as { credentialId: string };
      const credential = await updateCredentialDetails(P, actorOf(req), credentialId, req.body as import('@c3web/domain').UpdateCredentialDetailsInput);
      return { credential: toCredentialDto(credential, piiOf(req)) };
    },
  );

  // ── S12: the beneficiary registry (reads finance-gated; writes governed) ───
  r.get('/api/v1/beneficiaries', { schema: { response: { 200: beneficiariesListSchema } } }, async (req) => {
    const rows = await listBeneficiaries(P, actorOf(req));
    return { beneficiaries: rows.map(toBeneficiaryDto) };
  });

  r.get(
    '/api/v1/people/:personId/beneficiaries',
    { schema: { params: personIdParamSchema, response: { 200: beneficiariesListSchema } } },
    async (req) => {
      const { personId } = req.params as { personId: string };
      const rows = await listPersonBeneficiaries(P, actorOf(req), personId);
      return { beneficiaries: rows.map(toBeneficiaryDto) };
    },
  );

  r.post(
    '/api/v1/beneficiaries/requests',
    { schema: { body: submitAddBeneficiaryRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').AddBeneficiaryInput; reason?: string };
      const approval = await submitAddBeneficiary(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/beneficiaries/:beneficiaryId/update-request',
    { schema: { params: beneficiaryIdParamSchema, body: submitUpdateBeneficiaryRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const { beneficiaryId } = req.params as { beneficiaryId: string };
      const body = req.body as { patch: Record<string, unknown>; reason?: string };
      const approval = await submitUpdateBeneficiary(P, actorOf(req), {
        input: { beneficiaryId, patch: body.patch } as import('@c3web/domain').UpdateBeneficiaryInput,
        reason: body.reason ?? null,
      });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/beneficiaries/:beneficiaryId/retire-request',
    { schema: { params: beneficiaryIdParamSchema, body: submitRetireBeneficiaryRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const { beneficiaryId } = req.params as { beneficiaryId: string };
      const { reason } = req.body as { reason: string };
      const approval = await submitRetireBeneficiary(P, actorOf(req), { input: { beneficiaryId, reason } });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  // S12: the bank registration form — generated from the registry with the
  // SENSITIVE COLUMNS BLANK (the standing law: account numbers never enter
  // C3; the form is completed by hand outside the system).
  r.get(
    '/api/v1/people/:personId/beneficiaries/bank-form',
    { schema: { params: personIdParamSchema } },
    async (req, reply) => {
      const { personId } = req.params as { personId: string };
      const rows = await listPersonBeneficiaries(P, actorOf(req), personId);
      const person = await getPerson(P, actorOf(req), personId);
      const buffer = await buildBankRegistrationForm(person.fullName, rows);
      reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('content-disposition', `attachment; filename="bank-registration-${personId}.xlsx"`);
      return reply.send(buffer);
    },
  );

  // ── journeys (Sprint 37) ───────────────────────────────────────────────────
  r.get('/api/v1/journeys', { schema: { response: { 200: journeysListSchema } } }, async (req) => {
    const journeys = await listJourneys(P, actorOf(req));
    return { journeys: journeys.map(toJourneyDto) };
  });

  r.get(
    '/api/v1/people/:personId/journeys',
    { schema: { params: personIdParamSchema, response: { 200: journeysListSchema } } },
    async (req) => {
      const { personId } = req.params as { personId: string };
      const journeys = await listJourneysForPerson(P, actorOf(req), personId);
      return { journeys: journeys.map(toJourneyDto) };
    },
  );

  // Initiation is governed: the approval flows through the standard routes.
  r.post(
    '/api/v1/journeys/requests',
    { schema: { body: submitInitiateJourneyRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').InitiateJourneyInput; reason?: string };
      const approval = await submitInitiateJourney(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  // Transitions are DIRECT-BUT-AUDITED: role-gated, state-machine validated,
  // version-guarded; the effect is immediate and recorded.
  r.post(
    '/api/v1/journeys/:journeyId/transitions/:action',
    { schema: { params: journeyTransitionParamSchema, body: journeyTransitionRequestSchema, response: { 200: journeyResponseSchema } } },
    async (req) => {
      const { journeyId, action } = req.params as { journeyId: string; action: import('@c3web/domain').JourneyTransition };
      const { expectedVersion, reason } = req.body as { expectedVersion: number; reason?: string };
      const journey = await transitionJourney(P, actorOf(req), journeyId, action, expectedVersion, reason ?? null);
      return { journey: toJourneyDto(journey) };
    },
  );

  // ── equipment (Sprint 38): direct-audited CRUD, versioned mutations ───────
  r.get('/api/v1/kit', { schema: { response: { 200: kitListSchema } } }, async (req) => {
    return { kit: (await listKit(P, actorOf(req))).map(toKitDto) };
  });

  r.post('/api/v1/kit', { schema: { body: equipmentCreateInputSchema, response: { 201: kitResponseSchema } } }, async (req, reply) => {
    const kit = await createKit(P, actorOf(req), req.body as import('@c3web/domain').EquipmentCreateInput);
    return reply.status(201).send({ kit: toKitDto(kit) });
  });

  r.post(
    '/api/v1/kit/:kitId',
    { schema: { params: kitIdParamSchema, body: equipmentUpdateInputSchema, response: { 200: kitResponseSchema } } },
    async (req) => {
      const { kitId } = req.params as { kitId: string };
      const kit = await updateKit(P, actorOf(req), kitId, req.body as import('@c3web/domain').EquipmentUpdateInput);
      return { kit: toKitDto(kit) };
    },
  );

  r.post(
    '/api/v1/kit/:kitId/deactivate',
    { schema: { params: kitIdParamSchema, body: versionedRequestSchema, response: { 200: kitResponseSchema } } },
    async (req) => {
      const { kitId } = req.params as { kitId: string };
      const { expectedVersion } = req.body as { expectedVersion: number };
      const kit = await deactivateKit(P, actorOf(req), kitId, expectedVersion);
      return { kit: toKitDto(kit) };
    },
  );

  r.post(
    '/api/v1/kit/:kitId/transitions/:action',
    { schema: { params: kitTransitionParamSchema, body: versionedRequestSchema, response: { 200: kitResponseSchema } } },
    async (req) => {
      const { kitId, action } = req.params as { kitId: string; action: import('@c3web/domain').EquipmentTransition };
      const { expectedVersion } = req.body as { expectedVersion: number };
      const kit = await transitionKit(P, actorOf(req), kitId, action, expectedVersion);
      return { kit: toKitDto(kit) };
    },
  );

  r.get('/api/v1/apparel', { schema: { response: { 200: apparelListSchema } } }, async (req) => {
    return { apparel: (await listApparel(P, actorOf(req))).map(toApparelDto) };
  });

  r.post('/api/v1/apparel', { schema: { body: equipmentCreateInputSchema, response: { 201: apparelResponseSchema } } }, async (req, reply) => {
    const apparel = await createApparel(P, actorOf(req), req.body as import('@c3web/domain').EquipmentCreateInput);
    return reply.status(201).send({ apparel: toApparelDto(apparel) });
  });

  r.post(
    '/api/v1/apparel/:apparelId',
    { schema: { params: apparelIdParamSchema, body: equipmentUpdateInputSchema, response: { 200: apparelResponseSchema } } },
    async (req) => {
      const { apparelId } = req.params as { apparelId: string };
      const apparel = await updateApparel(P, actorOf(req), apparelId, req.body as import('@c3web/domain').EquipmentUpdateInput);
      return { apparel: toApparelDto(apparel) };
    },
  );

  r.post(
    '/api/v1/apparel/:apparelId/deactivate',
    { schema: { params: apparelIdParamSchema, body: versionedRequestSchema, response: { 200: apparelResponseSchema } } },
    async (req) => {
      const { apparelId } = req.params as { apparelId: string };
      const { expectedVersion } = req.body as { expectedVersion: number };
      const apparel = await deactivateApparel(P, actorOf(req), apparelId, expectedVersion);
      return { apparel: toApparelDto(apparel) };
    },
  );

  r.post(
    '/api/v1/apparel/:apparelId/transitions/:action',
    { schema: { params: apparelTransitionParamSchema, body: versionedRequestSchema, response: { 200: apparelResponseSchema } } },
    async (req) => {
      const { apparelId, action } = req.params as { apparelId: string; action: import('@c3web/domain').EquipmentTransition };
      const { expectedVersion } = req.body as { expectedVersion: number };
      const apparel = await transitionApparel(P, actorOf(req), apparelId, action, expectedVersion);
      return { apparel: toApparelDto(apparel) };
    },
  );

  // ── entities (S48): direct-audited CRUD, the tenant's legal operating entities ──
  r.get('/api/v1/entities', { schema: { response: { 200: entitiesListSchema } } }, async (req) => {
    return { entities: (await listEntities(P, actorOf(req))).map(toEntityDto) };
  });

  r.post('/api/v1/entities', { schema: { body: entityCreateInputSchema, response: { 201: entityResponseSchema } } }, async (req, reply) => {
    const entity = await createEntity(P, actorOf(req), req.body as import('@c3web/domain').EntityCreateInput);
    return reply.status(201).send({ entity: toEntityDto(entity) });
  });

  r.post(
    '/api/v1/entities/:entityId',
    { schema: { params: entityIdParamSchema, body: entityUpdateInputSchema, response: { 200: entityResponseSchema } } },
    async (req) => {
      const { entityId } = req.params as { entityId: string };
      const entity = await updateEntity(P, actorOf(req), entityId, req.body as import('@c3web/domain').EntityUpdateInput);
      return { entity: toEntityDto(entity) };
    },
  );

  r.post(
    '/api/v1/entities/:entityId/deactivate',
    { schema: { params: entityIdParamSchema, body: versionedRequestSchema, response: { 200: entityResponseSchema } } },
    async (req) => {
      const { entityId } = req.params as { entityId: string };
      const { expectedVersion } = req.body as { expectedVersion: number };
      const entity = await deactivateEntity(P, actorOf(req), entityId, expectedVersion);
      return { entity: toEntityDto(entity) };
    },
  );

  r.post(
    '/api/v1/entities/:entityId/reactivate',
    { schema: { params: entityIdParamSchema, body: versionedRequestSchema, response: { 200: entityResponseSchema } } },
    async (req) => {
      const { entityId } = req.params as { entityId: string };
      const { expectedVersion } = req.body as { expectedVersion: number };
      const entity = await reactivateEntity(P, actorOf(req), entityId, expectedVersion);
      return { entity: toEntityDto(entity) };
    },
  );

  // ── FX rates (Finance S1): the org's editable currency rates ──────────────
  r.get('/api/v1/fx-rates', { schema: { response: { 200: fxRatesListSchema } } }, async (req) => {
    return { rates: (await listFxRates(P, actorOf(req))).map(toFxRateDto) };
  });

  r.post('/api/v1/fx-rates', { schema: { body: setFxRateInputSchema, response: { 200: fxRateResponseSchema } } }, async (req) => {
    const rate = await setFxRate(P, actorOf(req), req.body as import('@c3web/domain').SetFxRateInput);
    return { rate: toFxRateDto(rate) };
  });

  // ── missions (Sprint 39): direct-audited shell + governed participants ────
  r.get('/api/v1/missions', { schema: { response: { 200: missionsListSchema } } }, async (req) => {
    return { missions: (await listMissions(P, actorOf(req))).map(toMissionDto) };
  });

  r.get(
    '/api/v1/missions/:missionId',
    { schema: { params: missionIdParamSchema, response: { 200: missionResponseSchema } } },
    async (req) => {
      const { missionId } = req.params as { missionId: string };
      return { mission: toMissionDto(await getMission(P, actorOf(req), missionId)) };
    },
  );

  r.get(
    '/api/v1/missions/:missionId/participants',
    { schema: { params: missionIdParamSchema, response: { 200: missionParticipantsListSchema } } },
    async (req) => {
      const actor = actorOf(req);
      const { missionId } = req.params as { missionId: string };
      const showPerDiem = canViewPerDiem(actor.role);
      const participants = await listMissionParticipants(P, actor, missionId);
      return { participants: participants.map((p) => toMissionParticipantDto(p, showPerDiem)) };
    },
  );

  r.post(
    '/api/v1/missions/:missionId/participants/:personId/per-diem',
    { schema: { params: missionParticipantParamSchema, body: participantPerDiemBodySchema, response: { 200: missionParticipantResponseSchema } } },
    async (req) => {
      const actor = actorOf(req);
      const { missionId, personId } = req.params as { missionId: string; personId: string };
      const body = req.body as { perDiemAmountMinor: number | null; perDiemCurrency: import('@c3web/domain').CurrencyCode | null };
      const participant = await setParticipantPerDiem(P, actor, { missionId, personId, ...body });
      // The setter is gated to canManageMissions (owner/ops), who can also view.
      return { participant: toMissionParticipantDto(participant, canViewPerDiem(actor.role)) };
    },
  );

  r.get(
    '/api/v1/missions/:missionId/audit',
    { schema: { params: missionIdParamSchema, response: { 200: auditEventsListSchema } } },
    async (req) => {
      const { missionId } = req.params as { missionId: string };
      const events = await listAuditEvents(P, actorOf(req), 'Mission', missionId);
      return { events: events.map(toAuditEventDto) };
    },
  );

  // ── mission P&L (Finance S4) — lines are direct-audited (owner/ops); the
  //    WHOLE surface is gated to canViewFinancials (the use-cases 403 here).
  // NOTE: /missions/finance-summary is registered BEFORE /missions/:missionId
  // routes would swallow it — Fastify matches static segments first anyway,
  // but keep the intent explicit.
  r.get('/api/v1/missions/finance-summary', { schema: { response: { 200: missionFinanceSummarySchema } } }, async (req) => {
    const rows = await getMissionsFinanceSummary(P, actorOf(req));
    return {
      missions: rows.map((r0) => ({
        ...r0,
        blended: r0.blended ? { ...r0.blended } : null,
        missingRates: [...r0.missingRates],
      })),
    };
  });

  r.get(
    '/api/v1/missions/:missionId/pnl',
    { schema: { params: missionIdParamSchema, response: { 200: missionPnlResponseSchema } } },
    async (req) => {
      const { missionId } = req.params as { missionId: string };
      const view = await getMissionPnl(P, actorOf(req), missionId);
      return { lines: view.lines.map(toMissionLineDto), budgets: view.budgets.map(toMissionBudgetDto), pnl: toMissionPnlDto(view.pnl) };
    },
  );

  r.post(
    '/api/v1/missions/:missionId/lines/:lineId/payment',
    { schema: { params: missionLineParamSchema, body: missionLinePaymentInputSchema, response: { 200: missionLineResponseSchema } } },
    async (req) => {
      const { missionId, lineId } = req.params as { missionId: string; lineId: string };
      const line = await setMissionLinePayment(P, actorOf(req), missionId, lineId, req.body as import('@c3web/domain').MissionLinePaymentInput);
      return { line: toMissionLineDto(line) };
    },
  );

  r.post(
    '/api/v1/missions/:missionId/budgets',
    { schema: { params: missionIdParamSchema, body: setMissionBudgetInputSchema, response: { 200: missionBudgetResponseSchema } } },
    async (req) => {
      const { missionId } = req.params as { missionId: string };
      const budget = await setMissionBudget(P, actorOf(req), missionId, req.body as import('@c3web/domain').SetMissionBudgetInput);
      return { budget: budget ? toMissionBudgetDto(budget) : null };
    },
  );

  r.post(
    '/api/v1/missions/:missionId/finance-stage',
    { schema: { params: missionIdParamSchema, body: missionFinanceStageInputSchema, response: { 200: missionResponseSchema } } },
    async (req) => {
      const { missionId } = req.params as { missionId: string };
      const mission = await setMissionFinanceStage(P, actorOf(req), missionId, req.body as import('@c3web/domain').MissionFinanceStageInput);
      return { mission: toMissionDto(mission) };
    },
  );

  r.post(
    '/api/v1/missions/:missionId/lines',
    { schema: { params: missionIdParamSchema, body: missionLineCreateInputSchema, response: { 201: missionLineResponseSchema } } },
    async (req, reply) => {
      const { missionId } = req.params as { missionId: string };
      const line = await addMissionLine(P, actorOf(req), missionId, req.body as import('@c3web/domain').MissionLineCreateInput);
      return reply.status(201).send({ line: toMissionLineDto(line) });
    },
  );

  r.post(
    '/api/v1/missions/:missionId/lines/:lineId',
    { schema: { params: missionLineParamSchema, body: missionLineUpdateInputSchema, response: { 200: missionLineResponseSchema } } },
    async (req) => {
      const { missionId, lineId } = req.params as { missionId: string; lineId: string };
      const line = await updateMissionLine(P, actorOf(req), missionId, lineId, req.body as import('@c3web/domain').MissionLineUpdateInput);
      return { line: toMissionLineDto(line) };
    },
  );

  r.post(
    '/api/v1/missions/:missionId/lines/:lineId/remove',
    { schema: { params: missionLineParamSchema, body: missionLineRemoveBodySchema, response: { 200: missionLineResponseSchema } } },
    async (req) => {
      const { missionId, lineId } = req.params as { missionId: string; lineId: string };
      const { expectedVersion } = req.body as { expectedVersion: number };
      const line = await removeMissionLine(P, actorOf(req), missionId, lineId, expectedVersion);
      return { line: toMissionLineDto(line) };
    },
  );

  r.post('/api/v1/missions', { schema: { body: missionCreateInputSchema, response: { 201: missionResponseSchema } } }, async (req, reply) => {
    const mission = await createMission(P, actorOf(req), req.body as import('@c3web/domain').MissionCreateInput);
    return reply.status(201).send({ mission: toMissionDto(mission) });
  });

  r.post(
    '/api/v1/missions/:missionId',
    { schema: { params: missionIdParamSchema, body: missionUpdateInputSchema, response: { 200: missionResponseSchema } } },
    async (req) => {
      const { missionId } = req.params as { missionId: string };
      const mission = await updateMission(P, actorOf(req), missionId, req.body as import('@c3web/domain').MissionUpdateInput);
      return { mission: toMissionDto(mission) };
    },
  );

  r.post(
    '/api/v1/missions/:missionId/deactivate',
    { schema: { params: missionIdParamSchema, body: versionedRequestSchema, response: { 200: missionResponseSchema } } },
    async (req) => {
      const { missionId } = req.params as { missionId: string };
      const { expectedVersion } = req.body as { expectedVersion: number };
      const mission = await deactivateMission(P, actorOf(req), missionId, expectedVersion);
      return { mission: toMissionDto(mission) };
    },
  );

  // Participant membership is governed: submission creates an approval that
  // flows through the standard review/approve/execute routes. The duplicate
  // guards refuse at submit here AND authoritatively at execution.
  r.post(
    '/api/v1/missions/participants/requests',
    { schema: { body: submitAddMissionParticipantRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').AddMissionParticipantInput; reason?: string };
      const approval = await submitAddMissionParticipant(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/missions/participants/removals',
    { schema: { body: submitRemoveMissionParticipantRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').RemoveMissionParticipantInput; reason?: string };
      const approval = await submitRemoveMissionParticipant(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  // ── the Situation Room (Sprint 43): the operational cockpit read ──────────
  // ── import/export (S5): the locked design — export IS the template; a clean
  //    file stages ONE ImportBatch approval; errors ride the envelope (422). ──
  r.post(
    '/api/v1/imports',
    { bodyLimit: 8 * 1024 * 1024, schema: { response: { 201: z.object({ approval: approvalResponseSchema.shape.approval, domain: z.enum(['people', 'credentials', 'agreements']), rowCount: z.number().int() }) } } },
    async (req, reply) => {
      const actor = actorOf(req);
      const file = await req.file();
      if (!file) return sendError(req, reply, 400, 'VALIDATION', 'A CSV file is required.');
      const fields = file.fields as Record<string, unknown>;
      const domainRaw = ((fields['domain'] as { value?: unknown } | undefined)?.value ?? '') as string;
      if (!['people', 'credentials', 'agreements'].includes(domainRaw)) {
        return sendError(req, reply, 400, 'VALIDATION', 'domain must be people, credentials, or agreements.');
      }
      let text: string;
      try {
        text = (await file.toBuffer()).toString('utf8');
      } catch {
        return sendError(req, reply, 413, 'TOO_LARGE', 'The file is too large.');
      }
      const result = await stageImport(P, actor, domainRaw as import('@c3web/domain').ImportDomain, file.filename || 'import.csv', text);
      if (!result.ok) {
        // ALL-OR-NOTHING: the complete per-row report, capped for the wire.
        return sendError(req, reply, 422, 'IMPORT_INVALID', 'The file has validation errors — nothing was imported.', {
          errorCount: result.errors.length,
          rows: result.errors.slice(0, 100),
        });
      }
      return reply.status(201).send({ approval: toApprovalDto(result.approval, discOf(req)), domain: result.domain, rowCount: result.rowCount });
    },
  );

  r.get('/api/v1/imports/templates/:domain', { schema: { params: importDomainParamSchema } }, async (req, reply) => {
    const actor = actorOf(req);
    void actor; // authenticated route; templates carry no data
    const { domain } = req.params as { domain: import('@c3web/domain').ImportDomain };
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="c3-${domain}-template.csv"`);
    return reply.send(templateCsv(domain));
  });

  r.get('/api/v1/exports/:domain', { schema: { params: exportDomainParamSchema } }, async (req, reply) => {
    const actor = actorOf(req);
    const { domain } = req.params as { domain: 'people' | 'credentials' | 'agreements' | 'audit' };
    const csv = domain === 'audit' ? await exportAuditCsv(P, actor) : await exportDomainCsv(P, actor, domain);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="c3-${domain}-export.csv"`);
    return reply.send(csv);
  });

  // ── documents (S4): metadata + bytes through the API — never public. ──────
  r.get(
    '/api/v1/documents',
    { schema: { querystring: documentsQuerySchema, response: { 200: documentsListSchema } } },
    async (req) => {
      const { ownerType, ownerId } = req.query as { ownerType: DocumentOwnerType; ownerId: string };
      return { documents: (await listDocuments(P, actorOf(req), ownerType, ownerId)).map(toDocumentDto) };
    },
  );

  r.post(
    '/api/v1/documents',
    // Multipart: the plugin's limits govern the stream; the route bodyLimit
    // covers the envelope overhead above the 25 MB file ceiling.
    { bodyLimit: DOCUMENT_MAX_BYTES + 1024 * 1024, schema: { response: { 201: documentResponseSchema } } },
    async (req, reply) => {
      const actor = actorOf(req);
      const file = await req.file();
      if (!file) return sendError(req, reply, 400, 'VALIDATION', 'A file is required.');
      const fields = file.fields as Record<string, unknown>;
      const fieldVal = (name: string): string => {
        const f = fields[name] as { value?: unknown } | undefined;
        return f && typeof f.value === 'string' ? f.value : '';
      };
      const contentType = file.mimetype;
      if (!isAllowedDocumentContentType(contentType)) {
        return sendError(req, reply, 415, 'UNSUPPORTED_TYPE', 'This file type is not allowed.');
      }
      let body: Buffer;
      try {
        body = await file.toBuffer();
      } catch {
        return sendError(req, reply, 413, 'TOO_LARGE', `The file exceeds the ${Math.round(DOCUMENT_MAX_BYTES / (1024 * 1024))} MB limit.`);
      }
      if (body.length === 0) return sendError(req, reply, 400, 'VALIDATION', 'The file is empty.');

      const sha256 = createHash('sha256').update(body).digest('hex');
      // Tenant-scoped, server-generated — never derived from user input.
      const storageKey = `${actor.tenantId}/${randomUUID()}`;
      await deps.documentStorage.put(storageKey, body, contentType);
      try {
        const doc = await attachDocument(P, actor, {
          ownerType: fieldVal('ownerType') as DocumentOwnerType,
          ownerId: fieldVal('ownerId'),
          fileName: file.filename || 'file',
          contentType,
          sizeBytes: body.length,
          sha256,
          storageKey,
          label: fieldVal('label') || null,
        });
        return reply.status(201).send({ document: toDocumentDto(doc) });
      } catch (err) {
        // Compensation: the blob landed but registration failed — remove it.
        await deps.documentStorage.delete(storageKey).catch(() => {});
        throw err;
      }
    },
  );

  r.get('/api/v1/documents/:documentId/content', { schema: { params: documentIdParamSchema } }, async (req, reply) => {
    const { documentId } = req.params as { documentId: string };
    const doc = await getDocumentForDownload(P, actorOf(req), documentId);
    const body = await deps.documentStorage.get(doc.storageKey);
    if (!body) return sendError(req, reply, 404, 'NOT_FOUND', 'The stored file could not be found.');
    const safeName = doc.fileName.replace(/[^\w. -]/g, '_');
    reply.header('content-type', doc.contentType);
    reply.header('content-disposition', `attachment; filename="${safeName}"`);
    reply.header('content-length', String(body.length));
    return reply.send(body);
  });

  r.post(
    '/api/v1/documents/:documentId/remove',
    { schema: { params: documentIdParamSchema, body: documentRemoveBodySchema, response: { 200: documentResponseSchema } } },
    async (req) => {
      const { documentId } = req.params as { documentId: string };
      const { expectedVersion } = req.body as { expectedVersion: number };
      return { document: toDocumentDto(await removeDocument(P, actorOf(req), documentId, expectedVersion)) };
    },
  );

  // ── claims (S9): submit, decide (separation law), pay (label only) ─────────
  r.get('/api/v1/claims', { schema: { response: { 200: claimsListSchema } } }, async (req) => {
    return { claims: (await listClaims(P, actorOf(req))).map(toClaimDto) };
  });

  r.post('/api/v1/claims', { schema: { body: submitClaimRequestSchema, response: { 201: claimResponseSchema } } }, async (req, reply) => {
    const claim = await submitClaim(P, actorOf(req), req.body as import('@c3web/domain').SubmitClaimInput);
    return reply.status(201).send({ claim: toClaimDto(claim) });
  });

  r.get('/api/v1/claims/:claimId', { schema: { params: claimIdParamSchema, response: { 200: claimResponseSchema } } }, async (req) => {
    const { claimId } = req.params as { claimId: string };
    return { claim: toClaimDto(await getClaim(P, actorOf(req), claimId)) };
  });

  r.get(
    '/api/v1/claims/:claimId/audit',
    { schema: { params: claimIdParamSchema, response: { 200: auditEventsListSchema } } },
    async (req) => {
      const { claimId } = req.params as { claimId: string };
      const events = await listAuditEvents(P, actorOf(req), 'Claim', claimId);
      return { events: events.map(toAuditEventDto) };
    },
  );

  r.post(
    '/api/v1/claims/:claimId/decide',
    { schema: { params: claimIdParamSchema, body: decideClaimRequestSchema, response: { 200: claimResponseSchema } } },
    async (req) => {
      const { claimId } = req.params as { claimId: string };
      return { claim: toClaimDto(await decideClaim(P, actorOf(req), claimId, req.body as import('@c3web/domain').DecideClaimInput)) };
    },
  );

  r.post(
    '/api/v1/claims/:claimId/pay',
    { schema: { params: claimIdParamSchema, body: payClaimRequestSchema, response: { 200: claimResponseSchema } } },
    async (req) => {
      const { claimId } = req.params as { claimId: string };
      return { claim: toClaimDto(await payClaim(P, actorOf(req), claimId, req.body as import('@c3web/domain').PayClaimInput)) };
    },
  );

  // ── notifications (S10): the bell — per-user rows, ack, never delete ───────
  r.get('/api/v1/notifications', { schema: { response: { 200: notificationsInboxSchema } } }, async (req) => {
    const inbox = await listNotifications(P, actorOf(req));
    return {
      notifications: inbox.notifications.map((n) => ({ signalKey: n.signalKey, kind: n.kind, title: n.title, link: n.link, emittedAt: n.emittedAt, readAt: n.readAt })),
      unreadCount: inbox.unreadCount,
    };
  });

  r.post('/api/v1/notifications/read', { schema: { body: markNotificationReadRequestSchema, response: { 200: okResponseSchema } } }, async (req) => {
    const { signalKey } = req.body as { signalKey: string };
    await markNotificationRead(P, actorOf(req), signalKey);
    return { ok: true as const };
  });

  r.post('/api/v1/notifications/read-all', { schema: { response: { 200: okResponseSchema } } }, async (req) => {
    await markAllNotificationsRead(P, actorOf(req));
    return { ok: true as const };
  });

  // ── delegations (Tier 0.5): owner grants approver standing for a window ────
  r.get('/api/v1/delegations', { schema: { response: { 200: delegationsListSchema } } }, async (req) => {
    const rows = await listDelegations(P, actorOf(req));
    return { delegations: rows.map(toDelegationDto) };
  });

  r.post('/api/v1/delegations', { schema: { body: createDelegationRequestSchema, response: { 201: delegationResponseSchema } } }, async (req, reply) => {
    const d = await createDelegation(P, actorOf(req), req.body as import('@c3web/domain').CreateDelegationInput);
    return reply.status(201).send({ delegation: toDelegationDto(d) });
  });

  r.post(
    '/api/v1/delegations/:delegationId/revoke',
    { schema: { params: z.object({ delegationId: z.string().regex(/^DLG-\d{4,}$/) }), body: revokeDelegationRequestSchema, response: { 200: delegationResponseSchema } } },
    async (req) => {
      const { delegationId } = req.params as { delegationId: string };
      const d = await revokeDelegation(P, actorOf(req), delegationId, req.body as { expectedVersion: number; reason: string });
      return { delegation: toDelegationDto(d) };
    },
  );

  // ── backup status (Tier 0.5): the Settings tile's one honest question ──────
  r.get('/api/v1/settings/backup-status', { schema: { response: { 200: backupStatusSchema } } }, async (req) => {
    assertManageDelegations(actorOf(req)); // owner-only, same standing as delegations
    return deps.backupStatus();
  });

  // ── distributions (S8): the payout list — allocate, mark paid, revoke ──────
  r.get(
    '/api/v1/missions/:missionId/distributions',
    { schema: { params: missionIdParamSchema, response: { 200: distributionsListSchema } } },
    async (req) => {
      const { missionId } = req.params as { missionId: string };
      const views = await listMissionDistributions(P, actorOf(req), missionId);
      return { distributions: views.map((v) => ({ distribution: toDistributionDto(v.distribution), shares: v.shares.map(toDistributionShareDto) })) };
    },
  );

  r.get(
    '/api/v1/distributions/seed',
    { schema: { querystring: z.object({ missionId: z.string().regex(/^MSN-\d{4,}$/) }), response: { 200: distributionSeedSchema } } },
    async (req) => {
      const { missionId } = req.query as { missionId: string };
      return { rows: (await getDistributionSeed(P, actorOf(req), missionId)).map((r0) => ({ ...r0 })) };
    },
  );

  r.get(
    '/api/v1/distributions/:distributionId',
    { schema: { params: distributionIdParamSchema, response: { 200: distributionViewSchema } } },
    async (req) => {
      const { distributionId } = req.params as { distributionId: string };
      const view = await getDistribution(P, actorOf(req), distributionId);
      return { distribution: toDistributionDto(view.distribution), shares: view.shares.map(toDistributionShareDto) };
    },
  );

  r.get(
    '/api/v1/distributions/:distributionId/audit',
    { schema: { params: distributionIdParamSchema, response: { 200: auditEventsListSchema } } },
    async (req) => {
      const { distributionId } = req.params as { distributionId: string };
      const events = await listAuditEvents(P, actorOf(req), 'Distribution', distributionId);
      return { events: events.map(toAuditEventDto) };
    },
  );

  r.post(
    '/api/v1/distributions',
    { schema: { body: createDistributionRequestSchema, response: { 201: distributionViewSchema } } },
    async (req, reply) => {
      const view = await createDistribution(P, actorOf(req), req.body as import('@c3web/domain').CreateDistributionInput);
      return reply.status(201).send({ distribution: toDistributionDto(view.distribution), shares: view.shares.map(toDistributionShareDto) });
    },
  );

  r.post(
    '/api/v1/distributions/:distributionId/revoke',
    { schema: { params: distributionIdParamSchema, body: revokeDistributionRequestSchema, response: { 200: distributionViewSchema } } },
    async (req) => {
      const { distributionId } = req.params as { distributionId: string };
      const { reason, expectedVersion } = req.body as { reason: string; expectedVersion: number };
      const view = await revokeDistribution(P, actorOf(req), distributionId, reason, expectedVersion);
      return { distribution: toDistributionDto(view.distribution), shares: view.shares.map(toDistributionShareDto) };
    },
  );

  r.post(
    '/api/v1/distributions/:distributionId/payouts/:personId',
    { schema: { params: payoutParamSchema, body: markPayoutRequestSchema, response: { 200: z.object({ share: distributionShareSchema }) } } },
    async (req) => {
      const { distributionId, personId } = req.params as { distributionId: string; personId: string };
      const share = await markPayout(P, actorOf(req), distributionId, personId, req.body as import('@c3web/domain').MarkPayoutInput);
      return { share: toDistributionShareDto(share) };
    },
  );

  // ── teams (S7): divisions/departments, roster, per-team P&L + ROI% ─────────
  r.get('/api/v1/teams', { schema: { response: { 200: teamsListSchema } } }, async (req) => {
    return { teams: (await listTeams(P, actorOf(req))).map(toTeamDto) };
  });

  r.post('/api/v1/teams', { schema: { body: teamCreateInputSchema, response: { 201: teamResponseSchema } } }, async (req, reply) => {
    const team = await createTeam(P, actorOf(req), req.body as import('@c3web/domain').TeamCreateInput);
    return reply.status(201).send({ team: toTeamDto(team) });
  });

  r.get('/api/v1/teams/:teamId', { schema: { params: teamIdParamSchema, response: { 200: teamResponseSchema } } }, async (req) => {
    const { teamId } = req.params as { teamId: string };
    return { team: toTeamDto(await getTeam(P, actorOf(req), teamId)) };
  });

  r.post('/api/v1/teams/:teamId', { schema: { params: teamIdParamSchema, body: teamUpdateInputSchema, response: { 200: teamResponseSchema } } }, async (req) => {
    const { teamId } = req.params as { teamId: string };
    return { team: toTeamDto(await updateTeam(P, actorOf(req), teamId, req.body as import('@c3web/domain').TeamUpdateInput)) };
  });

  r.post(
    '/api/v1/teams/:teamId/deactivate',
    { schema: { params: teamIdParamSchema, body: flipVersionBodySchema, response: { 200: teamResponseSchema } } },
    async (req) => {
      const { teamId } = req.params as { teamId: string };
      const { expectedVersion } = req.body as { expectedVersion: number };
      return { team: toTeamDto(await deactivateTeam(P, actorOf(req), teamId, expectedVersion)) };
    },
  );

  r.post(
    '/api/v1/teams/:teamId/reactivate',
    { schema: { params: teamIdParamSchema, body: flipVersionBodySchema, response: { 200: teamResponseSchema } } },
    async (req) => {
      const { teamId } = req.params as { teamId: string };
      const { expectedVersion } = req.body as { expectedVersion: number };
      return { team: toTeamDto(await reactivateTeam(P, actorOf(req), teamId, expectedVersion)) };
    },
  );

  r.get(
    '/api/v1/teams/:teamId/members',
    { schema: { params: teamIdParamSchema, response: { 200: teamMembersListSchema } } },
    async (req) => {
      const { teamId } = req.params as { teamId: string };
      return { members: (await listTeamMembers(P, actorOf(req), teamId)).map(toTeamMembershipDto) };
    },
  );

  r.post(
    '/api/v1/teams/:teamId/members',
    { schema: { params: teamIdParamSchema, body: teamMemberInputSchema, response: { 201: z.object({ member: teamMembershipSchema }) } } },
    async (req, reply) => {
      const { teamId } = req.params as { teamId: string };
      const member = await addTeamMember(P, actorOf(req), teamId, req.body as import('@c3web/domain').TeamMemberInput);
      return reply.status(201).send({ member: toTeamMembershipDto(member) });
    },
  );

  r.post(
    '/api/v1/teams/:teamId/members/:personId/remove',
    { schema: { params: teamMemberRemoveParamSchema, response: { 200: z.object({ member: teamMembershipSchema }) } } },
    async (req) => {
      const { teamId, personId } = req.params as { teamId: string; personId: string };
      return { member: toTeamMembershipDto(await removeTeamMember(P, actorOf(req), teamId, personId)) };
    },
  );

  r.get(
    '/api/v1/teams/:teamId/finance',
    { schema: { params: teamIdParamSchema, response: { 200: teamFinanceSchema } } },
    async (req) => {
      const { teamId } = req.params as { teamId: string };
      const fin = await getTeamFinance(P, actorOf(req), teamId);
      return {
        finance: {
          missions: fin.missions.map((m) => ({ ...m, missingRates: [...m.missingRates], blended: m.blended ? { ...m.blended } : null })),
          totals: fin.totals ? { ...fin.totals } : null,
          unblendableMissions: [...fin.unblendableMissions],
          roiBps: fin.roiBps,
        },
      };
    },
  );

  r.get(
    '/api/v1/teams/:teamId/audit',
    { schema: { params: teamIdParamSchema, response: { 200: auditEventsListSchema } } },
    async (req) => {
      const { teamId } = req.params as { teamId: string };
      const events = await listAuditEvents(P, actorOf(req), 'Team', teamId);
      return { events: events.map(toAuditEventDto) };
    },
  );

  r.get(
    '/api/v1/people/:personId/teams',
    { schema: { params: personIdParamSchema, response: { 200: teamMembersListSchema } } },
    async (req) => {
      const { personId } = req.params as { personId: string };
      return { members: (await listTeamMembershipsForPerson(P, actorOf(req), personId)).map(toTeamMembershipDto) };
    },
  );

  // ── invoices (S6): the outward claim — issue, PDF artifact, void, register ─
  // The PDF is generated AFTER the issue transaction (external I/O never rides
  // a DB tx): build → put bytes → register document (compensated) → link. A
  // failed artifact leaves an HONEST invoice with documentId=null plus a
  // retry endpoint — never a lie, never an orphan blob.
  async function generateAndAttachInvoicePdf(actor: ReturnType<typeof actorOf>, invoice: import('@c3web/domain').Invoice) {
    const reads = P.reads.forActor(actor);
    const [entity, mission] = await Promise.all([reads.getEntityById(invoice.entityId), reads.getMissionById(invoice.missionId)]);
    const pdf = await buildInvoicePdf({
      invoice,
      entity: { name: entity?.name ?? invoice.entityId, jurisdiction: entity?.jurisdiction ?? '', registrationId: entity?.registrationId ?? null },
      mission: { name: mission?.name ?? invoice.missionId, code: mission?.code ?? null },
    });
    const body = Buffer.from(pdf);
    const storageKey = `${actor.tenantId}/${randomUUID()}`;
    await deps.documentStorage.put(storageKey, body, 'application/pdf');
    try {
      const doc = await attachDocument(P, actor, {
        ownerType: 'Invoice',
        ownerId: invoice.invoiceId,
        fileName: `${invoice.invoiceNumber}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
        storageKey,
        label: null,
      });
      return await linkInvoiceDocument(P, actor, invoice.invoiceId, invoice.version, doc.documentId);
    } catch (err) {
      await deps.documentStorage.delete(storageKey).catch(() => {});
      throw err;
    }
  }

  r.get('/api/v1/invoices', { schema: { response: { 200: invoicesListSchema } } }, async (req) => {
    return { invoices: (await listInvoices(P, actorOf(req))).map(toInvoiceDto) };
  });

  r.get('/api/v1/invoices/:invoiceId', { schema: { params: invoiceIdParamSchema, response: { 200: invoiceResponseSchema } } }, async (req) => {
    const { invoiceId } = req.params as { invoiceId: string };
    return { invoice: toInvoiceDto(await getInvoice(P, actorOf(req), invoiceId)) };
  });

  r.get(
    '/api/v1/invoices/:invoiceId/audit',
    { schema: { params: invoiceIdParamSchema, response: { 200: auditEventsListSchema } } },
    async (req) => {
      const { invoiceId } = req.params as { invoiceId: string };
      const events = await listAuditEvents(P, actorOf(req), 'Invoice', invoiceId);
      return { events: events.map(toAuditEventDto) };
    },
  );

  r.post(
    '/api/v1/invoices',
    { schema: { body: issueInvoiceRequestSchema, response: { 201: invoiceResponseSchema.extend({ pdfError: z.string().optional() }) } } },
    async (req, reply) => {
      const actor = actorOf(req);
      const issued = await issueInvoice(P, actor, req.body as import('@c3web/domain').IssueInvoiceInput);
      try {
        const linked = await generateAndAttachInvoicePdf(actor, issued);
        return reply.status(201).send({ invoice: toInvoiceDto(linked) });
      } catch (err) {
        req.log.error({ err, invoiceId: issued.invoiceId }, 'invoice PDF artifact failed after issue');
        return reply.status(201).send({
          invoice: toInvoiceDto(issued),
          pdfError: 'The invoice was issued, but its PDF could not be stored — retry from the invoice register.',
        });
      }
    },
  );

  r.post(
    '/api/v1/invoices/:invoiceId/document',
    { schema: { params: invoiceIdParamSchema, response: { 200: invoiceResponseSchema } } },
    async (req) => {
      const actor = actorOf(req);
      const { invoiceId } = req.params as { invoiceId: string };
      const current = await getInvoice(P, actor, invoiceId);
      if (current.documentId) return { invoice: toInvoiceDto(current) }; // idempotent: the artifact exists
      return { invoice: toInvoiceDto(await generateAndAttachInvoicePdf(actor, current)) };
    },
  );

  r.post(
    '/api/v1/invoices/:invoiceId/void',
    { schema: { params: invoiceIdParamSchema, body: voidInvoiceRequestSchema, response: { 200: invoiceResponseSchema } } },
    async (req) => {
      const { invoiceId } = req.params as { invoiceId: string };
      const { reason, expectedVersion } = req.body as { reason: string; expectedVersion: number };
      return { invoice: toInvoiceDto(await voidInvoice(P, actorOf(req), invoiceId, reason, expectedVersion)) };
    },
  );

  // ── global search (S3): role-aware — denied domains are simply absent. ────
  r.get('/api/v1/search', { schema: { querystring: searchQuerySchema, response: { 200: searchResultsSchema } } }, async (req) => {
    const { q } = req.query as { q: string };
    const results = await globalSearch(P, actorOf(req), q);
    return { results: results.map((r0) => ({ ...r0 })) };
  });

  // ── data quality (S5 riders): duplicates + the review report — pure read. ──
  r.get('/api/v1/data-quality', { schema: { response: { 200: dataQualityReportSchema } } }, async (req) => {
    const report = await getDataQualityReport(P, actorOf(req));
    return {
      report: {
        duplicatePeople: report.duplicatePeople.map((g) => ({ ...g, people: g.people.map((x) => ({ ...x })) })),
        peopleMissingNationality: report.peopleMissingNationality.map((x) => ({ ...x })),
        peopleMissingRole: report.peopleMissingRole.map((x) => ({ ...x })),
        peopleMissingPersonnelCode: report.peopleMissingPersonnelCode.map((x) => ({ ...x })),
        activeCredentialsPastExpiry: report.activeCredentialsPastExpiry.map((x) => ({ ...x })),
        credentialsWithoutExpiry: report.credentialsWithoutExpiry.map((x) => ({ ...x })),
        activeAgreementsPastEnd: report.activeAgreementsPastEnd.map((x) => ({ ...x })),
        activeAgreementsWithoutCode: report.activeAgreementsWithoutCode.map((x) => ({ ...x })),
      },
    };
  });

  r.get('/api/v1/situation', { schema: { response: { 200: situationResponseSchema } } }, async (req) => {
    const view = await getSituation(P, actorOf(req));
    return {
      todayIso: view.todayIso,
      checks: [...view.checks],
      signals: view.signals.map((s) => ({ ...s, reasons: [...s.reasons], actions: s.actions.map((a) => ({ ...a })) })),
      counts: { ...view.counts },
    };
  });

  // ── the person hub (Sprint 42): person-scoped reads ────────────────────────
  r.get(
    '/api/v1/people/:personId/missions',
    { schema: { params: personIdParamSchema, response: { 200: personMissionsListSchema } } },
    async (req) => {
      const { personId } = req.params as { personId: string };
      return { missions: await listMissionMembershipsForPerson(P, actorOf(req), personId) };
    },
  );

  r.get(
    '/api/v1/people/:personId/approvals',
    { schema: { params: personIdParamSchema, response: { 200: approvalsListSchema } } },
    async (req) => {
      const { personId } = req.params as { personId: string };
      return { approvals: (await listApprovalsForPerson(P, actorOf(req), personId)).map(toApprovalSummaryDto) };
    },
  );

  // ── agreements (Sprint 41): governed material lifecycle + direct patch ────
  // Reads are role-differentiated (canReadAgreements; hr/visitor 403) and the
  // financial field is structurally absent for roles without canViewFinancials.
  r.get('/api/v1/agreements', { schema: { response: { 200: agreementsListSchema } } }, async (req) => {
    return { agreements: (await listAgreements(P, actorOf(req))).map(toAgreementDto) };
  });

  r.get(
    '/api/v1/agreements/:agreementId',
    { schema: { params: agreementIdParamSchema, response: { 200: agreementResponseSchema } } },
    async (req) => {
      const { agreementId } = req.params as { agreementId: string };
      return { agreement: toAgreementDto(await getAgreement(P, actorOf(req), agreementId)) };
    },
  );

  r.get(
    '/api/v1/people/:personId/agreements',
    { schema: { params: personIdParamSchema, response: { 200: agreementsListSchema } } },
    async (req) => {
      const { personId } = req.params as { personId: string };
      return { agreements: (await listAgreementsForPerson(P, actorOf(req), personId)).map(toAgreementDto) };
    },
  );

  r.get(
    '/api/v1/agreements/:agreementId/audit',
    { schema: { params: agreementIdParamSchema, response: { 200: auditEventsListSchema } } },
    async (req) => {
      const { agreementId } = req.params as { agreementId: string };
      const events = await listAuditEvents(P, actorOf(req), 'Agreement', agreementId);
      return { events: events.map(toAuditEventDto) };
    },
  );

  // The material lifecycle is governed: each submit creates an approval that
  // flows through the standard review/approve/execute routes.
  r.post(
    '/api/v1/agreements/requests',
    { schema: { body: submitAddAgreementRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').AddAgreementInput; reason?: string };
      const approval = await submitAddAgreement(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/agreements/renewals',
    { schema: { body: submitRenewAgreementRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').RenewAgreementInput; reason?: string };
      const approval = await submitRenewAgreement(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/agreements/terminations',
    { schema: { body: submitTerminateAgreementRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').TerminateAgreementInput; reason?: string };
      const approval = await submitTerminateAgreement(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  // NON-MATERIAL fields only (code/type/linkage/notes) — direct-but-audited.
  r.post(
    '/api/v1/agreements/:agreementId',
    { schema: { params: agreementIdParamSchema, body: agreementUpdateInputSchema, response: { 200: agreementResponseSchema } } },
    async (req) => {
      const { agreementId } = req.params as { agreementId: string };
      const agreement = await updateAgreement(P, actorOf(req), agreementId, req.body as import('@c3web/domain').AgreementUpdateInput);
      return { agreement: toAgreementDto(agreement) };
    },
  );

  // ── agreement financial terms (Finance S3 read / S3.5 governed writes) ────
  // The READ endpoint is gated to canViewFinancials (legal reads agreements
  // WITHOUT terms; the use-case 403s here). Term CHANGES are MATERIAL money:
  // each rides the approval pipeline (submit → owner executes).
  r.get(
    '/api/v1/agreements/:agreementId/terms',
    { schema: { params: agreementIdParamSchema, response: { 200: agreementTermsListSchema } } },
    async (req) => {
      const { agreementId } = req.params as { agreementId: string };
      return { terms: (await listAgreementTerms(P, actorOf(req), agreementId)).map(toAgreementTermDto) };
    },
  );

  r.post(
    '/api/v1/agreements/terms/requests',
    { schema: { body: submitAddAgreementTermRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').SubmitAddAgreementTermInput; reason?: string };
      const approval = await submitAddAgreementTerm(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/agreements/terms/updates',
    { schema: { body: submitUpdateAgreementTermRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').SubmitUpdateAgreementTermInput; reason?: string };
      const approval = await submitUpdateAgreementTerm(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  r.post(
    '/api/v1/agreements/terms/removals',
    { schema: { body: submitRemoveAgreementTermRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { input: import('@c3web/domain').SubmitRemoveAgreementTermInput; reason?: string };
      const approval = await submitRemoveAgreementTerm(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );

  // ── members (Sprint 35 tenant-admin) ───────────────────────────────────────
  r.get('/api/v1/members', { schema: { response: { 200: membersListSchema } } }, async (req) => {
    const members = await listMembers(P, actorOf(req));
    return { members: members.map(toMemberDto) };
  });

  // Submitting a member change creates a governed approval — review and
  // execution go through the SAME approval routes as every other operation.
  r.post(
    '/api/v1/members/changes',
    { schema: { body: submitMemberChangeRequestSchema, response: { 201: approvalResponseSchema } } },
    async (req, reply) => {
      const body = req.body as { payload: SubmitMemberChangeCommand['payload']; reason?: string };
      const approval = await submitMemberChange(P, actorOf(req), { payload: body.payload, reason: body.reason ?? null });
      return reply.status(201).send({ approval: toApprovalDto(approval, discOf(req)) });
    },
  );
}

// Dev-login schemas kept local (dev-only surface).
interface DevLoginBody {
  email: string;
  displayName?: string;
  role: import('@c3web/domain').C3Role;
  tenantSlug: string;
}
function submitDevLoginSchema() {
  return z.object({
    email: z.string().email(),
    displayName: z.string().optional(),
    role: roleSchema,
    tenantSlug: z.string().min(1),
  });
}
function devLoginResponseSchema() {
  return z.object({
    token: z.string(),
    identity: z.string(),
    displayName: z.string(),
    role: roleSchema,
    tenantSlug: z.string(),
  });
}
