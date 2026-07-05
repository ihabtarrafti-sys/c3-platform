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

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().optional(),
  /** Trust X-Forwarded-* ONLY when explicitly enabled at a known proxy boundary. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),

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
});

export type Env = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: z.infer<typeof rawSchema>['LOG_LEVEL'];
  corsOrigin: string;
  trustProxy: boolean;
  databaseUrl: string;
  databaseAdminUrl: string | undefined;
  databaseAuthUrl: string | undefined;
  authProvider: 'dev' | 'entra';
  devAuthSecret: string | undefined;
  entra:
    | { issuer: string; audience: string; jwksUri: string; tenantId: string; scope: string; clientId?: string }
    | undefined;
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

  return {
    nodeEnv: e.NODE_ENV,
    port: e.API_PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigin: e.CORS_ORIGIN ?? 'http://localhost:5173',
    trustProxy: e.TRUST_PROXY === 'true',
    databaseUrl: e.DATABASE_URL,
    databaseAdminUrl: e.DATABASE_ADMIN_URL,
    databaseAuthUrl: e.DATABASE_AUTH_URL,
    authProvider: e.AUTH_PROVIDER,
    devAuthSecret: e.DEV_AUTH_SECRET,
    entra,
  };
}
