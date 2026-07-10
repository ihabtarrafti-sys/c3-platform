import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for S9 expense claims: hr submits their own expense,
 * sees only their own register; ops (finance standing) reviews, approves and
 * pays with a bank LABEL; the claim page carries the whole story; a visitor
 * has no surface at all. Creates only claims — safe at this suite position.
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

test('Claims: hr submits → ops decides and pays with a label → the story is on the page', async ({ page }) => {
  let claimId = '';

  await test.step('hr submits an expense and sees only their own claims', async () => {
    await login(page, 'hr@alpha.com', 'hr');
    await page.getByTestId('nav-claims').click();
    await page.getByTestId('add-claim-toggle').click();
    await page.getByTestId('add-claim-description').fill('Taxi to the venue');
    await page.getByTestId('add-claim-amount').fill('125');
    await page.getByTestId('add-claim-date').fill('2026-07-01');
    await page.getByTestId('add-claim-submit').click();
    await page.getByTestId('add-claim-submit-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText(/CLM-\d{4} submitted/);

    const row = page.locator('[data-testid^="claim-row-CLM-"]').first();
    claimId = (await row.getAttribute('data-testid'))!.replace('claim-row-', '');
    await expect(page.getByTestId(`claim-status-${claimId}`)).toHaveText('Submitted');
  });

  await test.step('ops reviews, approves, and pays with a bank LABEL', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto(`/claims/${claimId}`);
    await expect(page.getByTestId('claim-amount')).toContainText('USD 125.00');

    await page.getByTestId('claim-begin-review').click();
    await page.getByTestId('claim-begin-review-confirm').click();
    await expect(page.getByTestId('claim-detail-status')).toHaveText('In review');

    await page.getByTestId('claim-approve').click();
    await page.getByTestId('claim-approve-confirm').click();
    await expect(page.getByTestId('claim-detail-status')).toHaveText('Approved');

    await page.getByTestId('claim-pay').click();
    await page.getByTestId('claim-pay-label').fill('ESA');
    await page.getByTestId('claim-pay-confirm').click();
    await expect(page.getByTestId('claim-detail-status')).toHaveText('Paid');
    await expect(page.getByTestId('claim-audit')).toContainText('Claim paid');
  });

  await test.step('hr sees the outcome; a visitor has no claims surface', async () => {
    await login(page, 'hr@alpha.com', 'hr');
    await page.goto(`/claims/${claimId}`);
    await expect(page.getByTestId('claim-detail-status')).toHaveText('Paid');
    // Their own claim page never shows decision buttons (separation by absence).
    await expect(page.getByTestId('claim-begin-review')).toHaveCount(0);

    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-claims')).toHaveCount(0);
    await page.goto('/claims');
    await expect(page.getByTestId('claims-denied')).toBeVisible();
  });
});
