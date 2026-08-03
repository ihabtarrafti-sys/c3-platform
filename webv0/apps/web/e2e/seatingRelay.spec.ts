import { expect, test, type Page, type Route } from '@playwright/test';

const INTENDED_PATH = '/members?view=active';

const seatedMe = {
  identity: 'first.seated@alpha.com',
  displayName: 'First Seated Member',
  role: 'owner',
  tenantSlug: 'alpha',
  userId: '10000000-0000-4000-8000-000000000005',
  capabilities: {
    canReadPeople: true,
    canSubmitApproval: true,
    canReviewApproval: true,
    canExecuteApproval: true,
    canReadMembers: true,
    canSubmitMemberChange: true,
    canOperateJourneys: true,
    canManageKit: true,
    canManageApparel: true,
    canManageMissions: true,
    canManageEntities: true,
    canManageIntake: true,
    canManageSubscriptions: true,
    canReadAgreements: true,
    canViewFinancials: true,
    canViewPerDiem: true,
    canSubmitClaim: true,
    canReadClaims: true,
    canDecideClaim: true,
    canManageDelegations: true,
    canViewSituation: true,
    canViewPersonPII: true,
  },
};

const meSequence = [
  {
    status: 403,
    body: {
      error: { code: 'ACCESS_NOT_PROVISIONED', message: 'This identity does not have a C3 membership.' },
      correlationId: 'seat-not-provisioned',
    },
  },
  {
    status: 500,
    body: {
      error: { code: 'INTERNAL_ERROR', message: 'Membership verification is temporarily unavailable.' },
      correlationId: 'seat-verification-failed',
    },
  },
  {
    status: 403,
    body: {
      error: { code: 'MEMBERSHIP_AMBIGUOUS', message: 'This identity resolves to more than one tenant membership.' },
      correlationId: 'seat-ambiguous',
    },
  },
  { status: 200, body: seatedMe },
] as const;

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function expectRelayOwnsTheRoute(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/members\?view=active$/);
  await expect(page.locator('section[data-tablework="AppFrame"]')).toHaveCount(0);
  await expect(page.getByTestId('role-display')).toHaveCount(0);
}

test('Seating Relay: every refusal stays explicit and a confirmed seat waits for entry', async ({ page }) => {
  let meReads = 0;

  await page.route('**/api/v1/me', async (route) => {
    expect(route.request().method()).toBe('GET');
    const response = meSequence[meReads];
    if (!response) throw new Error(`Unexpected /api/v1/me read #${meReads + 1}`);
    meReads += 1;
    await fulfillJson(route, response.status, response.body);
  });

  // Keep the post-entry register deterministic; this journey owns only the
  // session boundary, not the mutable shared member database.
  await page.route('**/api/v1/members', (route) => fulfillJson(route, 200, { members: [] }));

  await page.goto(INTENDED_PATH);
  await page.getByTestId('login-email').fill('first.seated@alpha.com');
  await page.getByTestId('login-role').click();
  // Dev login persists its requested role before /me is intercepted. Keep the
  // transport identity non-owner so this frontend state-machine test cannot
  // erase the shared suite's intentional sole-owner governance wedge.
  await page.getByRole('option', { name: 'operations', exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();

  await expect(page.getByRole('region', { name: 'Membership status' })).toBeVisible();
  await expect(page.getByTestId('seat-state-not-seated')).toBeVisible();
  await expect(page.getByTestId('seat-check')).toBeVisible();
  await expect(page.getByTestId('seat-enter')).toHaveCount(0);
  await expectRelayOwnsTheRoute(page);
  expect(meReads).toBe(1);

  await page.getByTestId('seat-check').click();
  await expect(page.getByTestId('seat-state-verification-failed')).toBeVisible();
  await expect(page.getByTestId('seat-check')).toBeVisible();
  await expect(page.getByTestId('seat-enter')).toHaveCount(0);
  await expectRelayOwnsTheRoute(page);
  expect(meReads).toBe(2);

  await page.getByTestId('seat-check').click();
  await expect(page.getByTestId('seat-state-ambiguous')).toBeVisible();
  await expect(page.getByTestId('seat-check')).toBeVisible();
  await expect(page.getByTestId('seat-enter')).toHaveCount(0);
  await expectRelayOwnsTheRoute(page);
  expect(meReads).toBe(3);

  await page.getByTestId('seat-check').click();
  await expect(page.getByTestId('seat-state-confirmed')).toBeVisible();
  await expect(page.getByTestId('seat-check')).toHaveCount(0);
  await expect(page.getByTestId('seat-enter')).toBeVisible();
  await expectRelayOwnsTheRoute(page);
  expect(meReads).toBe(4);

  await page.getByTestId('seat-enter').click();
  await expect(page).toHaveURL(/\/members\?view=active$/);
  await expect(page.locator('section[data-tablework="AppFrame"]')).toBeVisible();
  await expect(page.getByTestId('role-display')).toHaveText('owner');
  expect(meReads).toBe(4);
});

test('Seating Relay: a stale successful check cannot restore a signed-out identity', async ({ page }) => {
  let meReads = 0;
  let releaseStaleCheck!: () => void;
  let markStaleResponseSent!: () => void;
  const staleCheckMayFinish = new Promise<void>((resolve) => {
    releaseStaleCheck = resolve;
  });
  const staleResponseSent = new Promise<void>((resolve) => {
    markStaleResponseSent = resolve;
  });

  await page.route('**/api/v1/me', async (route) => {
    meReads += 1;
    if (meReads === 1) {
      await fulfillJson(route, 403, {
        error: { code: 'ACCESS_NOT_PROVISIONED', message: 'This identity does not have a C3 membership.' },
        correlationId: 'seat-not-provisioned',
      });
      return;
    }
    if (meReads !== 2) throw new Error(`Unexpected /api/v1/me read #${meReads}`);
    await staleCheckMayFinish;
    await fulfillJson(route, 200, seatedMe);
    markStaleResponseSent();
  });

  await page.goto(INTENDED_PATH);
  await page.getByTestId('login-email').fill('first.seated@alpha.com');
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: 'operations', exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();

  await expect(page.getByTestId('seat-state-not-seated')).toBeVisible();
  await page.getByTestId('seat-check').click();
  await expect(page.getByTestId('seat-state-checking')).toBeVisible();
  await page.getByTestId('seat-state-checking').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByTestId('login-submit')).toBeVisible();

  releaseStaleCheck();
  await staleResponseSent;
  // route.fulfill can resolve before the page's fetch continuation and React
  // state queue have consumed the late response. Two browser frames make the
  // absence checks prove the stale result had a fair chance to write.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

  await expect(page.getByTestId('login-submit')).toBeVisible();
  await expect(page.getByTestId('seat-state-confirmed')).toHaveCount(0);
  await expect(page.getByTestId('seat-enter')).toHaveCount(0);
  await expect(page.getByTestId('role-display')).toHaveCount(0);
  expect(meReads).toBe(2);
});

test('Seating Relay: a sole owner sees that no second actor can complete the request', async ({ page }) => {
  await page.route('**/api/v1/me', (route) => fulfillJson(route, 200, seatedMe));
  await page.route('**/api/v1/members', (route) =>
    fulfillJson(route, 200, {
      members: [
        {
          userId: seatedMe.userId,
          email: seatedMe.identity,
          displayName: seatedMe.displayName,
          role: 'owner',
          isActive: true,
          createdAt: '2026-08-04T00:00:00.000Z',
        },
      ],
    }),
  );

  await page.goto('/members');
  await page.getByTestId('login-email').fill(seatedMe.identity);
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: 'operations', exact: true }).click();
  await page.getByTestId('login-tenant').fill(seatedMe.tenantSlug);
  await page.getByTestId('login-submit').click();

  await expect(page.getByTestId('members-table')).toBeVisible();
  await page.getByTestId('provision-member-toggle').click();
  const boundary = page.getByTestId('seating-no-reviewer');
  await expect(boundary).toContainText('No other active member can complete this request');
  await expect(boundary).toContainText('cannot be reviewed or executed from the current Members register');
});
