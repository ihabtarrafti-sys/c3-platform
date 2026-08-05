/**
 * migrate.ts — apply the ordered SQL migrations as the PRIVILEGED admin role,
 * and ensure the least-privileged application role exists (separate from the
 * admin/migration connection). Migrations are tracked in `_migrations` and
 * applied at most once, each in its own transaction.
 *
 * HARDEN-0 (audit H-08): the ledger stores a SHA-256 of each applied file.
 * A previously applied migration whose file content later changes FAILS the
 * run loudly — applied migrations are FROZEN; corrections ship as NEW files.
 * Rows applied before checksums existed (or inserted manually by the staging
 * paste choreography) carry NULL and are adopted with the current hash on the
 * next run — the freeze protects from that moment forward.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
// R2-N04 (Batch D): a migration NNNN.sql MAY have a sibling preflights/NNNN.sql — an
// idempotent repair the runner executes in the migration's OWN transaction, immediately
// before its SQL, but only when the migration is pending. See runMigrations for why.
const PREFLIGHTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'preflights');
const ROLE_RE = /^[a-z_][a-z0-9_]*$/;
// R6-N03: the migrator's single-flight advisory-lock key (class), paired with
// hashtext(current_database()) so migrators of DIFFERENT databases on one cluster don't collide.
const MIGRATOR_LOCK_KEY = 928_340_015;

export interface MigrateConfig {
  /** Privileged connection (schema owner / superuser) used ONLY for migrations. */
  readonly adminConnectionString: string;
  /** Name of the least-privileged application role to ensure. */
  readonly appRole: string;
  /** Password to (re)set on the application role. */
  readonly appPassword: string;
  /** Name of the SELECT-only membership-resolution role (default c3_auth). */
  readonly authRole?: string;
  /** Password to (re)set on the auth role. */
  readonly authPassword?: string;
  /** Name of the read-only logical-backup role (default c3_backup). */
  readonly backupRole?: string;
  /** Password to (re)set on the backup role. */
  readonly backupPassword?: string;
  /**
   * H-01.1: FAIL-CLOSED. Explicit opt-IN to the dev/test convenience secrets.
   * When this is not exactly `true`, every role password must be explicit and
   * non-default (refused before the DB is touched) — an absent, mistyped, or
   * non-dev NODE_ENV must NEVER silently restore the published default onto the
   * BYPASSRLS backup role (it reads every tenant). Round-1's opt-IN-to-safety
   * (`requireStrongSecrets`, keyed on exact NODE_ENV==='production') is replaced
   * by this opt-IN-to-danger flag.
   */
  readonly allowDevSecrets?: boolean;
  /**
   * H-01.1: (ALTER) an EXISTING role's password. Ordinary schema migrations must
   * leave live role secrets untouched — rotating the backup credential is an
   * explicit, separate act, decoupled from applying schema. A role that does not
   * yet exist is always CREATEd with the supplied password regardless.
   */
  readonly rotateRoleSecrets?: boolean;
  /**
   * ⛔ The consumer-facing connection strings, for rotation agreement and the
   * live secret check. Rotation REFUSES without the relevant one — a rotation
   * that cannot be checked against what its consumers read is applied blind,
   * and this environment has paid for that three times.
   */
  readonly consumerConnectionStrings?: {
    readonly app?: string;
    readonly auth?: string;
    readonly backup?: string;
  };
  readonly log?: (msg: string) => void;
  /**
   * TEST-ONLY: stop after processing the migration whose filename equals this value
   * (inclusive). Lets a test reproduce a REAL from-<N> replay — apply through 0047,
   * seed a pathological row, then resume the rest — rather than hand-fake schema state
   * that would drift from the true migration history. Never set on a production path.
   */
  readonly targetInclusive?: string;
  /**
   * TEST-ONLY: override the directory preflights are read from (default: the package's
   * `preflights/`). Lets a test point at a throwaway preflight it can edit, to prove the
   * ledger detects a preflight change. Never set on a production path.
   */
  readonly preflightsDir?: string;
  /**
   * TEST-ONLY: awaited immediately BEFORE a legacy-NULL preflight adoption write. Lets the
   * two-runner discriminator hold both runners inside the snapshot→adopt window at once (a
   * 2-party latch) — the exact overlap R6-N03 names. Never set on a production path.
   */
  readonly beforeAdoptHook?: (file: string) => Promise<void>;
}

/** Published dev/default role passwords that must never reach a real environment. */
const WEAK_SECRETS: ReadonlySet<string> = new Set([
  'c3_app_dev_pw',
  'c3_auth_dev_pw',
  'c3_backup_dev_pw',
  'c3_admin_dev_pw',
]);

/** H-01: refuse a missing or published-default secret when strong secrets are required. */
function assertStrongSecret(label: string, value: string | undefined): void {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Refusing to migrate: ${label} is required outside dev/test — set an explicit strong secret.`);
  }
  if (WEAK_SECRETS.has(value)) {
    throw new Error(`Refusing to migrate: ${label} is a PUBLISHED dev default — set an explicit strong secret (a BYPASSRLS role must never carry a known password).`);
  }
}

/**
 * H-01.1: fail-closed migrate secret mode. The dev/test convenience secrets are
 * permitted ONLY when NODE_ENV *explicitly* selects dev or test; every other
 * value — absent, mistyped, 'production', 'staging', … — requires strong
 * secrets. Rotation of existing role passwords is a separate explicit opt-in.
 */
export function resolveSecretMode(env: NodeJS.ProcessEnv): { allowDevSecrets: boolean; rotateRoleSecrets: boolean } {
  const nodeEnv = (env.NODE_ENV ?? '').trim();
  const allowDevSecrets = nodeEnv === 'development' || nodeEnv === 'test';
  const rotateRoleSecrets = env.MIGRATE_ROTATE_ROLE_SECRETS === 'yes';
  return { allowDevSecrets, rotateRoleSecrets };
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * What actually happened to a role's password on this run.
 *
 * ⛔ THE DEFECT THIS EXISTS TO END. The runner DEMANDS a password for every role
 * (`assertStrongSecret` refuses without one), then applies it only when the role
 * is ABSENT — an existing role's password changes only under the opt-in
 * `MIGRATE_ROTATE_ROLE_SECRETS=yes`. **And it reported which nowhere.** So the
 * operator's only evidence was the input they supplied, and *"I passed a
 * password"* silently became *"the password is now that."*
 *
 * ⚖️ Three credential disagreements in this environment have come from that gap:
 * `c3_auth` — found by a TOTAL sign-in outage that `/health` and `/ready` both
 * called healthy — and `c3_backup` twice, the second time recorded as done by
 * the person who wrote the law about asserting capabilities from inputs.
 *
 * ⇒ **A tool that takes a secret must say whether it APPLIED it.** Same family as
 * LAW 32: the state, not the intention, is the thing worth reporting.
 */
export type RoleSecretOutcome = 'created-with-password' | 'password-rotated' | 'left-existing-password';

/**
 * Which outcome a run produces, given whether the role already exists and
 * whether rotation was requested. Pure, so the reporting can be tested without
 * a database — the branch that misleads is the one nobody exercises.
 */
export function classifyRoleSecretOutcome(existed: boolean, rotate: boolean): RoleSecretOutcome {
  if (!existed) return 'created-with-password';
  return rotate ? 'password-rotated' : 'left-existing-password';
}

/** Human-facing line for a role outcome. Names the CONSEQUENCE, not the branch. */
export function describeRoleSecretOutcome(role: string, outcome: RoleSecretOutcome): string {
  switch (outcome) {
    case 'created-with-password':
      return `↳ role ${role}: CREATED with the supplied password (it did not exist)`;
    case 'password-rotated':
      return `↳ role ${role}: password ROTATED to the supplied value (MIGRATE_ROTATE_ROLE_SECRETS=yes)`;
    case 'left-existing-password':
      // ⛔ The line the three disagreements needed. It states the gap plainly:
      // a secret was supplied and DELIBERATELY not applied.
      return (
        `↳ role ${role}: existing password LEFT UNCHANGED — the supplied secret was NOT applied. ` +
        `Set MIGRATE_ROTATE_ROLE_SECRETS=yes to rotate it, and do not record this run as having set it.`
      );
  }
}

/**
 * ⛔ WHERE EACH ROLE'S CONSUMERS ACTUALLY READ THEIR CREDENTIAL FROM.
 *
 * Named so a refusal or report can tell the operator WHICH store to update,
 * instead of "update your config". The 2026-08-05 incident was exactly this map
 * being carried in someone's head: the 0105 run rotated `c3_auth` and
 * `c3_backup` in Postgres while Railway's `DATABASE_AUTH_URL` and the cron's
 * `DATABASE_URL` kept the old values — production sign-in and the nightly
 * backup both failed password auth while `/health` stayed green.
 */
export const CONSUMER_STORES = {
  app: { localVar: 'DATABASE_URL', platformStore: "Railway service c3-api, variable DATABASE_URL" },
  auth: { localVar: 'DATABASE_AUTH_URL', platformStore: "Railway service c3-api, variable DATABASE_AUTH_URL" },
  backup: { localVar: 'DATABASE_BACKUP_URL', platformStore: "Railway service c3-backup-cron, variable DATABASE_URL" },
} as const;
export type ConsumerStoreRef = (typeof CONSUMER_STORES)[keyof typeof CONSUMER_STORES];

/**
 * ⛔ ROTATION MUST AGREE WITH THE STORE THE CONSUMERS READ — CHECKED BEFORE
 * POSTGRES IS TOUCHED.
 *
 * A rotation that succeeds in Postgres while every consumer still holds the old
 * value is a working instrument bound to the wrong subject: the database is
 * "fixed" and sign-in is down. The agreement check runs FIRST because refusing
 * before the ALTER is the only ordering in which the refusal is cheap — after
 * it, the consumers are already stranded and the message is archaeology.
 *
 * ⚠️ THE LIMIT, STATED RATHER THAN IMPLIED: this verifies the connection string
 * SUPPLIED TO THIS RUN, which is this machine's copy — not what Railway holds.
 * Nothing in this lane can read the platform's variables, and a check that
 * pretended to would be the bug wearing the fix's clothes: green against the
 * wrong subject. What this buys is strictly: the operator cannot rotate to a
 * value their own environment does not carry, and every report names the
 * platform store that must ALSO agree.
 */
export type RotationAgreement =
  | { readonly kind: 'agreed' }
  | { readonly kind: 'no-consumer-string' }
  | { readonly kind: 'unparseable' }
  | { readonly kind: 'role-mismatch'; readonly urlRole: string }
  | { readonly kind: 'password-disagrees' };

export function classifyRotationAgreement(
  consumerUrl: string | undefined,
  role: string,
  newPassword: string,
): RotationAgreement {
  if (!consumerUrl || consumerUrl.trim() === '') return { kind: 'no-consumer-string' };
  let parsed: URL;
  try {
    parsed = new URL(consumerUrl);
  } catch {
    return { kind: 'unparseable' };
  }
  const urlRole = decodeURIComponent(parsed.username);
  if (urlRole !== role) return { kind: 'role-mismatch', urlRole };
  // ⛔ Password compared, never logged. A migration log is not a credential store.
  if (decodeURIComponent(parsed.password) !== newPassword) return { kind: 'password-disagrees' };
  return { kind: 'agreed' };
}

/** The refusal text for a rotation that cannot be verified against its consumer string. */
export function describeRotationRefusal(role: string, store: ConsumerStoreRef, agreement: RotationAgreement): string {
  const remedy =
    `Supply ${store.localVar} carrying role ${role} with the NEW password, update ${store.platformStore} ` +
    `to the same value, then re-run. A rotation the consumers cannot follow is an outage with a green log.`;
  switch (agreement.kind) {
    case 'agreed':
      return `↳ rotation ${role}: consumer string agrees`;
    case 'no-consumer-string':
      return `↳ rotation REFUSED for ${role}: ${store.localVar} is not set, so there is nothing to prove the consumers can follow this rotation. ${remedy}`;
    case 'unparseable':
      return `↳ rotation REFUSED for ${role}: ${store.localVar} is not a parseable connection URL, so its password cannot be compared. ${remedy}`;
    case 'role-mismatch':
      return `↳ rotation REFUSED for ${role}: ${store.localVar} names role ${agreement.urlRole}, not ${role} — it is the wrong consumer string for this rotation. ${remedy}`;
    case 'password-disagrees':
      return `↳ rotation REFUSED for ${role}: ${store.localVar} carries a DIFFERENT password than the one this rotation would apply. Rotating now would strand that consumer the moment the ALTER lands. ${remedy}`;
  }
}

/**
 * ⛔ THE COMPOSITION TEST (LAW 34): actually authenticate as the role.
 *
 * The classifier above proves two strings agree; only a real connection proves
 * the database accepts the credential. Host/port/database come from the admin
 * URL — the consumers connect to the same database, so this is the same subject.
 */
async function verifyRoleAuthenticates(
  adminConnectionString: string,
  role: string,
  password: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  let target: string;
  try {
    const admin = new URL(adminConnectionString);
    target = `${admin.protocol}//${encodeURIComponent(role)}:${encodeURIComponent(password)}@${admin.host}${admin.pathname}`;
  } catch (err) {
    return { ok: false, error: `admin URL unparseable: ${(err as Error).message}` };
  }
  const probe = new Client({ connectionString: target });
  try {
    await probe.connect();
    await probe.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    await probe.end().catch(() => {});
  }
}

/**
 * ⛔ THE LIVE CHECK EVERY RUN GETS, WHATEVER THE OUTCOME.
 *
 * - created/rotated: a secret this run claims to have APPLIED must authenticate,
 *   or the run FAILS — a migrator that reports "rotated" over a credential the
 *   database refuses is instance-52-shaped: confident, wrong, and retiring the
 *   question.
 * - left-existing: the interesting one. The supplied secret was deliberately NOT
 *   applied, so whether it MATCHES the live password is exactly the credential
 *   disagreement this environment has now hit three times. It is MEASURED here,
 *   at migration time, instead of discovered as a sign-in outage. A mismatch is
 *   a REPORT, not an error — leaving the password alone is the documented
 *   behaviour; the news is the disagreement, and the log now carries it.
 */
async function liveSecretCheck(
  adminConnectionString: string,
  role: string,
  password: string,
  outcome: RoleSecretOutcome,
  store: ConsumerStoreRef,
): Promise<string> {
  const probe = await verifyRoleAuthenticates(adminConnectionString, role, password);
  if (outcome === 'left-existing-password') {
    return probe.ok
      ? `↳ live-check ${role}: the supplied secret AGREES with the live password (nothing was changed, and nothing disagrees).`
      : `↳ live-check ${role}: ⛔ the supplied secret does NOT authenticate — the live password DIFFERS from this run's input. ` +
          `Any consumer configured with the supplied value will fail auth. Either this input is stale (fix it) or the live ` +
          `password is (rotate deliberately with MIGRATE_ROTATE_ROLE_SECRETS=yes). Check ${store.platformStore}.`;
  }
  if (!probe.ok) {
    throw new Error(
      `Role ${role}: this run ${outcome === 'password-rotated' ? 'ROTATED' : 'CREATED'} the password, but the new secret ` +
        `FAILS to authenticate (${probe.error}). The report would have claimed an applied credential the database refuses — ` +
        `failing the run instead of writing that fiction.`,
    );
  }
  return outcome === 'password-rotated'
    ? `↳ live-check ${role}: post-rotation connect-back OK — the new secret authenticates. ⚠ This proves the DATABASE and this ` +
        `machine's ${store.localVar}; it does NOT prove ${store.platformStore}, which must carry the same value before its consumer next connects.`
    : `↳ live-check ${role}: connect-back OK — the created role authenticates with its password.`;
}

async function ensureRestrictedRole(
  client: Client,
  role: string,
  password: string,
  rotate: boolean,
): Promise<RoleSecretOutcome> {
  if (!ROLE_RE.test(role)) throw new Error(`Unsafe role name: ${role}`);
  const pw = quoteLiteral(password);

  // ⛔ Read existence BEFORE acting, so the outcome is observed rather than
  // inferred from the input. Inferring it from `rotate` alone is the original
  // defect in a new place.
  const existed =
    ((await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount ?? 0) > 0;

  // Create the role with its password if absent. If it ALREADY exists, only
  // reset the password when an explicit rotation was requested — an ordinary
  // schema migration must not reset (or silently downgrade) a live role secret
  // (H-01.1: backup-role lifecycle decoupled from schema application).
  const elseAlter = rotate ? `ELSE ALTER ROLE ${role} LOGIN PASSWORD ${pw};` : '';
  await client.query(`
    DO $do$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${quoteLiteral(role)}) THEN
        CREATE ROLE ${role} LOGIN PASSWORD ${pw};
      ${elseAlter}
      END IF;
    END
    $do$;
  `);
  // Defense in depth: restricted roles never bypass RLS and are never superuser.
  await client.query(`ALTER ROLE ${role} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);

  return classifyRoleSecretOutcome(existed, rotate);
}

/** SHA-256 of file content with line endings normalized (git may check out LF or CRLF). */
function sha256(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

/** A migration's sibling preflight (content + checksum), or null if it has none. */
function loadPreflight(dir: string, file: string): { sql: string; checksum: string } | null {
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  const sql = readFileSync(path, 'utf8');
  return { sql, checksum: sha256(sql) };
}

/**
 * R2-N04 (Batch D): run a migration's preflight SQL on the given client — which is ALREADY
 * inside the migration's BEGIN/COMMIT. Logs whether it repaired rows or was a no-op, so a DR
 * replay leaves an operator trail (log-on-repair). A preflight is plain multi-statement SQL;
 * node-pg returns one result per statement, so the UPDATE row counts are summed. If the
 * preflight RAISEs (an incoherent shape it refuses to guess at), the throw propagates and the
 * caller rolls the whole migration back.
 */
async function runPreflightSql(client: Client, file: string, sql: string, log: (msg: string) => void): Promise<void> {
  const res = (await client.query(sql)) as unknown as
    | { command?: string; rowCount?: number | null }
    | Array<{ command?: string; rowCount?: number | null }>;
  const repaired = (Array.isArray(res) ? res : [res])
    .filter((r) => r?.command === 'UPDATE')
    .reduce((n, r) => n + (r.rowCount ?? 0), 0);
  log(
    repaired > 0
      ? `  ↳ preflight ${file}: repaired ${repaired} row(s) before applying`
      : `  ↳ preflight ${file}: no-op (data already coherent)`,
  );
}

export async function runMigrations(config: MigrateConfig): Promise<string[]> {
  const log = config.log ?? (() => {});

  // H-01.1: fail closed BEFORE touching the database. Unless dev/test is
  // EXPLICITLY opted in, every role's resolved password must be explicit and
  // non-default — an absent/mistyped/non-dev environment can never reach the
  // published fallbacks below (which now apply ONLY under allowDevSecrets).
  const allowDevSecrets = config.allowDevSecrets === true;
  const rotateRoleSecrets = config.rotateRoleSecrets === true;
  if (!allowDevSecrets) {
    assertStrongSecret('appPassword (DATABASE_URL / APP_DB_PASSWORD)', config.appPassword);
    assertStrongSecret('authPassword (DATABASE_AUTH_URL / AUTH_DB_PASSWORD)', config.authPassword);
    assertStrongSecret('backupPassword (BACKUP_DB_PASSWORD)', config.backupPassword);
  }
  const appPassword = config.appPassword ?? 'c3_app_dev_pw';
  const authPassword = config.authPassword ?? 'c3_auth_dev_pw';
  const backupPassword = config.backupPassword ?? 'c3_backup_dev_pw';

  /*
   * ⛔ ROTATION PRE-FLIGHT — ALL THREE ROLES, BEFORE ANY CONNECTION IS OPENED.
   *
   * Ordering is the fix. Refusing after role one has rotated leaves a HALF-rotated
   * set, which is strictly worse than either endpoint: some consumers stranded,
   * some not, and the operator's mental model matching neither. All agreements are
   * classified first; ANY refusal aborts the whole run — including the schema
   * migrations, because a run that silently executes half of what the operator
   * asked is the original defect of this seam in a new coat.
   *
   * ⇒ Every refusal is reported at once, not just the first — the operator fixes
   * the environment in one pass, not one error message at a time.
   */
  const rotationTargets = [
    { role: config.appRole, password: appPassword, url: config.consumerConnectionStrings?.app, store: CONSUMER_STORES.app },
    { role: config.authRole ?? 'c3_auth', password: authPassword, url: config.consumerConnectionStrings?.auth, store: CONSUMER_STORES.auth },
    { role: config.backupRole ?? 'c3_backup', password: backupPassword, url: config.consumerConnectionStrings?.backup, store: CONSUMER_STORES.backup },
  ];
  if (rotateRoleSecrets) {
    const refusals = rotationTargets
      .map((t) => ({ t, agreement: classifyRotationAgreement(t.url, t.role, t.password) }))
      .filter(({ agreement }) => agreement.kind !== 'agreed');
    if (refusals.length > 0) {
      throw new Error(
        'Rotation refused before touching the database — nothing was changed:\n' +
          refusals.map(({ t, agreement }) => '  ' + describeRotationRefusal(t.role, t.store, agreement)).join('\n'),
      );
    }
  }

  const client = new Client({ connectionString: config.adminConnectionString });
  const applied: string[] = [];
  try {
    // HARDEN-3.7 U8: cleanup authority begins before the first effect. Connection, encoding,
    // and advisory-lock failures all pass through the same unconditional session teardown.
    await client.connect();
    // Force UTF-8: on Windows the server may default client_encoding to WIN1252,
    // which cannot represent the UTF-8 content of migration files.
    await client.query("SET client_encoding TO 'UTF8'");
    // R6-N03: SINGLE-FLIGHT — the entire run holds a session advisory lock keyed to this database,
    // so two concurrent migrators SERIALIZE by construction (the second WAITS — it does not fail).
    // Without this, two runners could snapshot the ledger concurrently and both pass the legacy
    // NULL-adoption check once. Released automatically when the session ends (the finally below).
    await client.query('SELECT pg_advisory_lock($1, hashtext(current_database()))', [MIGRATOR_LOCK_KEY]);
    log('↳ migrator single-flight lock acquired');
    // ⛔ EVERY ROLE REPORTS WHAT HAPPENED TO ITS SECRET. The runner demands a
    // password for each role and applies it only when the role is ABSENT; an
    // existing role changes only under MIGRATE_ROTATE_ROLE_SECRETS=yes. Saying
    // so out loud is the whole fix: three credential disagreements in this
    // environment came from "I supplied a password" being read as "the password
    // is now that", including one recorded as done on the strength of the input.
    // ⛔ Every role: outcome reported, then the secret MEASURED against the live
    // database (liveSecretCheck). created/rotated must authenticate or the run
    // fails; left-existing reports agreement or the exact disagreement that has
    // produced three credential incidents here — at migration time, not as the
    // next sign-in outage.
    for (const t of rotationTargets) {
      const outcome = await ensureRestrictedRole(client, t.role, t.password, rotateRoleSecrets);
      log(describeRoleSecretOutcome(t.role, outcome));
      log(await liveSecretCheck(config.adminConnectionString, t.role, t.password, outcome, t.store));
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // H-08: the checksum column arrives idempotently (the ledger predates it).
    await client.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text');
    // R4-N11: a preflight is part of a migration's replay identity, but was never recorded —
    // editing one changed future rebuilds invisibly. Record its checksum in its own nullable
    // column (legacy rows carry NULL and adopt on first sighting; migration checksums untouched).
    await client.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS preflight_checksum text');
    const ledger = new Map<string, { checksum: string | null; preflight: string | null }>(
      (await client.query('SELECT id, checksum, preflight_checksum FROM _migrations')).rows.map(
        (r: { id: string; checksum: string | null; preflight_checksum: string | null }) =>
          [r.id, { checksum: r.checksum, preflight: r.preflight_checksum }] as const,
      ),
    );
    const preflightsDir = config.preflightsDir ?? PREFLIGHTS_DIR;
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = sha256(sqlText);
      const preflight = loadPreflight(preflightsDir, file); // { sql, checksum } | null

      if (ledger.has(file)) {
        const entry = ledger.get(file)!;
        const stored = entry.checksum;
        if (stored === null || stored === undefined) {
          // Applied before checksums existed (or via the manual staging paste):
          // adopt the current content as the frozen truth. R6-N03: adoption is EXACTLY-ONCE —
          // zero rows means another runner adopted between our snapshot and this write; re-read
          // and REFUSE unless the stored identity equals ours (never proceed on a silent no-op).
          const adopted = await client.query('UPDATE _migrations SET checksum = $2 WHERE id = $1 AND checksum IS NULL', [file, checksum]);
          if (adopted.rowCount === 1) {
            log(`↳ skip ${file} (already applied; checksum adopted)`);
          } else {
            const re = await client.query<{ checksum: string | null }>('SELECT checksum FROM _migrations WHERE id = $1', [file]);
            const now = re.rows[0]?.checksum ?? null;
            if (now !== checksum) {
              throw new Error(
                `Migration ${file}: a concurrent runner adopted checksum '${(now ?? 'NULL').slice(0, 12)}…' which differs from this runner's file ('${checksum.slice(0, 12)}…'). ` +
                  'Adopt-once is single-use — reconcile the two deployments before re-running.',
              );
            }
            log(`↳ skip ${file} (checksum adopted by a concurrent runner; verified equal)`);
          }
        } else if (stored !== checksum) {
          throw new Error(
            `Migration ${file} was EDITED after being applied (ledger ${stored.slice(0, 12)}… ≠ file ${checksum.slice(0, 12)}…). ` +
              'Applied migrations are frozen — ship the correction as a NEW migration file.',
          );
        } else {
          log(`↳ skip ${file} (already applied)`);
        }
        // R4-N11 / R5-N10: verify the preflight's identity (never clobbering the migration
        // checksum). "No preflight" is recorded as the explicit sentinel 'none' (NOT NULL), so a
        // preflight ADDED to a migration that had none is a mismatch — a NULL would have been
        // silently adopted. NULL only appears on legacy rows applied before this column existed.
        const storedPf = entry.preflight;
        const currentPf = preflight?.checksum ?? 'none';
        if (storedPf === null || storedPf === undefined) {
          // Legacy row (pre-sentinel): adopt the current identity ('none' or a checksum) ONCE.
          // R6-N03: exactly-once — a zero-row conditional write means a CONCURRENT runner adopted
          // first; re-read and REFUSE unless its adopted identity equals ours. Never proceed on a
          // silently-ignored no-op (two code versions must not both accept the same NULL state).
          if (config.beforeAdoptHook) await config.beforeAdoptHook(file); // TEST-ONLY latch (R6-N03)
          const adoptedPf = await client.query('UPDATE _migrations SET preflight_checksum = $2 WHERE id = $1 AND preflight_checksum IS NULL', [file, currentPf]);
          if (adoptedPf.rowCount === 1) {
            log(`↳ ${file}: preflight identity adopted (${currentPf === 'none' ? 'none' : currentPf.slice(0, 12) + '…'})`);
          } else {
            const re = await client.query<{ preflight_checksum: string | null }>('SELECT preflight_checksum FROM _migrations WHERE id = $1', [file]);
            const now = re.rows[0]?.preflight_checksum ?? null;
            if (now !== currentPf) {
              throw new Error(
                `Preflight for ${file}: a concurrent runner adopted identity '${(now ?? 'NULL').slice(0, 12)}…' which differs from this runner's ('${currentPf === 'none' ? 'none' : currentPf.slice(0, 12) + '…'}'). ` +
                  'Adopt-once is single-use — reconcile the two deployments before re-running.',
              );
            }
            log(`↳ ${file}: preflight identity adopted by a concurrent runner; verified equal`);
          }
        } else if (storedPf !== currentPf) {
          const change =
            storedPf === 'none' ? 'ADDED (none was recorded)' : currentPf === 'none' ? 'REMOVED (file now absent)' : 'EDITED';
          throw new Error(
            `Preflight for ${file} was ${change} after being applied (ledger '${storedPf === 'none' ? 'none' : storedPf.slice(0, 12) + '…'}' ≠ file '${currentPf === 'none' ? 'none' : currentPf.slice(0, 12) + '…'}'). ` +
              'A preflight (or its absence) is part of the migration\'s replay identity — restore it, or ship the change as a NEW migration file. ' +
              '(A deliberate change is a documented, explicit ledger update.)',
          );
        }
      } else {
        log(`↳ apply ${file}`);
        await client.query('BEGIN');
        try {
          // R2-N04: run this migration's preflight (if any) FIRST, in the SAME tx. It is
          // reached only when the migration is pending — a fresh replay / DR rebuild —
          // so on the live DB (migration already ledgered) it never runs. Atomic with the
          // migration: a later failure rolls the repair back too.
          if (preflight) await runPreflightSql(client, file, preflight.sql, log);
          await client.query(sqlText);
          await client.query('INSERT INTO _migrations (id, checksum, preflight_checksum) VALUES ($1, $2, $3)', [
            file,
            checksum,
            preflight?.checksum ?? 'none', // R5-N10: explicit 'none' sentinel, never NULL, on a fresh apply
          ]);
          await client.query('COMMIT');
          applied.push(file);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
        }
      }

      // TEST-ONLY bounded replay: stop after the requested target (honored on both the
      // apply and the already-applied paths) so a test can seed state mid-history.
      if (config.targetInclusive !== undefined && file === config.targetInclusive) break;
    }

    // Rerun idempotence: ensureRestrictedRole clamps NOBYPASSRLS on every run
    // as defense in depth, but 0006 deliberately grants the backup role its
    // single documented BYPASSRLS exception. On a rerun (0006 already applied,
    // so it never re-grants) the clamp would silently strip it — re-assert it.
    if (ledger.has('0006_backup_role_grants.sql')) {
      const backupRole = config.backupRole ?? 'c3_backup';
      if (!ROLE_RE.test(backupRole)) throw new Error(`Unsafe role name: ${backupRole}`);
      await client.query(`ALTER ROLE ${backupRole} BYPASSRLS`);
    }
    return applied;
  } finally {
    await client.end();
  }
}
