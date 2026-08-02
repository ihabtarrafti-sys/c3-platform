/**
 * deps.ts — assemble runtime dependencies from validated env. Wires the
 * least-privileged app persistence, the auth adapter (dev or entra), and the
 * privileged directory (dev login + entra membership resolution).
 */
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
import { readBuildStamp, readRuntimeIdentity, type BuildStamp, type RuntimeIdentity } from './buildIdentity';

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
  ready(): Promise<Readiness>;
  close(): Promise<void>;
}

/** `not-configured` is a THIRD state on purpose — it is neither working nor broken. */
export type ReadinessCheck = 'ok' | 'failed' | 'not-configured';

/**
 * ⛔ WHY READINESS NAMES ITS CHECKS (2026-08-02, Neural's finding).
 *
 * `/ready` used to return a single boolean derived from ONE query on the
 * `c3_app` pool. **Authentication does not use that pool.** It uses `c3_auth` —
 * a different role, a different credential, a different pool — and that
 * credential's password never matched `DATABASE_AUTH_URL` from the day the
 * production environment was built. Every sign-in failed. **`/health` AND
 * `/ready` were green throughout.**
 *
 * ⚖️ `/ready` was answering *"can I reach the database as the app role"* while
 * being read as *"is the service working."* That is worse than `/health`,
 * because `/health` never claimed to know — `/ready` LOOKS like it covers this.
 *
 * ⇒ The rule this type enforces: **readiness must exercise every credential the
 * request path depends on, or state which ones it does not.** A partial check
 * is fine; a partial check that reads as total is the defect. So the response
 * carries the checks BY NAME, and `unchecked` states the gap out loud rather
 * than leaving a reader to assume coverage that was never there.
 */
export interface Readiness {
  readonly ready: boolean;
  readonly checks: {
    /** `c3_app` — business data. */
    readonly app: ReadinessCheck;
    /** `c3_auth` — identity resolution. The credential the outage was in. */
    readonly directory: ReadinessCheck;
  };
  /**
   * Dependencies deliberately NOT probed here, named so the gap is legible.
   * These are per-request or scheduled concerns whose failure is reported where
   * it happens; probing them on a public unauthenticated endpoint would add
   * external calls to the one route that must stay cheap and always answerable.
   */
  readonly unchecked: readonly string[];
}

const UNCHECKED_DEPENDENCIES = ['documentStorage', 'mailer', 'fxProvider', 'commsLiveBus'] as const;

/**
 * The build stamp is set on the platform by `scripts/stampBuild.mts` immediately
 * before `railway up`, and is absent in dev/test (nobody stamps a local run).
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
  const buildStamp = readBuildStamp(process.env);

  if (env.nodeEnv === 'production') {
    if (!buildStamp) {
      throw new Error(
        'Refusing to start: NODE_ENV=production with no C3_BUILD_TOKEN. Run apps/api/scripts/stampBuild.mts ' +
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
    async ready(): Promise<Readiness> {
      // ⛔ BOTH CREDENTIALS, AND THE ERRORS ARE LOGGED. The outage this replaces
      // was invisible twice over: the check never touched `c3_auth`, and the one
      // place the failure did surface swallowed the reason. A readiness check
      // that fails without saying why moves the diagnosis off the machine.
      const probe = async (name: string, run: () => Promise<unknown>): Promise<ReadinessCheck> => {
        try {
          await run();
          return 'ok';
        } catch (err) {
          logger.error({ err, check: name }, 'readiness check failed');
          return 'failed';
        }
      };

      const [app, directoryCheck] = await Promise.all([
        probe('app', () => persistence.pool.query('SELECT 1')),
        // `not-configured` rather than `ok`: an API that cannot resolve identity
        // is not ready, and saying "ok" for an absent dependency is the exact
        // conflation this whole change exists to remove.
        directory ? probe('directory', () => directory.probe()) : Promise.resolve<ReadinessCheck>('not-configured'),
      ]);

      return {
        ready: app === 'ok' && directoryCheck === 'ok',
        checks: { app, directory: directoryCheck },
        unchecked: UNCHECKED_DEPENDENCIES,
      };
    },
    async close() {
      await liveBus?.stop().catch(() => {});
      await persistence.close();
      if (directory) await directory.close();
    },
  };
}
