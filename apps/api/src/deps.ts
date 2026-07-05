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

export interface Deps {
  env: Env;
  persistence: PersistenceHandle;
  authAdapter: AuthAdapter;
  directory?: AdminDirectory;
  logger: Logger;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export function buildDeps(env: Env, logger: Logger): Deps {
  const persistence = createPersistence({ appConnectionString: env.databaseUrl });
  const directory = env.databaseAdminUrl ? createAdminDirectory(env.databaseAdminUrl) : undefined;

  let authAdapter: AuthAdapter;
  if (env.authProvider === 'dev') {
    authAdapter = createDevAuthAdapter(env.devAuthSecret!);
  } else {
    if (!directory) throw new Error('Entra provider requires the admin directory (DATABASE_ADMIN_URL).');
    authAdapter = createEntraAuthAdapter(env.entra!, directory);
  }

  return {
    env,
    persistence,
    authAdapter,
    directory,
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
