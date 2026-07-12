/**
 * migrate.ts (CLI) — apply migrations from documented local dev commands.
 *   npm run webv0:db:migrate
 * Reads the privileged admin URL + app role/password from the environment.
 */
import { runMigrations } from '../src/migrate';

function parseAppRole(appUrl: string | undefined): { role: string; password: string } {
  if (!appUrl) return { role: 'c3_app', password: 'c3_app_dev_pw' };
  try {
    const u = new URL(appUrl);
    return { role: decodeURIComponent(u.username) || 'c3_app', password: decodeURIComponent(u.password) || 'c3_app_dev_pw' };
  } catch {
    return { role: 'c3_app', password: 'c3_app_dev_pw' };
  }
}

const adminConnectionString =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://c3_admin:c3_admin_dev_pw@localhost:5432/c3web';
const { role, password } = parseAppRole(process.env.DATABASE_URL);
const auth = process.env.DATABASE_AUTH_URL ? parseAppRole(process.env.DATABASE_AUTH_URL) : null;
// H-01: the backup role secret comes from BACKUP_DB_PASSWORD (or a c3_backup
// connection URL if provided). In production it is REQUIRED and must be strong —
// runMigrations refuses a missing/default value before touching the database.
const backup = process.env.DATABASE_BACKUP_URL ? parseAppRole(process.env.DATABASE_BACKUP_URL) : null;
const requireStrongSecrets = process.env.NODE_ENV === 'production';

runMigrations({
  adminConnectionString,
  appRole: process.env.APP_DB_ROLE ?? role,
  appPassword: process.env.APP_DB_PASSWORD ?? password,
  authRole: process.env.AUTH_DB_ROLE ?? auth?.role ?? 'c3_auth',
  authPassword: process.env.AUTH_DB_PASSWORD ?? auth?.password,
  backupRole: process.env.BACKUP_DB_ROLE ?? backup?.role ?? 'c3_backup',
  backupPassword: process.env.BACKUP_DB_PASSWORD ?? backup?.password,
  requireStrongSecrets,
  log: (m) => console.log(m),
})
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations.');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
