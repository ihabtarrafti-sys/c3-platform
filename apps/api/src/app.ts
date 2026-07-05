/**
 * app.ts — build the Fastify application (not listening). Used by the server,
 * the OpenAPI generator, and the integration tests. Every /api/v1 route is
 * authenticated (except the dev login), validated against zod request/response
 * schemas, and answered with a structured error envelope carrying the
 * correlation id.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import {
  approvalIdParamSchema,
  approvalResponseSchema,
  approvalsListSchema,
  approvalEventsListSchema,
  auditEventsListSchema,
  errorResponseSchema,
  executeResponseSchema,
  meResponseSchema,
  peopleListSchema,
  personIdParamSchema,
  personResponseSchema,
  rejectRequestSchema,
  roleSchema,
  submitAddPersonRequestSchema,
  versionedRequestSchema,
} from '@c3web/api-contracts';
import { capabilityView } from '@c3web/authz';
import {
  approveApproval,
  beginReview,
  executeApproval,
  getApproval,
  getPerson,
  listApprovalEvents,
  listApprovals,
  listAuditEvents,
  listPeople,
  rejectApproval,
  submitAddPerson,
} from '@c3web/application';
import type { Deps } from './deps';
import { loggerOptions } from './logger';
import { mapError } from './httpErrors';
import { AuthError } from './auth/types';
import { signDevToken } from './auth/devIdp';
import { toApprovalDto, toApprovalEventDto, toAuditEventDto, toPersonDto } from './dto';

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

  // Bearer-token auth: no cookies, so no credentialed CORS.
  app.register(cors, { origin: deps.env.corsOrigin });
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

  // Authentication: all /api/v1 routes except the dev login require a bearer token.
  app.addHook('onRequest', async (req, reply) => {
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
      const code = (error as { code?: string }).code ?? 'BAD_REQUEST';
      return sendError(req, reply, anyErr.statusCode, code, error.message);
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
        await directory.upsertMembership(tenant.tenantId, email, name, role);
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
    return { identity: pr.identity, displayName: pr.displayName, role: pr.role, tenantSlug: pr.tenantSlug, capabilities: capabilityView(pr.role) };
  });

  // ── people ───────────────────────────────────────────────────────────────
  r.get('/api/v1/people', { schema: { response: { 200: peopleListSchema } } }, async (req) => {
    const people = await listPeople(P, actorOf(req));
    return { people: people.map(toPersonDto) };
  });

  r.get('/api/v1/people/:personId', { schema: { params: personIdParamSchema, response: { 200: personResponseSchema } } }, async (req) => {
    const { personId } = req.params as { personId: string };
    return { person: toPersonDto(await getPerson(P, actorOf(req), personId)) };
  });

  r.get('/api/v1/people/:personId/audit', { schema: { params: personIdParamSchema, response: { 200: auditEventsListSchema } } }, async (req) => {
    const { personId } = req.params as { personId: string };
    const events = await listAuditEvents(P, actorOf(req), 'Person', personId);
    return { events: events.map(toAuditEventDto) };
  });

  // ── approvals ──────────────────────────────────────────────────────────────
  r.get('/api/v1/approvals', { schema: { response: { 200: approvalsListSchema } } }, async (req) => {
    const approvals = await listApprovals(P, actorOf(req));
    return { approvals: approvals.map(toApprovalDto) };
  });

  r.post('/api/v1/approvals', { schema: { body: submitAddPersonRequestSchema, response: { 201: approvalResponseSchema } } }, async (req, reply) => {
    const body = req.body as { input: import('@c3web/domain').AddPersonInput; reason?: string };
    const approval = await submitAddPerson(P, actorOf(req), { input: body.input, reason: body.reason ?? null });
    return reply.status(201).send({ approval: toApprovalDto(approval) });
  });

  r.get('/api/v1/approvals/:approvalId', { schema: { params: approvalIdParamSchema, response: { 200: approvalResponseSchema } } }, async (req) => {
    const { approvalId } = req.params as { approvalId: string };
    return { approval: toApprovalDto(await getApproval(P, actorOf(req), approvalId)) };
  });

  const versionedAction =
    (fn: (approvalId: string, req: FastifyRequest) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { approvalId } = req.params as { approvalId: string };
      const result = await fn(approvalId, req);
      return reply.send(result);
    };

  r.post(
    '/api/v1/approvals/:approvalId/begin-review',
    { schema: { params: approvalIdParamSchema, body: versionedRequestSchema, response: { 200: approvalResponseSchema } } },
    versionedAction(async (approvalId, req) => {
      const { expectedVersion } = req.body as { expectedVersion: number };
      return { approval: toApprovalDto(await beginReview(P, actorOf(req), approvalId, expectedVersion)) };
    }),
  );

  r.post(
    '/api/v1/approvals/:approvalId/approve',
    { schema: { params: approvalIdParamSchema, body: versionedRequestSchema, response: { 200: approvalResponseSchema } } },
    versionedAction(async (approvalId, req) => {
      const { expectedVersion } = req.body as { expectedVersion: number };
      return { approval: toApprovalDto(await approveApproval(P, actorOf(req), approvalId, expectedVersion)) };
    }),
  );

  r.post(
    '/api/v1/approvals/:approvalId/reject',
    { schema: { params: approvalIdParamSchema, body: rejectRequestSchema, response: { 200: approvalResponseSchema } } },
    versionedAction(async (approvalId, req) => {
      const { expectedVersion, reason } = req.body as { expectedVersion: number; reason: string };
      return { approval: toApprovalDto(await rejectApproval(P, actorOf(req), approvalId, expectedVersion, reason)) };
    }),
  );

  r.post(
    '/api/v1/approvals/:approvalId/execute',
    { schema: { params: approvalIdParamSchema, body: versionedRequestSchema, response: { 200: executeResponseSchema } } },
    versionedAction(async (approvalId, req) => {
      const { expectedVersion } = req.body as { expectedVersion: number };
      const res = await executeApproval(P, actorOf(req), approvalId, expectedVersion);
      return { approval: toApprovalDto(res.approval), person: res.person ? toPersonDto(res.person) : null, idempotent: res.idempotent };
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
