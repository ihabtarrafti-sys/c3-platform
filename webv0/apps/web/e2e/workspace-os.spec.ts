import { expect, test, type Page, type Route } from '@playwright/test';

async function login(page: Page): Promise<void> {
  await page.goto('/people');
  const logout = page.getByTestId('logout');
  try {
    await logout.waitFor({ state: 'visible', timeout: 4000 });
    await logout.click();
  } catch {
    /* already signed out */
  }
  await page.getByTestId('login-email').fill('workspace-os@alpha.com');
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: 'operations', exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('role-display')).toContainText('operations');
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

const mission = {
  missionId: 'MSN-9002',
  name: 'Workspace proof',
  code: null,
  organizer: null,
  city: null,
  teamId: null,
  gameTitle: null,
  startsOn: '2026-08-05',
  endsOn: null,
  notes: null,
  financeStage: 'Planning',
  isActive: true,
  version: 0,
  createdAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-05T10:00:00.000Z',
};

test('Workspace OS: snap, restore, save, apply, and reload remain geometry-only device state', async ({ page }) => {
  await login(page);
  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => fulfillJson(route, { mission }));
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );

  await page.goto(`/missions/${mission.missionId}/comms`);
  const current = page.locator('[data-module="mission-current"]');
  await expect(current).toBeVisible();

  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Left half: Mission Current' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'left-half');
  await expect(current).toHaveAttribute('style', /--mc-x: 0%;.*--mc-w: 50%/);

  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Restore freeform' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'freeform');

  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Left half: Mission Current' }).click();

  await page.getByRole('button', { name: /^Views/ }).click();
  const library = page.getByRole('dialog', { name: 'Saved workspace views' });
  await expect(library).toBeVisible();
  await library.getByLabel('Name this view').fill('My command');
  await library.getByRole('button', { name: 'Save current' }).click();
  await expect(library.getByText('My command')).toBeVisible();
  await library.getByRole('button', { name: 'Close saved views' }).click();

  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Full canvas: Mission Current' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'full');

  await page.getByRole('button', { name: /^Views/ }).click();
  await library.getByRole('button', { name: 'Apply' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'left-half');

  const storageKey = `c3:mission-command:${mission.missionId}:workspace:v2`;
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey))
    .not.toBeNull();
  const stored = await page.evaluate((key) => localStorage.getItem(key) ?? '', storageKey);
  expect(stored).toContain('"version":2');
  expect(stored).toContain('"name":"My command"');
  expect(stored).not.toContain('workspace-os@alpha.com');
  expect(stored).not.toContain('Workspace proof');

  await page.reload();
  await expect(current).toBeVisible();
  await expect(current).toHaveAttribute('data-window-snap', 'left-half');
  await page.getByRole('button', { name: /^Views/ }).click();
  await expect(page.getByRole('dialog', { name: 'Saved workspace views' }).getByText('My command')).toBeVisible();
});

test('Workspace OS: ordinary routes park one principal workspace and a principal change destroys its live tree', async ({ page }) => {
  await login(page);
  let missionReads = 0;
  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => {
    missionReads += 1;
    return fulfillJson(route, { mission });
  });
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );

  await page.goto(`/missions/${mission.missionId}/comms`);
  const current = page.locator('[data-module="mission-current"]');
  const draft = page.getByPlaceholder(`Write in the ${mission.name} Mission Thread`);
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(1);
  await expect(current).toBeVisible();
  await draft.fill('Unsent handover survives parking');
  await page.getByRole('button', { name: 'Arrange Mission Current' }).click();
  await page.getByRole('button', { name: 'Right half: Mission Current' }).click();
  await expect(current).toHaveAttribute('data-window-snap', 'right-half');

  const readsBeforeParking = missionReads;
  await page.getByTestId('nav-people').click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(0);
  await expect(page.locator('.tw-root')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(missionReads).toBe(readsBeforeParking);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/missions/${mission.missionId}/comms$`));
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(1);
  await expect(draft).toHaveValue('Unsent handover survives parking');
  await expect(current).toHaveAttribute('data-window-snap', 'right-half');
  await expect.poll(() => missionReads).toBeGreaterThan(readsBeforeParking);

  await page.getByTestId('logout').click();
  await page.getByTestId('login-email').fill('fresh-principal@alpha.com');
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: 'operations', exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('role-display')).toContainText('operations');
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(1);
  await expect(page.getByPlaceholder(`Write in the ${mission.name} Mission Thread`)).toHaveValue('');
  await expect(page.locator('[data-module="mission-current"]')).toHaveAttribute('data-window-snap', 'right-half');
});

test('Workspace OS: Approvals and Calendar open as truthful singleton windows instead of pages', async ({ page }) => {
  await login(page);
  let approvalsReads = 0;
  let calendarReads = 0;
  await page.route(`**/api/v1/missions/${mission.missionId}`, (route) => fulfillJson(route, { mission }));
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/thread**`, (route) =>
    fulfillJson(route, { thread: null, messages: [], myLastReadSeq: null }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/obligations`, (route) =>
    fulfillJson(route, { obligations: [] }),
  );
  await page.route(`**/api/v1/comms/missions/${mission.missionId}/receipts`, (route) =>
    fulfillJson(route, { receipts: [] }),
  );
  await page.route('**/api/v1/comms/prefs', (route) =>
    fulfillJson(route, { receiptsEnabled: true, presenceEnabled: false, version: null }),
  );
  await page.route('**/api/v1/approvals', (route) => {
    approvalsReads += 1;
    return fulfillJson(route, { approvals: [] });
  });
  await page.route('**/api/v1/calendar**', (route) => {
    calendarReads += 1;
    return fulfillJson(route, { items: [], horizonDays: 90, todayIso: '2026-08-05' });
  });

  await page.goto(`/missions/${mission.missionId}/comms`);
  const draft = page.getByPlaceholder(`Write in the ${mission.name} Mission Thread`);
  await draft.fill('Keep the relay open beside the registers');

  await page.getByTestId('nav-approvals').click();
  await expect(page).toHaveURL(new RegExp(`/approvals\\?workspace=${mission.missionId}$`));
  const approvals = page.locator('[data-module="approvals-register"]');
  await expect(approvals).toBeVisible();
  await expect(approvals).toHaveAttribute('data-module-truth', 'proven-empty');
  await expect(page.locator('[data-module="mission-current"]')).toBeVisible();
  await expect(draft).toHaveValue('Keep the relay open beside the registers');
  expect(approvalsReads).toBeGreaterThan(0);

  await page.getByTestId('nav-calendar').click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?workspace=${mission.missionId}$`));
  const calendar = page.locator('[data-module="calendar-horizon"]');
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAttribute('data-module-truth', 'proven-empty');
  await expect(approvals).toBeVisible();
  await expect(draft).toHaveValue('Keep the relay open beside the registers');
  expect(calendarReads).toBeGreaterThan(0);

  const readsBeforeClose = calendarReads;
  await page.getByRole('button', { name: 'Close Calendar Horizon' }).click();
  await expect(page).toHaveURL(new RegExp(`/missions/${mission.missionId}/comms$`));
  await expect(calendar).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(calendarReads).toBe(readsBeforeClose);

  await page.getByTestId('nav-calendar').click();
  await expect(calendar).toBeVisible();
  await expect.poll(() => calendarReads).toBeGreaterThan(readsBeforeClose);
  await expect(page.locator('[data-module="calendar-horizon"]')).toHaveCount(1);

  await page.goto('/approvals');
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.locator('[data-workspace-owner="principal"]')).toHaveCount(0);
  await expect(page.locator('[data-module="approvals-register"]')).toHaveCount(0);
  await expect(page.getByTestId('approvals-empty')).toBeVisible();
});
