import { test, expect, type Page } from '@playwright/test';

/**
 * S11 People v2, end to end: the PII tier over real roles (owner sees the
 * block; finance provably does NOT — structural omission), the governed
 * identity change through the full pipeline, the direct-audited operational
 * edit, and governed deactivation exercised on a FRESH person created inside
 * this spec (so no earlier fixture goes inactive).
 *
 * Suite position: after notifications, before personHub. Footprint: one new
 * person (left INACTIVE) + its approvals — pure history for later specs.
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

async function decideAndExecute(page: Page, approvalId: string): Promise<void> {
  await page.goto(`/approvals/${approvalId}`);
  await page.getByTestId('begin-review').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('In review');
  await page.getByTestId('approve').click();
  await page.getByTestId('approve-confirm').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('Approved');
  await page.getByTestId('execute').click();
  await page.getByTestId('execute-confirm').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('Executed');
}

const aprFrom = async (page: Page): Promise<string> => {
  const note = page.getByTestId('notifications');
  await expect(note).toContainText('Submitted APR-');
  const id = /APR-\d+/.exec(await note.innerText())?.[0];
  expect(id).toBeTruthy();
  return id!;
};

test('people v2: PII tier, governed identity, direct operational edit, governed deactivation', async ({ page }) => {
  await test.step('ops requests an identity change for PER-0001 (governed — nothing changes yet)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('person-identity-card')).toBeVisible();
    await page.getByTestId('person-identity-request').click();
    await page.getByTestId('identity-first').fill('Jordan');
    await page.getByTestId('identity-last').fill('Reyes');
    await page.getByTestId('identity-dob').fill('1999-05-20');
    await page.getByTestId('person-identity-request-confirm').click();
    // still unchanged — the pipeline is not decoration
    await expect(page.getByTestId('person-first-name')).toContainText('—');
  });

  await test.step('owner approves + executes; the identity lands', async () => {
    const approvalId = await aprFrom(page);
    await login(page, 'owner@alpha.com', 'owner');
    await decideAndExecute(page, approvalId);
    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('person-first-name')).toContainText('Jordan');
    await expect(page.getByTestId('person-dob')).toContainText('1999-05-20'); // owner holds PII standing
  });

  await test.step('ops edits operational details directly (audited, immediate)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people/PER-0001');
    await page.getByTestId('person-edit-operational').click();
    await page.getByTestId('ops-position').fill('Team Captain');
    await page.getByTestId('ops-phone').fill('+971500000009');
    await page.getByTestId('person-edit-operational-confirm').click();
    await expect(page.getByTestId('person-position')).toContainText('Team Captain');
    await expect(page.getByTestId('person-phone')).toContainText('+971500000009');
  });

  await test.step('finance sees NO PII block — structural omission, not masking', async () => {
    await login(page, 'finance@alpha.com', 'finance');
    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('person-identity-card')).toBeVisible();
    await expect(page.getByTestId('person-first-name')).toContainText('Jordan'); // identity facts stay visible
    await expect(page.getByTestId('person-pii-block')).toHaveCount(0);
    await expect(page.getByTestId('person-dob')).toHaveCount(0);
  });

  const freshId = await test.step('a fresh person is created for the lifecycle walk', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people');
    await page.getByTestId('add-person-toggle').click();
    await page.getByTestId('add-person-fullname').fill('Lifecycle Probe');
    await page.getByTestId('add-person-submit').click();
    await page.getByTestId('add-person-submit-confirm').click();
    const approvalId = await aprFrom(page);
    await login(page, 'owner@alpha.com', 'owner');
    await decideAndExecute(page, approvalId);
    const link = page.getByTestId('created-person-link');
    await expect(link).toBeVisible();
    return (await link.innerText()).trim();
  });

  await test.step('governed deactivation: request → execute → Inactive', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto(`/people/${freshId}`);
    await page.getByTestId('person-deactivate-request').click();
    await page.getByTestId('lifecycle-reason').fill('Left the organization — E2E');
    await page.getByTestId('person-deactivate-request-confirm').click();
    const approvalId = await aprFrom(page);

    await login(page, 'owner@alpha.com', 'owner');
    await decideAndExecute(page, approvalId);
    await page.goto(`/people/${freshId}`);
    await expect(page.getByTestId('person-title')).toContainText('Lifecycle Probe');
    await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
    // the reactivate affordance replaces deactivate on an inactive person
    await expect(page.getByTestId('person-reactivate-request')).toBeVisible();
    await expect(page.getByTestId('person-deactivate-request')).toHaveCount(0);
  });
});
