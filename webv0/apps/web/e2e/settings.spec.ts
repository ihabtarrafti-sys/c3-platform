import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for Settings → Exchange rates (Finance Sprint 1). The org
 * maintains one rate per currency (its value in USD); the UI shows the derived
 * inverse immediately and persists on save. Owner/operations only.
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

test('Settings → exchange rates: set a rate, see the inverse, persist', async ({ page }) => {
  await test.step('Operations sets an AED rate and the derived inverse shows', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('fx-rates-panel')).toBeVisible();

    await page.getByTestId('fx-rate-AED').fill('0.2723');
    // ≈ 1 USD = 3.6724 AED shown live
    await expect(page.getByText(/1 USD = 3\.672/)).toBeVisible();
    await page.getByTestId('fx-save-AED').click();
    await expect(page.getByTestId('notifications')).toContainText('1 AED = 0.2723 USD');
  });

  await test.step('The saved rate survives a reload', async () => {
    await page.reload();
    await expect(page.getByTestId('fx-rate-AED')).toHaveValue('0.2723');
  });

  await test.step('A read-only identity sees no Settings nav', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-settings')).toHaveCount(0);
  });
});
