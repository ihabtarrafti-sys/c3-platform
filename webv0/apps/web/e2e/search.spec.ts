import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for S3 global search. Runs late on the shared stack
 * (alphabetically after missions/personHub): PER-0001 "Jordan Reyes",
 * MSN-0001 "Spring Invitational", and AGR-0001 (code GKE-PL-2026-001-R1)
 * already exist from earlier specs.
 *
 * The role boundary IS the assertion: the owner finds agreements; the visitor
 * searching the same code gets "no matches you can see".
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

test('Global search: any id or name, only within your role’s world', async ({ page }) => {
  await test.step('Ctrl+K focuses the box; a person is found by name and opened', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('global-search')).toBeFocused();

    await page.getByTestId('global-search').fill('Jordan');
    await expect(page.getByTestId('search-hit-PER-0001')).toBeVisible();
    await page.getByTestId('search-hit-PER-0001').click();
    await expect(page).toHaveURL(/\/people\/PER-0001$/);
  });

  await test.step('A mission is found by its id; Enter opens the top hit', async () => {
    await page.getByTestId('global-search').fill('MSN-0001');
    await expect(page.getByTestId('search-hit-MSN-0001')).toBeVisible();
    await page.getByTestId('global-search').press('Enter');
    await expect(page).toHaveURL(/\/missions\/MSN-0001$/);
    await expect(page.getByTestId('mission-title')).toHaveText('Spring Invitational');
  });

  await test.step('The owner finds the agreement by its code', async () => {
    await page.getByTestId('global-search').fill('GKE-PL');
    await expect(page.getByTestId('search-hit-AGR-0001')).toBeVisible();
  });

  await test.step('The visitor searching the same code sees nothing — the role boundary in the results', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await page.getByTestId('global-search').fill('GKE-PL');
    await expect(page.getByTestId('search-results')).toBeVisible();
    await expect(page.getByTestId('search-hit-AGR-0001')).toHaveCount(0);
    await expect(page.getByTestId('search-results')).toContainText('No matches you can see');

    // …but the visitor's own world is searchable.
    await page.getByTestId('global-search').fill('Jordan');
    await expect(page.getByTestId('search-hit-PER-0001')).toBeVisible();
  });
});
