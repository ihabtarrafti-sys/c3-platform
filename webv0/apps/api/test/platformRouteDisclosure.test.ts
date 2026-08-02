/**
 * platformRouteDisclosure.test.ts — platform capabilities grant NO customer-data
 * visibility. `D-015`'s no-cross-tenant-People/PII clause, and the enforcement of
 * `D-016`'s break-glass exclusion.
 *
 * ⚖️ WHY THIS EXISTS AS A TEST AND NOT A SENTENCE. *"Platform capabilities grant
 * no customer-data visibility"* is policy. **Nothing fails when someone later
 * adds a small data read to a platform route "just for support"** — and that is
 * exactly how a scoped capability becomes an unscoped one: over months, in
 * several commits, with no single guilty one. **An unguarded constraint is a
 * preference, and a preference held across a change of hands is a memory.**
 *
 * ⛔ IT GUARDS THE ROUTES, NOT THE CAPABILITY MECHANISM. The mechanism does not
 * exist yet (`D-015` is mid-build); the routes do, and the routes are what a
 * support-minded change would widen. So this survives the reattribution to
 * platform principals unchanged — it never mentions who is calling, only what
 * comes back.
 *
 * ⚖️ TWO INDEPENDENT HALVES, BECAUSE NEITHER ALONE IS THE CLASS:
 *   · **sentinels catch values that ESCAPE** — a real datum surfacing under any
 *     field name at any depth;
 *   · **the closed key-path set catches doors that OPEN** — a new field whose
 *     value happens to look harmless, which is precisely the leak nobody notices.
 * The key set is RECURSIVE: a top-level check would wave through
 * `{"debug":{"email":"…"}}`, and a nested addition is the same defect one level
 * down.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;
let ownerToken: string;

/**
 * Real customer data, present in the database, distinctive enough that any
 * appearance in a platform response is unambiguous. These are not invented
 * strings: the emails and slug below are what the seeded tenant actually holds,
 * so a route that grew an identity read would surface exactly these.
 */
const TENANT_SLUG = 'sentinel-org-zzq';
const OWNER_EMAIL = 'sentinel-owner-zzq@example.test';
const OPS_EMAIL = 'sentinel-ops-zzq@example.test';
let ownerUserId = '';

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'platform-disclosure-secret-0123456789',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  app = buildApp(deps);
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await deps?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  await db.seedTenant({ slug: TENANT_SLUG });
  const login = async (email: string, role: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dev/login',
      payload: { email, displayName: email, role, tenantSlug: TENANT_SLUG },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { token: string; userId: string };
  };
  const owner = await login(OWNER_EMAIL, 'owner');
  await login(OPS_EMAIL, 'operations');
  ownerToken = owner.token;
  ownerUserId = owner.userId;
});

const auth = () => ({ authorization: `Bearer ${ownerToken}` });

const backupStatus = () =>
  app.inject({ method: 'GET', url: '/api/v1/settings/backup-status', headers: auth() });
const erasureRun = () =>
  app.inject({ method: 'POST', url: '/api/v1/settings/erasure-janitor/run', headers: auth() });

/**
 * Every key path in a payload, at EVERY depth, with array indices collapsed so
 * the set does not depend on how many elements came back.
 * `{a:{b:1}, c:[{d:2}]}` → `['a', 'a.b', 'c', 'c[].d']`.
 */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => keyPaths(item, `${prefix}[]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...keyPaths(child, path)];
    });
  }
  return [];
}

const pathsOf = (body: unknown) => [...new Set(keyPaths(body))].sort();

describe('⛔ no customer datum escapes a platform route', () => {
  it('backup-status contains no seeded identity, at any depth', async () => {
    const raw = (await backupStatus()).body;
    for (const sentinel of [OWNER_EMAIL, OPS_EMAIL, TENANT_SLUG, ownerUserId]) {
      expect(raw, `platform response disclosed ${sentinel}`).not.toContain(sentinel);
    }
  });

  it('the erasure sweep contains no seeded identity, at any depth', async () => {
    const raw = (await erasureRun()).body;
    for (const sentinel of [OWNER_EMAIL, OPS_EMAIL, TENANT_SLUG, ownerUserId]) {
      expect(raw, `platform response disclosed ${sentinel}`).not.toContain(sentinel);
    }
  });

  it('the erasure sweep carries no identifier-SHAPED value either', async () => {
    // Sentinels cover data this test seeded. Shape covers data it did not:
    // the route's whole contract is aggregates only, identifiers never — and a
    // tenant_ref or prefix leaking would be a uuid nobody in this test planted.
    const raw = (await erasureRun()).body;
    expect(raw, 'a uuid in an aggregates-only response is an identifier').not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    expect(raw, 'an email-shaped value is customer identity').not.toMatch(/[^\s"]+@[^\s"]+\.[a-z]{2,}/i);
  });
});

describe('⛔ no new door opens quietly — the closed key-path set', () => {
  // ⚖️ THE SAME MECHANISM AS THE /version NO-SHA GUARD: it catches the CLASS
  // rather than a field name, so `debug`, `sample`, `supportContext` and
  // anything else fail the SAME assertion without this file being edited.
  it('backup-status returns exactly these paths and no others', async () => {
    expect(pathsOf((await backupStatus()).json())).toEqual(
      ['ageHours', 'configured', 'healthy', 'lastSuccessUtc', 'reason'].sort(),
    );
  });

  it('the erasure sweep returns exactly these paths and no others', async () => {
    expect(pathsOf((await erasureRun()).json())).toEqual(
      ['failures', 'incomplete', 'recordsSeen', 'recordsSkipped', 'recordsSwept', 'stragglersDestroyed'].sort(),
    );
  });
});

describe('⚖️ the platform AGGREGATES are exempt BY NAME, with the reason', () => {
  /**
   * ⛔ NAMED EXEMPTION, NOT A WIDENED MATCHER — and the distinction is the whole
   * point. `recordsSeen`, `recordsSwept`, `recordsSkipped`, `stragglersDestroyed`
   * and `failures` genuinely COUNT ACROSS TENANTS: `erased_tenant_prefix` is
   * platform-level by design (`erasureJanitor.ts:4-5`) and the sweep applies no
   * tenant filter (`:124-125`). That is permitted by `D-015` and was excluded
   * from the second-tenant readiness set deliberately, because the route returns
   * counts over already-dead tenants and never their identifiers.
   *
   * ⚠️ THIS TEST EXISTS SO NOBODY "FIXES" THE GUARD. Without it, a future reader
   * sees a cross-tenant number inside a no-cross-tenant-data guard, concludes the
   * guard is wrong, and loosens the matcher. **A named exemption is a decision; a
   * widened matcher is a leak with a commit message** — and the loosening is
   * permanent and unattributed, while this paragraph has to be argued with.
   */
  const PERMITTED_CROSS_TENANT_AGGREGATES = [
    'recordsSeen',
    'recordsSwept',
    'recordsSkipped',
    'stragglersDestroyed',
    'failures',
  ] as const;

  it('are PRESENT and numeric — removing them is a regression, not a fix', async () => {
    const body = (await erasureRun()).json() as Record<string, unknown>;
    for (const field of PERMITTED_CROSS_TENANT_AGGREGATES) {
      expect(typeof body[field], `${field} is a permitted platform aggregate`).toBe('number');
    }
  });

  it('and the exemption is exactly these five — it does not extend to anything else', async () => {
    // The exemption covers COUNTS. If a sixth cross-tenant field ever appears it
    // fails the closed key-path assertion above and has to be argued for here.
    const body = (await erasureRun()).json() as Record<string, unknown>;
    const numeric = Object.entries(body)
      .filter(([, v]) => typeof v === 'number')
      .map(([k]) => k)
      .sort();
    expect(numeric).toEqual([...PERMITTED_CROSS_TENANT_AGGREGATES].sort());
  });
});

describe('the guard itself can fail — proven, not assumed', () => {
  it('⛔ catches a NESTED addition, which a top-level key check would wave through', () => {
    // Neural's refinement, pinned. This is the exact payload the approved design
    // would have missed before the key set was made recursive.
    const leaked = { configured: true, healthy: true, debug: { email: 'someone@customer.test' } };
    expect(pathsOf(leaked)).toContain('debug.email');
    expect(pathsOf(leaked)).not.toEqual(['configured', 'healthy']);
  });

  it('collapses array indices so the set does not depend on element count', () => {
    expect(pathsOf({ items: [{ id: 1 }, { id: 2 }] })).toEqual(['items', 'items[].id']);
  });

  it('reports nothing for a scalar — so an empty set can never mean "checked"', () => {
    // A key-path helper that silently returned [] for an object would make every
    // assertion above vacuously true. Scalars legitimately have no paths; objects
    // must not be mistaken for scalars.
    expect(keyPaths(42)).toEqual([]);
    expect(keyPaths({ a: 1 }).length).toBeGreaterThan(0);
  });
});
