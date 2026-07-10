import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for S7 Teams: a division with its reporting code, the
 * roster with the structured-code suggestion, the mission team tag, and THE
 * report — per-team P&L with ROI% aggregated from tagged missions. Runs
 * LAST on the shared stack (it only consumes what earlier specs left).
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

test('Teams: division + roster with code suggestion → mission tag → per-team P&L with ROI', async ({ page }) => {
  let teamId = '';

  await test.step('Ops creates the TST division; the code is the reporting key', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-teams').click();
    await page.getByTestId('add-team-toggle').click();
    await page.getByTestId('add-team-name').fill('Test Division');
    await page.getByTestId('add-team-code').fill('TST');
    await page.getByTestId('add-team-game').fill('Testcraft');
    await page.getByTestId('add-team-submit').click();
    await page.getByTestId('add-team-submit-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('Team created');

    const row = page.locator('[data-testid^="team-row-"]', { hasText: 'Test Division' }).first();
    teamId = (await row.getAttribute('data-testid'))!.replace('team-row-', '');
    await row.locator('[data-testid^="team-link-"]').click();
    await expect(page.getByTestId('team-detail-code')).toHaveText('TST');
  });

  await test.step('The roster: add a member; the structured code suggestion shows TST/PL/001', async () => {
    await page.getByTestId('add-team-member').click();
    await page.getByTestId('add-team-member-person').click();
    await page.getByRole('option', { name: /Jordan Reyes/ }).first().click();
    await expect(page.getByTestId('personnel-code-suggestion')).toContainText('TST/PL/001');
    await page.getByTestId('add-team-member-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('Member added');
    await expect(page.getByTestId('team-member-count')).toHaveText('1');
    await expect(page.locator('[data-testid^="team-member-row-"]').first()).toContainText('Jordan Reyes');
  });

  await test.step('Tag an existing settled mission to the division — the P&L report aggregates it', async () => {
    // The settlement spec left "Invoice Cup" active and Settled with USD 8,000
    // received income and no expenses — a clean aggregation fixture.
    await page.getByTestId('nav-missions').click();
    const row = page.locator('[data-testid^="mission-row-"]', { hasText: 'Invoice Cup' }).first();
    const missionId = (await row.getAttribute('data-testid'))!.replace('mission-row-', '');
    await row.locator('[data-testid^="mission-link-"]').click();

    await page.getByTestId(`edit-mission-${missionId}`).click();
    await page.getByTestId(`edit-mission-team-${missionId}`).click();
    await page.getByRole('option', { name: /TST · Test Division/ }).click();
    await page.getByTestId(`edit-mission-${missionId}-confirm`).click();
    await expect(page.getByTestId('notifications')).toContainText('updated and recorded');
    await expect(page.getByTestId('mission-team-link')).toContainText('TST');

    await page.goto(`/teams/${teamId}`);
    const financeRow = page.locator(`[data-testid="team-finance-row-${missionId}"]`);
    await expect(financeRow).toBeVisible();
    await expect(financeRow).toContainText('Invoice Cup');
    const totals = page.getByTestId('team-finance-totals');
    await expect(totals).toContainText('USD 8,000.00'); // the received prize income
    await expect(totals).toContainText('no expense base'); // ROI needs spend; the profit column tells the story
  });

  await test.step('A visitor reads the register but cannot manage; finance is absent', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await page.getByTestId('nav-teams').click();
    await expect(page.getByTestId('teams-table')).toBeVisible();
    await expect(page.getByTestId('add-team-toggle')).toHaveCount(0);
    await page.goto(`/teams/${teamId}`);
    await expect(page.getByTestId('team-roster')).toBeVisible();
    await expect(page.getByTestId('team-finance')).toHaveCount(0); // money view gated
  });
});
