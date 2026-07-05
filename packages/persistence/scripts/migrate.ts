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

runMigrations({
  adminConnectionString,
  appRole: process.env.APP_DB_ROLE ?? role,
  appPassword: process.env.APP_DB_PASSWORD ?? password,
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
