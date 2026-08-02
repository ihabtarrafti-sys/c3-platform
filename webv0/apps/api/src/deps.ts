/**
 * deps.ts — assemble runtime dependencies from validated env. Wires the
 * least-privileged app persistence, the auth adapter (dev or entra), and the
 * privileged directory (dev login + entra membership resolution).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import { createPersistence, type PersistenceHandle } from '@c3web/persistence';
import type { CommsLiveBus } from '@c3web/persistence';
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
import { readRuntimeIdentity, type BuildStamp, type RuntimeIdentity } from './buildIdentity';

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
  /** Phase B-LIVE: the live fan-out bus. null until attached (or when the
   *  channel could not be established) — the stream then serves a DEGRADED
   *  health so the client goes stale instead of trusting silence. */
  commsLiveBus: CommsLiveBus | null;
  /** Instance 32: the build actually running, or null when unstamped. */
  buildStamp: BuildStamp | null;
  /** Platform-injected environment identity, or null when not on the platform. */
  runtimeIdentity: RuntimeIdentity | null;
  /** Attach the bus after boot (a dedicated session-scoped LISTEN connection,
   *  never a pooled client: LISTEN is session state). */
  attachCommsLiveBus(bus: CommsLiveBus): void;
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

/**
 * The build stamp is written by `scripts/stampBuild.mts` immediately before
 * `railway up`, and is absent in dev/test (nobody stamps a local run).
 *
 * ⛔ FAIL-CLOSED IN PRODUCTION, and this is the half that makes the tell
 * trustworthy: a production process that cannot say WHICH build it is refuses to
 * start. Otherwise the endpoint degrades to `buildToken: null` — which looks
 * like an answer, reads as "no version", and quietly restores exactly the state
 * instance 32 exists to end. Same reasoning as the CSP emitter: a build that
 * cannot state its own identity must not claim one.
 */
function loadBuildIdentity(env: Env): { buildStamp: BuildStamp | null; runtimeIdentity: RuntimeIdentity | null } {
  const runtimeIdentity = readRuntimeIdentity(process.env);
  let buildStamp: BuildStamp | null = null;
  try {
    // apps/api/buildStamp.json — one level ABOVE src/, which is a frozen policy
    // root whose tree hash is a sunset fingerprint. A generated file inside it
    // would move a seal on every deploy.
    const raw = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'buildStamp.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BuildStamp>;
    if (parsed.buildToken && parsed.stampedAt) {
      buildStamp = { buildToken: parsed.buildToken, stampedAt: parsed.stampedAt };
    }
  } catch {
    /* absent in dev/test — refused below when it matters */
  }

  if (env.nodeEnv === 'production') {
    if (!buildStamp) {
      throw new Error(
        'Refusing to start: NODE_ENV=production with no build stamp. Run apps/api/scripts/stampBuild.mts ' +
          'before `railway up` — an unstamped production process cannot say which build it is.',
      );
    }
    if (!runtimeIdentity) {
      throw new Error(
        'Refusing to start: NODE_ENV=production with no platform identity (RAILWAY_PROJECT_ID absent or empty). ' +
          'Absence means this is not running where we think it is, which is exactly the condition worth failing on.',
      );
    }
  }
  return { buildStamp, runtimeIdentity };
}

export function buildDeps(env: Env, logger: Logger): Deps {
  const { buildStamp, runtimeIdentity } = loadBuildIdentity(env);
  let liveBus: CommsLiveBus | null = null;
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
    // The dev adapter needs the directory to SERVER-resolve the stable userId
    // (never a self-asserted token claim); dev provisioning uses the same connection.
    if (!directory) throw new Error('Dev provider requires a membership directory connection.');
    authAdapter = createDevAuthAdapter(env.devAuthSecret!, directory);
  } else {
    if (!directory) throw new Error('Entra provider requires a membership directory connection.');
    authAdapter = createEntraAuthAdapter(env.entra!, directory);
  }

  return {
    env,
    persistence,
    authAdapter,
    directory,
    buildStamp,
    runtimeIdentity,
    documentStorage,
    fxProvider,
    mailer,
    get commsLiveBus() {
      return liveBus;
    },
    attachCommsLiveBus(bus: CommsLiveBus) {
      liveBus = bus;
    },
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
      await liveBus?.stop().catch(() => {});
      await persistence.close();
      if (directory) await directory.close();
    },
  };
}
