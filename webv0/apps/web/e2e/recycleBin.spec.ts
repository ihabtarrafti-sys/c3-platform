import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for Track B2 — the Recycle Bin. Runs on the shared
 * embedded stack (one worker); captures its own entity id, so it never
 * assumes an empty bin (earlier specs leave removed records behind).
 *
 * Flow: create an entity → deactivate it (direct-audited) → find it in the
 * recycle bin with its provenance → Restore it (direct, immediate) → it
 * leaves the bin and is Active again in the register.
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

test('Recycle bin: a removed entity is found with provenance and restored', async ({ page }) => {
  let entityId = '';
  const NAME = 'Recyclable Holdings';

  await test.step('Operations creates an entity, then removes it', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-entities').click();
    await page.getByTestId('add-entity-toggle').click();
    await page.getByTestId('add-entity-name').fill(NAME);
    await page.getByTestId('add-entity-jurisdiction').fill('United Arab Emirates');
    await page.getByTestId('add-entity-currency').click();
    await page.getByRole('option', { name: 'AED', exact: true }).click();
    await page.getByTestId('add-entity-submit').click();
    await page.getByTestId('add-entity-submit-confirm').click();

    // Capture the new entity's id from its row (shared stack — not ENT-0001).
    const row = page.getByRole('row', { name: new RegExp(NAME) }).first();
    await expect(row).toBeVisible();
    entityId = (await row.getAttribute('data-testid'))!.replace('entity-row-', '');
    expect(entityId).toMatch(/^ENT-\d{4,}$/);

    await page.getByTestId(`deactivate-entity-${entityId}`).click();
    await page.getByTestId(`deactivate-entity-${entityId}-confirm`).click();
    await expect(page.getByTestId(`entity-status-${entityId}`)).toHaveText('Inactive');
  });

  await test.step('The removed entity is in the recycle bin, with who removed it', async () => {
    await page.goto('/recycle-bin');
    await expect(page.getByTestId('recycle-table')).toBeVisible();
    const row = page.getByTestId(`recycle-row-${entityId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(NAME);
    await expect(row).toContainText('ops@alpha.com'); // provenance
  });

  await test.step('Restore brings it straight back and it leaves the bin', async () => {
    await page.getByTestId(`recycle-restore-${entityId}`).click();
    await page.getByTestId(`recycle-restore-${entityId}-confirm`).click();
    await expect(page.getByTestId('notifications')).toContainText(`${entityId} restored`);
    await expect(page.getByTestId(`recycle-row-${entityId}`)).toHaveCount(0);
  });

  await test.step('It is Active again in the entities register', async () => {
    await page.getByTestId('nav-entities').click();
    await expect(page.getByTestId(`entity-status-${entityId}`)).toHaveText('Active');
  });

  await test.step('A read-only identity sees no recycle bin', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-recycle bin')).toHaveCount(0);
    await page.goto('/recycle-bin');
    await expect(page.getByTestId('recycle-denied')).toBeVisible();
  });
});
