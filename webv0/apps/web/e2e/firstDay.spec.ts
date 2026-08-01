import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Slice 03 composes two already-certified real paths (Situation + Mission
 * creation) without consuming a mission sequence in the shared E2E database.
 * The empty world and the just-created mission's read model are fixed here;
 * auth, routing, the drawer, confirmation, cache/refetch behavior, and the
 * create request all run in the browser.
 */

async function login(page: Page, email: string, role: string): Promise<void> {
  await page.goto('/people');
  const logout = page.getByTestId('logout');
  try {
    await logout.waitFor({ state: 'visible', timeout: 4000 });
    await logout.click();
  } catch {
    /* already signed out */
  }
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: role, exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('role-display')).toContainText(role);
}

const createdMission = {
  missionId: 'MSN-9001',
  name: 'First live mission',
  code: null,
  organizer: null,
  city: null,
  teamId: null,
  gameTitle: null,
  startsOn: '2026-08-04',
  endsOn: null,
  notes: null,
  financeStage: 'Planning',
  isActive: true,
  version: 0,
  createdAt: '2026-08-01T22:00:00.000Z',
  updatedAt: '2026-08-01T22:00:00.000Z',
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('First Day: empty is not all-clear; the one-shot launch enters the returned Mission Command URL', async ({ page }) => {
  let creates = 0;
  await login(page, 'first-day@alpha.com', 'operations');

  await page.route('**/api/v1/situation', (route) =>
    fulfillJson(route, {
      todayIso: '2026-08-01',
      signals: [],
      checks: ['Mission readiness', 'Governance wedge'],
      counts: { activeMissions: 0, rosteredPlayers: 0, credentialsTracked: 0, liveAgreements: 0, openApprovals: 0 },
    }),
  );
  await page.route('**/api/v1/missions', async (route) => {
    if (route.request().method() === 'POST') {
      creates += 1;
      await fulfillJson(route, { mission: createdMission }, 201);
      return;
    }
    await fulfillJson(route, { missions: [] });
  });
  await page.route(`**/api/v1/missions/${createdMission.missionId}`, (route) =>
    fulfillJson(route, { mission: createdMission }),
  );
  await page.route(`**/api/v1/comms/missions/${createdMission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${createdMission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${createdMission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );

  await page.goto('/situation');
  const launch = page.getByTestId('first-day-launch');
  await expect(launch).toBeVisible();
  await expect(page.getByTestId('situation-all-clear')).toHaveCount(0);
  await expect(launch).toContainText('Nothing is marked clear');
  await expect(page.getByTestId('situation-checks')).toContainText('no mission record');

  await page.getByTestId('first-day-start-mission').click();
  await expect(page).toHaveURL(/\/missions\?start=first-mission$/);
  await expect(page.locator('dialog.form-sheet[open]')).toBeVisible();

  // Closing consumes the request. A refetch or StrictMode replay cannot reopen it.
  await page.getByTestId('form-drawer-close').click();
  await expect(page).toHaveURL(/\/missions$/);
  await expect(page.locator('dialog.form-sheet[open]')).toHaveCount(0);

  // A new launch gets one new drawer and uses the ID returned by creation.
  await page.goto('/situation');
  await page.getByTestId('first-day-start-mission').click();
  await page.getByTestId('add-mission-name').fill(createdMission.name);
  await page.getByTestId('add-mission-starts').fill(createdMission.startsOn);
  await page.getByTestId('add-mission-submit').click();
  await page.getByTestId('add-mission-submit-confirm').click();

  await expect(page).toHaveURL(`/missions/${createdMission.missionId}/comms`);
  await expect(page.getByTestId('mission-command')).toBeVisible();
  await expect(page.locator('[data-module="mission-current"]')).toHaveAttribute('data-module-truth', 'proven-empty');
  await expect(page.getByText('This mission is not available')).toHaveCount(0);
  expect(creates).toBe(1);
});
