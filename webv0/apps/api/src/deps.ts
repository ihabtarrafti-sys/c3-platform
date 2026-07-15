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
import { createErasureJanitorService, type ErasureJanitorService } from './erasureJanitor';

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
  /** J′: permanent dead-prefix authority. Construction is inert; server.ts owns scheduling. */
  erasureJanitor: ErasureJanitorService;
  /**
   * S-03: contract capture — when present, buildApp reports every registered
   * route (method, url, zod schemas) here. Used ONLY by the contract
   * generator/test; never set in production wiring.
   */
  routeCollector?: (route: { method: string | string[]; url: string; schema?: unknown }) => void;
  /**
   * R5-N01 / HARDEN-3.5 A: the upload-timing triple. `requestTimeoutMs` bounds request RECEIPT
   * (Fastify requestTimeout); `deadlineMs` bounds the WHOLE request (an AbortController armed at
   * arrival aborts every byte-producing op, incl. the storage PUT); `leaseTtlMs` is the intake
   * upload-lease TTL. buildApp refuses to start unless receive ≤ deadline, deadline×2 ≤ lease,
   * and lease ≤ the 0075 DB cap (2h). Defaults 300000 / 420000 / 900000; env-configurable
   * (R6-N05); tests shrink them.
   */
  requestTimeoutMs?: number;
  deadlineMs?: number;
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
  const erasureJanitor = createErasureJanitorService({
    pool: persistence.pool,
    storage: documentStorage,
    logger,
    intervalMs: env.erasureJanitorIntervalMs,
  });

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
    erasureJanitor,
    // R6-N05: the upload-timing triple flows from the environment (undefined = the documented
    // defaults in buildApp). Production can finally configure a slow-link deployment.
    requestTimeoutMs: env.requestReceiveTimeoutMs,
    deadlineMs: env.requestDeadlineMs,
    leaseTtlMs: env.intakeLeaseTtlMs,
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
