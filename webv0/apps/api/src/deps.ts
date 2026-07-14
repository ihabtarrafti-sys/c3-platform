/**
 * deps.ts — assemble runtime dependencies from validated env. Wires the
 * least-privileged app persistence, the auth adapter (dev or entra), and the
 * privileged directory (dev login + entra membership resolution).
 */
import type { Logger } from 'pino';
import { createPersistence, type PersistenceHandle } from '@c3web/persistence';
import type { Env } from './env';
import type { AuthAdapter } from './auth/types';
import { createDevAuthAdapter } from './auth/devIdp';
import { createEntraAuthAdapter } from './auth/entra';
import { createAdminDirectory, type AdminDirectory } from './auth/directory';
import { createDocumentStorage, type DocumentStorage } from './storage';
import { createMailer, type Mailer } from './mailer';
import { createBackupStatusReader, type BackupStatusView } from './backupStatus';
import { createFxProvider, type FxProvider } from './fxProvider';

export interface Deps {
  env: Env;
  persistence: PersistenceHandle;
  authAdapter: AuthAdapter;
  directory?: AdminDirectory;
  documentStorage: DocumentStorage;
  /** Track B: FX auto-fetch source (keyless HTTP by default; stubbed in tests). */
  fxProvider: FxProvider;
  /** S10 email channel; null = not configured (rows-only). */
  mailer: Mailer | null;
  /** Tier 0.5 backup tile; always callable, honest when unconfigured. */
  backupStatus: () => Promise<BackupStatusView>;
  logger: Logger;
  /**
   * S-03: contract capture — when present, buildApp reports every registered
   * route (method, url, zod schemas) here. Used ONLY by the contract
   * generator/test; never set in production wiring.
   */
  routeCollector?: (route: { method: string | string[]; url: string; schema?: unknown }) => void;
  /**
   * R5-N01: the request lifetime bound (Fastify requestTimeout) and the intake upload-lease TTL.
   * buildApp refuses to start unless requestTimeout > 0 && requestTimeout × 2 ≤ leaseTtl — so an
   * HTTP request can never outlive its lease. Defaults 300000 / 900000; tests shrink them.
   */
  requestTimeoutMs?: number;
  leaseTtlMs?: number;
  /**
   * TEST-ONLY: how often Node checks for expired request timeouts (default 30s). A test
   * shrinks it so a short requestTimeout is DETECTED (and the stalled request aborted)
   * promptly. Production leaves it undefined (Node's 30s default — a fine granularity under
   * a 5-min requestTimeout / 15-min lease).
   */
  connectionsCheckingIntervalMs?: number;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export function buildDeps(env: Env, logger: Logger): Deps {
  const persistence = createPersistence({ appConnectionString: env.databaseUrl });
  const documentStorage = createDocumentStorage(env.documents);
  const fxProvider = createFxProvider(env.fxRatesUrl, logger);
  const mailer = createMailer(env, logger);
  const backupStatus = createBackupStatusReader(env);

  // Membership resolution: production Entra uses the SELECT-only c3_auth role.
  // The dev IdP needs the privileged directory (it provisions memberships) and
  // is only permitted outside production (enforced by env validation).
  const directoryUrl =
    env.authProvider === 'entra' ? (env.databaseAuthUrl ?? env.databaseAdminUrl) : env.databaseAdminUrl;
  const directory = directoryUrl ? createAdminDirectory(directoryUrl) : undefined;

  let authAdapter: AuthAdapter;
  if (env.authProvider === 'dev') {
    authAdapter = createDevAuthAdapter(env.devAuthSecret!);
  } else {
    if (!directory) throw new Error('Entra provider requires a membership directory connection.');
    authAdapter = createEntraAuthAdapter(env.entra!, directory);
  }

  return {
    env,
    persistence,
    authAdapter,
    directory,
    documentStorage,
    fxProvider,
    mailer,
    backupStatus,
    logger,
    async ready() {
      try {
        await persistence.pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await persistence.close();
      if (directory) await directory.close();
    },
  };
}
