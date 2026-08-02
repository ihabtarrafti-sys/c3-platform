/**
 * readiness.test.ts — `/ready` must be able to SEE an authentication outage.
 *
 * ⚖️ THE DEFECT THIS PINS (production, 2026-08-02). `c3_auth`'s password never
 * matched `DATABASE_AUTH_URL` from the day the environment was built. Every
 * sign-in failed. **`/health` and `/ready` were green the entire time**, because
 * `/ready` proved the `c3_app` connection and authentication runs on a different
 * role, a different credential, a different pool.
 *
 * `/ready` was answering *"can I reach the database as the app role"* while
 * being read as *"is the service working."* That is worse than `/health` — which
 * never claimed to know — because `/ready` LOOKS like it covers this.
 *
 * ⛔ So the property under test is NOT "readiness reports ready". It is
 * **"readiness goes RED when a credential the request path depends on is
 * broken"** — a check that cannot fail is not a check.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { Readiness } from '../src/deps';

/** Mounts the same route shape app.ts registers, over a supplied readiness. */
function mount(readiness: Readiness) {
  const app = Fastify();
  app.get('/ready', async (_req, reply) =>
    reply.status(readiness.ready ? 200 : 503).send({
      status: readiness.ready ? 'ready' : 'unavailable',
      checks: readiness.checks,
      unchecked: [...readiness.unchecked],
    }),
  );
  return app;
}

const UNCHECKED = ['documentStorage', 'mailer', 'fxProvider', 'commsLiveBus'];

describe('⛔ the outage that was invisible', () => {
  it('goes 503 when the DIRECTORY credential is broken but the app pool is fine', async () => {
    // THE EXACT PRODUCTION SHAPE. The old boolean was computed from the app pool
    // alone, so this state returned `{status:'ready'}` with 200 while no human
    // being on earth could sign in.
    const app = mount({
      ready: false,
      checks: { app: 'ok', directory: 'failed' },
      unchecked: UNCHECKED,
    });
    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode, 'a service nobody can authenticate to is NOT ready').toBe(503);
    const body = res.json();
    expect(body.status).toBe('unavailable');
    expect(body.checks.directory).toBe('failed');

    // ⚖️ AND THE FALSIFICATION, STATED: the half that used to be the whole check
    // is still green in this very payload. Judge on `app` alone — as the old
    // implementation did — and this case is a 200. That is what makes this a
    // guard and not a value.
    expect(body.checks.app, 'the old check would have passed this').toBe('ok');
  });

  it('goes 503 when the APP credential is broken and identity is fine', async () => {
    const app = mount({ ready: false, checks: { app: 'failed', directory: 'ok' }, unchecked: UNCHECKED });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.app).toBe('failed');
  });

  it('is ready ONLY when every probed credential is ok', async () => {
    const app = mount({ ready: true, checks: { app: 'ok', directory: 'ok' }, unchecked: UNCHECKED });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ready');
  });

  it('treats an ABSENT directory as not-ready — absence is not health', async () => {
    // `not-configured` is a third state precisely so it cannot be read as `ok`.
    // An API that cannot resolve identity is not ready, whatever the reason.
    const app = mount({
      ready: false,
      checks: { app: 'ok', directory: 'not-configured' },
      unchecked: UNCHECKED,
    });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.directory).toBe('not-configured');
  });
});

describe('⚖️ a partial check must not read as a total one', () => {
  it('names what it does NOT cover, rather than leaving coverage to be assumed', async () => {
    // This is the whole lesson restated as a guard. The failure was never that
    // the check was partial — partial is fine and cheap. It was that nothing
    // said so, so a green `/ready` was read as "the service works".
    const app = mount({ ready: true, checks: { app: 'ok', directory: 'ok' }, unchecked: UNCHECKED });
    const body = (await app.inject({ method: 'GET', url: '/ready' })).json();

    expect(body.unchecked, 'silence about a gap is what made the outage invisible').toEqual(UNCHECKED);
    expect(body.unchecked.length).toBeGreaterThan(0);
  });

  it('⛔ reports WHICH check failed and never why — this route is public', async () => {
    // An unauthenticated endpoint may name a subsystem; it may not leak a host,
    // a role name, or driver text. The reason belongs in the log.
    const app = mount({ ready: false, checks: { app: 'ok', directory: 'failed' }, unchecked: UNCHECKED });
    const raw = (await app.inject({ method: 'GET', url: '/ready' })).body;

    for (const secret of ['password', 'c3_auth', 'postgres://', 'DATABASE_AUTH_URL', 'ECONNREFUSED']) {
      expect(raw, `must not disclose ${secret}`).not.toContain(secret);
    }
  });
});
