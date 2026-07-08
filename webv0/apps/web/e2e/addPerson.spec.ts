import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for the People + AddPerson governed workflow. A single
 * deterministic run against a fresh embedded PostgreSQL: Operations submits,
 * Owner reviews/approves (no person yet), Owner executes (exactly one person),
 * history/audit render, the requester cannot review, and a read-only identity
 * sees no write affordance.
 */

async function login(page: Page, email: string, role: string): Promise<void> {
  await page.goto('/people');
  // Sign out first if a session is active.
  // Deterministic sign-out: under load the page may still be rendering, so a
  // one-shot isVisible() snapshot races. Wait briefly for an active session's
  // logout control; fall through when already signed out.
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

test('AddPerson governed workflow, end to end', async ({ page }) => {
  await test.step('Operations signs in and submits AddPerson (no person yet)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await expect(page.getByTestId('people-empty')).toBeVisible();
    await page.getByTestId('add-person-toggle').click();
    await page.getByTestId('add-person-fullname').fill('Jordan Reyes');
    await page.getByTestId('add-person-team').fill('Vanguard');
    await page.getByTestId('add-person-submit').click();
    await page.getByTestId('add-person-submit-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('Submitted APR-0001');
    // Still no person.
    await expect(page.getByTestId('people-empty')).toBeVisible();
  });

  await test.step('Operations (the requester) cannot review its own request', async () => {
    await page.goto('/approvals/APR-0001');
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Submitted');
    await expect(page.getByTestId('begin-review')).toHaveCount(0);
  });

  await test.step('Owner signs in and sees the request', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto('/approvals');
    await expect(page.getByTestId('approval-row-APR-0001')).toBeVisible();
    await expect(page.getByTestId('approval-status-APR-0001')).toHaveText('Submitted');
  });

  await test.step('Owner begins review and approves; person still does not exist', async () => {
    await page.goto('/approvals/APR-0001');
    await page.getByTestId('begin-review').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('In review');
    await page.getByTestId('approve').click();
    await page.getByTestId('approve-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Approved');
    // Approval alone creates no person.
    await page.goto('/people');
    await expect(page.getByTestId('people-empty')).toBeVisible();
  });

  await test.step('Owner executes; exactly one person appears', async () => {
    await page.goto('/approvals/APR-0001');
    await page.getByTestId('execute').click();
    await page.getByTestId('execute-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Executed');
    await expect(page.getByTestId('created-person-link')).toHaveText('PER-0001');

    await page.goto('/people');
    await expect(page.getByTestId('person-row-PER-0001')).toBeVisible();
    await expect(page.getByTestId('people-table').locator('tbody tr')).toHaveCount(1);
  });

  await test.step('Approval history and person audit render; deep link + refresh work', async () => {
    await page.goto('/approvals/APR-0001');
    await page.reload(); // deep-link + browser refresh must resolve the route
    await expect(page.getByTestId('approval-events')).toBeVisible();
    await expect(page.getByTestId('approval-events')).toContainText('Executed');

    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('person-title')).toHaveText('Jordan Reyes');
    await expect(page.getByTestId('person-audit')).toContainText('Person created');
  });

  await test.step('A read-only identity sees no write affordance', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('add-person-toggle')).toHaveCount(0);
    await page.goto('/approvals');
    await expect(page.getByTestId('approvals-denied')).toBeVisible();
  });
});
