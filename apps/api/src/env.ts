/**
 * env.ts — fail-closed environment validation. The process refuses to start if
 * configuration is missing or inconsistent (e.g. the dev IdP enabled in
 * production, or Entra selected without its issuer/audience/JWKS).
 */
import { z } from 'zod';

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL (app role) is required'),
  DATABASE_ADMIN_URL: z.string().optional(),

  AUTH_PROVIDER: z.enum(['dev', 'entra']).default('dev'),
  DEV_AUTH_SECRET: z.string().optional(),

  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_ISSUER: z.string().optional(),
  ENTRA_JWKS_URI: z.string().optional(),
  ENTRA_AUDIENCE: z.string().optional(),
});

export type Env = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: z.infer<typeof rawSchema>['LOG_LEVEL'];
  corsOrigin: string;
  databaseUrl: string;
  databaseAdminUrl: string | undefined;
  authProvider: 'dev' | 'entra';
  devAuthSecret: string | undefined;
  entra: { issuer: string; audience: string; jwksUri: string; tenantId?: string; clientId?: string } | undefined;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;

  // The signed dev test IdP must NEVER be enabled in production.
  if (e.AUTH_PROVIDER === 'dev' && e.NODE_ENV === 'production') {
    throw new Error('AUTH_PROVIDER=dev is forbidden when NODE_ENV=production. Use AUTH_PROVIDER=entra.');
  }
  if (e.AUTH_PROVIDER === 'dev' && !e.DEV_AUTH_SECRET) {
    throw new Error('DEV_AUTH_SECRET is required when AUTH_PROVIDER=dev.');
  }

  let entra: Env['entra'];
  if (e.AUTH_PROVIDER === 'entra') {
    if (!e.ENTRA_ISSUER || !e.ENTRA_AUDIENCE || !e.ENTRA_JWKS_URI) {
      throw new Error('AUTH_PROVIDER=entra requires ENTRA_ISSUER, ENTRA_AUDIENCE and ENTRA_JWKS_URI.');
    }
    entra = {
      issuer: e.ENTRA_ISSUER,
      audience: e.ENTRA_AUDIENCE,
      jwksUri: e.ENTRA_JWKS_URI,
      tenantId: e.ENTRA_TENANT_ID,
      clientId: e.ENTRA_CLIENT_ID,
    };
    // Entra membership resolution needs the privileged directory connection.
    if (!e.DATABASE_ADMIN_URL) {
      throw new Error('AUTH_PROVIDER=entra requires DATABASE_ADMIN_URL for membership resolution.');
    }
  }

  return {
    nodeEnv: e.NODE_ENV,
    port: e.API_PORT,
    logLevel: e.LOG_LEVEL,
    corsOrigin: e.CORS_ORIGIN,
    databaseUrl: e.DATABASE_URL,
    databaseAdminUrl: e.DATABASE_ADMIN_URL,
    authProvider: e.AUTH_PROVIDER,
    devAuthSecret: e.DEV_AUTH_SECRET,
    entra,
  };
}
