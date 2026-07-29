/**
 * truthContract.spec.ts — Phase A (Comms chapter): the six-state truthfulness
 * contract's behavioral proof, born as the RED for the shipped instance-21
 * violation BOTH Battle-#2 module seats independently found: a failed
 * (non-404) thread fetch rendered the greenfield "No messages yet…" line —
 * failure dressed as emptiness.
 *
 * Instance 48: every assertion here targets the ARTIFACT (the data-truth
 * attribute the kit contract stamps), never prose — prose is what the feature
 * and its absence have in common.
 */
import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, email: string, role: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: role, exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-submit')).toHaveCount(0);
}

const FAKE_MISSION = {
  mission: {
    missionId: 'MSN-0042',
    name: 'Truth Contract Probe',
    startsOn: '2026-08-01',
    endsOn: null,
    tournamentCode: null,
    organizer: null,
    city: null,
    teamId: null,
    gameTitle: null,
    financeStage: 'Planning',
    isActive: true,
    version: 0,
  },
};

test('a failed thread fetch renders the FETCH-FAILED artifact — never the greenfield empty state', async ({ page }) => {
  await login(page, 'ops@alpha.com', 'operations');

  // The mission itself resolves (fulfilled deterministically); ONLY the comms
  // reads fail — the exact seam where the shipped page dressed failure as
  // emptiness.
  await page.route('**/api/v1/missions/MSN-0042', (r) => r.fulfill({ json: FAKE_MISSION }));
  await page.route('**/api/v1/comms/missions/MSN-0042/**', (r) => r.abort());

  await page.goto('/missions/MSN-0042/comms');

  // THE CONTRACT: the failure artifact renders…
  await expect(page.locator('[data-truth="fetch-failed"]').first()).toBeVisible();
  // …and the proven-empty artifact does NOT (empty requires a successful witness).
  await expect(page.locator('[data-truth="proven-empty"]')).toHaveCount(0);
  // The obligations rail fails the same honest way (it also aborted).
  await expect(page.locator('[data-truth="fetch-failed"]')).toHaveCount(2);
});

test('a truly empty thread renders the PROVEN-EMPTY artifact — emptiness earned by a successful witness', async ({ page }) => {
  await login(page, 'ops@alpha.com', 'operations');
  await page.route('**/api/v1/missions/MSN-0042', (r) => r.fulfill({ json: FAKE_MISSION }));
  await page.route('**/api/v1/comms/missions/MSN-0042/thread**', (r) =>
    r.fulfill({ json: { thread: null, messages: [], myLastReadSeq: null } }),
  );
  await page.route('**/api/v1/comms/missions/MSN-0042/obligations', (r) => r.fulfill({ json: { obligations: [] } }));
  await page.route('**/api/v1/comms/missions/MSN-0042/receipts', (r) => r.fulfill({ json: { receipts: [] } }));

  await page.goto('/missions/MSN-0042/comms');

  await expect(page.locator('[data-truth="proven-empty"]').first()).toBeVisible();
  await expect(page.locator('[data-truth="fetch-failed"]')).toHaveCount(0);
});

test('the Truth Lab renders all six artifacts of the ONE renderer, distinct', async ({ page }) => {
  await login(page, 'ops@alpha.com', 'operations');
  await page.goto('/truth-lab');
  for (const kind of ['loading', 'verified', 'proven-empty', 'denied', 'fetch-failed', 'stale']) {
    await expect(page.locator(`[data-truth="${kind}"]`)).toHaveCount(1);
  }
});
