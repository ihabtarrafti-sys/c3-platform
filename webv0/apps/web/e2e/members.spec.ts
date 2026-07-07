import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for governed member administration (Sprint 35).
 * Runs against the same live stack as addPerson.spec (shared embedded PG, one
 * worker), so approval ids are captured from the UI rather than hardcoded.
 *
 * Flow: Operations requests a member provision (governed dialog) → the Owner
 * reviews/approves/executes through the SAME approval surface → the member is
 * live in the register → a role-change request goes through the row action →
 * a read-only identity sees neither the nav item nor the register.
 */

async function login(page: Page, email: string, role: string): Promise<void> {
  await page.goto('/people');
  const logout = page.getByTestId('logout');
  if (await logout.isVisible().catch(() => false)) {
    await logout.click();
  }
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: role, exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('role-display')).toContainText(role);
}

test('Member administration governed workflow, end to end', async ({ page }) => {
  let provisionApprovalId = '';

  await test.step('Operations requests a member provision (nothing changes yet)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-members').click();
    await expect(page.getByTestId('members-table')).toBeVisible();

    await page.getByTestId('provision-member-toggle').click();
    await page.getByTestId('provision-email').fill('new.lead@alpha.com');
    await page.getByTestId('provision-name').fill('New Lead');
    await page.getByTestId('provision-role').click();
    await page.getByRole('option', { name: 'management', exact: true }).click();
    await page.getByTestId('provision-submit').click();
    await page.getByTestId('provision-submit-confirm').click();

    const note = page.getByTestId('notifications');
    await expect(note).toContainText('for approval — provision new.lead@alpha.com');
    const match = (await note.textContent())?.match(/APR-\d{4,}/);
    expect(match).toBeTruthy();
    provisionApprovalId = match![0];

    // Not a member until executed.
    await expect(page.getByTestId('member-row-new.lead@alpha.com')).toHaveCount(0);
  });

  await test.step('Owner approves and executes through the standard approval surface', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto(`/approvals/${provisionApprovalId}`);
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Submitted');
    await expect(page.getByTestId('approval-member-email')).toHaveText('new.lead@alpha.com');
    await page.getByTestId('begin-review').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('In review');
    await page.getByTestId('approve').click();
    await page.getByTestId('approve-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Approved');
    await page.getByTestId('execute').click();
    await page.getByTestId('execute-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Executed');
  });

  await test.step('The member is live in the register with the requested role', async () => {
    await page.getByTestId('nav-members').click();
    const row = page.getByTestId('member-row-new.lead@alpha.com');
    await expect(row).toBeVisible();
    await expect(row).toContainText('management');
    await expect(row).toContainText('Active');
  });

  await test.step('A role change is requested through the governed row action', async () => {
    await page.getByTestId('change-role-new.lead@alpha.com').click();
    await page.getByTestId('change-role-picker-new.lead@alpha.com').click();
    await page.getByRole('option', { name: 'operations', exact: true }).click();
    await page.getByTestId('change-role-new.lead@alpha.com-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('change new.lead@alpha.com to operations');
    // Role unchanged until an owner executes the new request.
    await expect(page.getByTestId('member-row-new.lead@alpha.com')).toContainText('management');
  });

  await test.step('A read-only identity has no member surface at all', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-members')).toHaveCount(0);
    await page.goto('/members');
    await expect(page.getByTestId('members-denied')).toBeVisible();
  });
});
