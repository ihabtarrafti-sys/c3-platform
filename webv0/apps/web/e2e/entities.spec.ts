import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for the Entities domain (S48). Direct-audited CRUD for the
 * tenant's legal operating entities, the owner/operations management gate, and
 * the threading: an active entity is offered as "signed with" when adding a
 * person. Runs alphabetically after credentials, before equipment; the entity
 * it creates is deactivated at the end so later specs see no active entity.
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

test('Entities register + person assignment threading, end to end', async ({ page }) => {
  await test.step('Operations creates a legal operating entity (immediate, recorded)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-entities').click();
    await expect(page.getByTestId('entities-empty')).toBeVisible();

    await page.getByTestId('add-entity-toggle').click();
    await page.getByTestId('add-entity-name').fill('Geekay UAE');
    await page.getByTestId('add-entity-jurisdiction').fill('United Arab Emirates');
    await page.getByTestId('add-entity-currency').click();
    await page.getByRole('option', { name: 'AED', exact: true }).click();
    await page.getByTestId('add-entity-registration').fill('DED-123456');
    await page.getByTestId('add-entity-submit').click();
    await page.getByTestId('add-entity-submit-confirm').click();

    await expect(page.getByTestId('entity-row-ENT-0001')).toBeVisible();
    await expect(page.getByTestId('entity-status-ENT-0001')).toHaveText('Active');
    await expect(page.getByTestId('entity-currency-ENT-0001')).toHaveText('AED');
  });

  await test.step('The active entity is offered as "signed with" when adding a person', async () => {
    await page.getByTestId('nav-people').click();
    await page.getByTestId('add-person-toggle').click();
    await page.getByTestId('add-person-entity').click();
    await expect(page.getByRole('option', { name: /Geekay UAE/ })).toBeVisible();
    await page.keyboard.press('Escape'); // close the dropdown
    await page.getByTestId('form-drawer-close').click(); // close the Add Person drawer
    await expect(page.getByTestId('add-person-entity')).toHaveCount(0);
  });

  await test.step('Edit is immediate; deactivate retires the row actions', async () => {
    await page.getByTestId('nav-entities').click();
    await page.getByTestId('edit-entity-ENT-0001').click();
    await page.getByTestId('edit-entity-name-ENT-0001').fill('Geekay Esports FZ-LLC');
    await page.getByTestId('edit-entity-ENT-0001-confirm').click();
    await expect(page.getByTestId('entity-row-ENT-0001')).toContainText('Geekay Esports');

    await page.getByTestId('deactivate-entity-ENT-0001').click();
    await page.getByTestId('deactivate-entity-ENT-0001-confirm').click();
    await expect(page.getByTestId('entity-status-ENT-0001')).toHaveText('Inactive');
    await expect(page.getByTestId('edit-entity-ENT-0001')).toHaveCount(0); // retired rows offer nothing
  });

  await test.step('An inactive entity can be reactivated', async () => {
    await expect(page.getByTestId('reactivate-entity-ENT-0001')).toBeVisible();
    await page.getByTestId('reactivate-entity-ENT-0001').click();
    await page.getByTestId('reactivate-entity-ENT-0001-confirm').click();
    await expect(page.getByTestId('entity-status-ENT-0001')).toHaveText('Active');
    await expect(page.getByTestId('edit-entity-ENT-0001')).toBeVisible(); // actions return

    // Leave it inactive so later specs see no active entity (dropdown stays clean).
    await page.getByTestId('deactivate-entity-ENT-0001').click();
    await page.getByTestId('deactivate-entity-ENT-0001-confirm').click();
    await expect(page.getByTestId('entity-status-ENT-0001')).toHaveText('Inactive');
  });

  await test.step('A read-only identity sees no Entities nav (management is gated)', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-entities')).toHaveCount(0);
  });
});
