/**
 * env.ts — fail-closed environment validation. The process refuses to start if
 * configuration is missing or inconsistent. Production guarantees enforced here:
 *   - the dev IdP can never run in production (AUTH_PROVIDER=dev forbidden);
 *   - production fails closed if ANY dev-auth variable is even present;
 *   - production requires an explicit CORS origin (no localhost default);
 *   - the API's membership resolution uses a SELECT-only auth role
 *     (DATABASE_AUTH_URL) — the privileged migration credentials
 *     (DATABASE_ADMIN_URL) must NOT be given to a production API process.
 */
import { z } from 'zod';
import {
  DEFAULT_ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS,
  DEFAULT_ERASURE_JANITOR_INTERVAL_MS,
  MAX_ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS,
  MAX_ERASURE_JANITOR_INTERVAL_MS,
} from './erasureJanitor';

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().optional(),
  /** Trust X-Forwarded-* ONLY when explicitly enabled at a known proxy boundary. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** Per-client request ceiling per minute (F-1). 0 disables (tests only). */
  RATE_LIMIT_MAX: z.coerce.number().int().min(0).default(300),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL (app role) is required'),
  /** Privileged migration role — migrations/dev tooling only, never the prod API. */
  DATABASE_ADMIN_URL: z.string().optional(),
  /** SELECT-only auth role for membership resolution (production API). */
  DATABASE_AUTH_URL: z.string().optional(),

  AUTH_PROVIDER: z.enum(['dev', 'entra']).default('dev'),
  DEV_AUTH_SECRET: z.string().optional(),

  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_ISSUER: z.string().optional(),
  ENTRA_JWKS_URI: z.string().optional(),
  ENTRA_AUDIENCE: z.string().optional(),
  ENTRA_SCOPE: z.string().default('C3.Access'),

  // S4 documents: private R2 (S3-compatible). All four together, or none —
  // dev/test falls back to a local filesystem driver; production REQUIRES R2.
  R2_ENDPOINT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_DOCUMENTS: z.string().optional(),
  /** Local blob directory for the fs driver (dev/test only). */
  DOCUMENTS_DIR: z.string().optional(),
  // S10 email channel: all five together, or none (rows-only, fails closed).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  BACKUP_STATUS_R2_ENDPOINT: z.string().optional(),
  BACKUP_STATUS_R2_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_STATUS_R2_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_STATUS_R2_BUCKET: z.string().optional(),
  // Track B: FX auto-fetch source. Defaults to a KEYLESS provider (no secret to
  // manage); override to a different endpoint returning { rates: units-per-USD }.
  FX_RATES_URL: z.string().url().optional(),

  // R6-N05 / HARDEN-3.5 A: upload timing is CONFIGURATION, not a hard-coded discovery.
  // All three are optional (defaults preserve today's 5min/7min/15min behavior); the boot
  // algebra in buildApp refuses inconsistent values (receive ≤ deadline; deadline×2 ≤ lease ≤ 2h).
  /** Fastify requestTimeout: max ms to RECEIVE a request body. Default 300000 (5 min). */
  REQUEST_RECEIVE_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(3_600_000).optional(),
  /** The full request-lifetime deadline (aborts every byte-producing op). Default 420000 (7 min). */
  REQUEST_DEADLINE_MS: z.coerce.number().int().min(30_000).max(3_600_000).optional(),
  /** Intake upload-lease TTL. Default 900000 (15 min). DB-capped at 2h by migration 0075. */
  INTAKE_LEASE_TTL_MS: z.coerce.number().int().min(60_000).max(7_200_000).optional(),
  /** J′: permanent erased-prefix sweep cadence. Never slower than daily; tests shrink it. */
  ERASURE_JANITOR_INTERVAL_MS: z.coerce.number().int().positive().max(MAX_ERASURE_JANITOR_INTERVAL_MS)
    .default(DEFAULT_ERASURE_JANITOR_INTERVAL_MS),
  /** H6: readiness waits this long; the already-started safety pass is never cancelled. */
  ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS: z.coerce.number().int().positive()
    .max(MAX_ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS)
    .default(DEFAULT_ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS),
});

export type Env = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: z.infer<typeof rawSchema>['LOG_LEVEL'];
  corsOrigin: string;
  trustProxy: boolean;
  /** Requests per minute per client key; 0 = disabled (tests only). */
  rateLimitMax: number;
  databaseUrl: string;
  databaseAdminUrl: string | undefined;
  databaseAuthUrl: string | undefined;
  authProvider: 'dev' | 'entra';
  devAuthSecret: string | undefined;
  entra:
    | { issuer: string; audience: string; jwksUri: string; tenantId: string; scope: string; clientId?: string }
    | undefined;
  documents:
    | { driver: 'r2'; endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string }
    | { driver: 'fs'; dir: string };
  /** S10 email channel; null = not configured (rows-only, honest). */
  smtp: { host: string; port: number; user: string; pass: string; from: string } | null;
  /** Tier 0.5 backup-status tile: read-only marker lookup; null = not configured. */
  backupStatus: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string } | null;
  /** Track B: FX auto-fetch source (keyless by default). */
  fxRatesUrl: string;
  /** R6-N05: upload timing knobs (undefined = the documented defaults; validated in buildApp). */
  requestReceiveTimeoutMs: number | undefined;
  requestDeadlineMs: number | undefined;
  intakeLeaseTtlMs: number | undefined;
  /** J′: API-process interval; schema caps it at one day. */
  erasureJanitorIntervalMs: number;
  /** H6: bounded pre-listen wait; expiration does not stop the boot pass. */
  erasureJanitorBootReadinessBudgetMs: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';

  // ── production fail-closed guards ─────────────────────────────────────────
  if (isProduction) {
    // The signed dev test IdP must NEVER run in production...
    if (e.AUTH_PROVIDER === 'dev') {
      throw new Error('AUTH_PROVIDER=dev is forbidden when NODE_ENV=production. Use AUTH_PROVIDER=entra.');
    }
    // ...and production startup fails closed if dev-auth material is even PRESENT.
    if (e.DEV_AUTH_SECRET !== undefined) {
      throw new Error('DEV_AUTH_SECRET must not be set in production. Remove the variable entirely.');
    }
    if (!e.CORS_ORIGIN) {
      throw new Error('CORS_ORIGIN must be set explicitly in production (no localhost default).');
    }
    // Rate limiting may not be disabled in production (0 is a test-only escape).
    if (e.RATE_LIMIT_MAX === 0) {
      throw new Error('RATE_LIMIT_MAX=0 (disabled) is forbidden in production.');
    }
    // The privileged migration role must not be handed to the production API.
    if (e.DATABASE_ADMIN_URL) {
      throw new Error(
        'DATABASE_ADMIN_URL must not be provided to the production API process. ' +
          'Run migrations from a separate one-shot job; give the API DATABASE_AUTH_URL (SELECT-only role) instead.',
      );
    }
  }

  if (e.AUTH_PROVIDER === 'dev') {
    if (!e.DEV_AUTH_SECRET) throw new Error('DEV_AUTH_SECRET is required when AUTH_PROVIDER=dev.');
    if (e.DEV_AUTH_SECRET.length < 16) throw new Error('DEV_AUTH_SECRET must be at least 16 characters.');
    // Dev login provisions memberships — it needs the privileged directory.
    if (!e.DATABASE_ADMIN_URL) throw new Error('AUTH_PROVIDER=dev requires DATABASE_ADMIN_URL (local dev/test only).');
  }

  let entra: Env['entra'];
  if (e.AUTH_PROVIDER === 'entra') {
    if (!e.ENTRA_ISSUER || !e.ENTRA_AUDIENCE || !e.ENTRA_JWKS_URI) {
      throw new Error('AUTH_PROVIDER=entra requires ENTRA_ISSUER, ENTRA_AUDIENCE and ENTRA_JWKS_URI.');
    }
    if (!e.ENTRA_TENANT_ID) {
      throw new Error('AUTH_PROVIDER=entra requires ENTRA_TENANT_ID (tokens are pinned to one tenant).');
    }
    // Tenant-specific v2 issuer ONLY: no common/organizations/consumers and no
    // multi-tenant resolution in this staging phase.
    const issuer = e.ENTRA_ISSUER;
    if (/\/(common|organizations|consumers)\//i.test(issuer)) {
      throw new Error('ENTRA_ISSUER must be the tenant-specific v2 issuer, not common/organizations/consumers.');
    }
    if (!issuer.includes(e.ENTRA_TENANT_ID) || !/\/v2\.0\/?$/.test(issuer)) {
      throw new Error('ENTRA_ISSUER must be https://login.microsoftonline.com/<ENTRA_TENANT_ID>/v2.0');
    }
    entra = {
      issuer,
      audience: e.ENTRA_AUDIENCE,
      jwksUri: e.ENTRA_JWKS_URI,
      tenantId: e.ENTRA_TENANT_ID,
      scope: e.ENTRA_SCOPE,
      clientId: e.ENTRA_CLIENT_ID,
    };
    // Entra membership resolution uses the SELECT-only auth role. (In non-prod
    // environments the admin URL is accepted as a fallback for convenience.)
    if (!e.DATABASE_AUTH_URL && !(e.DATABASE_ADMIN_URL && !isProduction)) {
      throw new Error('AUTH_PROVIDER=entra requires DATABASE_AUTH_URL (SELECT-only membership role).');
    }
  }

  // ── S4 documents storage: all-or-none R2 config; production fails closed. ──
  const r2Given = [e.R2_ENDPOINT, e.R2_ACCESS_KEY_ID, e.R2_SECRET_ACCESS_KEY, e.R2_BUCKET_DOCUMENTS].filter(Boolean).length;
  if (r2Given > 0 && r2Given < 4) {
    throw new Error('Documents R2 config is partial: set ALL of R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_DOCUMENTS — or none.');
  }
  if (isProduction && r2Given === 0) {
    throw new Error('Production requires the documents R2 configuration (the fs driver is dev/test only).');
  }
  // ── S10 email channel: all-or-none; absent = rows-only (fails closed). ────
  const smtpGiven = [e.SMTP_HOST, e.SMTP_PORT, e.SMTP_USER, e.SMTP_PASS, e.SMTP_FROM].filter((v) => v !== undefined).length;
  if (smtpGiven > 0 && smtpGiven < 5) {
    throw new Error('SMTP config is partial: set ALL of SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM — or none.');
  }
  const smtp: Env['smtp'] = smtpGiven === 5 ? { host: e.SMTP_HOST!, port: e.SMTP_PORT!, user: e.SMTP_USER!, pass: e.SMTP_PASS!, from: e.SMTP_FROM! } : null;

  // ── Tier 0.5 backup-status tile: all-or-none; absent = 'not configured'. ──
  const bkGiven = [e.BACKUP_STATUS_R2_ENDPOINT, e.BACKUP_STATUS_R2_ACCESS_KEY_ID, e.BACKUP_STATUS_R2_SECRET_ACCESS_KEY, e.BACKUP_STATUS_R2_BUCKET].filter((v) => v !== undefined).length;
  if (bkGiven > 0 && bkGiven < 4) {
    throw new Error('Backup-status config is partial: set ALL of BACKUP_STATUS_R2_ENDPOINT, BACKUP_STATUS_R2_ACCESS_KEY_ID, BACKUP_STATUS_R2_SECRET_ACCESS_KEY, BACKUP_STATUS_R2_BUCKET — or none.');
  }
  const backupStatus: Env['backupStatus'] = bkGiven === 4
    ? { endpoint: e.BACKUP_STATUS_R2_ENDPOINT!, accessKeyId: e.BACKUP_STATUS_R2_ACCESS_KEY_ID!, secretAccessKey: e.BACKUP_STATUS_R2_SECRET_ACCESS_KEY!, bucket: e.BACKUP_STATUS_R2_BUCKET! }
    : null;

  const documents: Env['documents'] =
    r2Given === 4
      ? { driver: 'r2', endpoint: e.R2_ENDPOINT!, accessKeyId: e.R2_ACCESS_KEY_ID!, secretAccessKey: e.R2_SECRET_ACCESS_KEY!, bucket: e.R2_BUCKET_DOCUMENTS! }
      : { driver: 'fs', dir: e.DOCUMENTS_DIR ?? '.data/documents' };

  return {
    nodeEnv: e.NODE_ENV,
    port: e.API_PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigin: e.CORS_ORIGIN ?? 'http://localhost:5173',
    trustProxy: e.TRUST_PROXY === 'true',
    rateLimitMax: e.RATE_LIMIT_MAX,
    databaseUrl: e.DATABASE_URL,
    databaseAdminUrl: e.DATABASE_ADMIN_URL,
    databaseAuthUrl: e.DATABASE_AUTH_URL,
    authProvider: e.AUTH_PROVIDER,
    devAuthSecret: e.DEV_AUTH_SECRET,
    entra,
    documents,
    smtp,
    backupStatus,
    fxRatesUrl: e.FX_RATES_URL ?? 'https://open.er-api.com/v6/latest/USD',
    requestReceiveTimeoutMs: e.REQUEST_RECEIVE_TIMEOUT_MS,
    requestDeadlineMs: e.REQUEST_DEADLINE_MS,
    intakeLeaseTtlMs: e.INTAKE_LEASE_TTL_MS,
    erasureJanitorIntervalMs: e.ERASURE_JANITOR_INTERVAL_MS,
    erasureJanitorBootReadinessBudgetMs: e.ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS,
  };
}
