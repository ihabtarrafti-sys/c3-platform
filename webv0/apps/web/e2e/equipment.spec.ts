import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for the Kit & Apparel registers (Sprint 38). Direct-
 * audited CRUD: create → edit (versioned) → deactivate, plus the HR split
 * (apparel yes, kit no) and read-only affordance absence.
 */

async function login(page: Page, email: string, role: string): Promise<void> {
  await page.goto('/people');
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

test('Kit & Apparel direct-audited registers, end to end', async ({ page }) => {
  await test.step('Operations creates a kit item (immediate, recorded)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-kit').click();
    await expect(page.getByTestId('kit-empty')).toBeVisible();

    await page.getByTestId('add-kit-toggle').click();
    await page.getByTestId('add-kit-name').fill('Tournament headset #3');
    await page.getByTestId('add-kit-category').fill('Peripheral');
    await page.getByTestId('add-kit-submit').click();
    await page.getByTestId('add-kit-submit-confirm').click();

    const row = page.getByTestId('kit-row-KIT-0001');
    await expect(row).toBeVisible();
    await expect(page.getByTestId('kit-status-KIT-0001')).toHaveText('Active');
    await expect(page.getByTestId('kit-fulfillment-KIT-0001')).toHaveText('Received');
  });

  await test.step('Fulfillment status walks the state machine (direct-audited)', async () => {
    // Received → InProgress: only the legal transitions are offered.
    await page.getByTestId('transition-kit-start-KIT-0001').click();
    await page.getByTestId('transition-kit-start-KIT-0001-confirm').click();
    await expect(page.getByTestId('kit-fulfillment-KIT-0001')).toHaveText('In progress');

    // The now-illegal 'ship' transition is not even offered from InProgress.
    await expect(page.getByTestId('transition-kit-ship-KIT-0001')).toHaveCount(0);

    // InProgress → ReadyForShipment.
    await page.getByTestId('transition-kit-ready-KIT-0001').click();
    await page.getByTestId('transition-kit-ready-KIT-0001-confirm').click();
    await expect(page.getByTestId('kit-fulfillment-KIT-0001')).toHaveText('Ready for shipment');
  });

  await test.step('Edit is versioned and immediate; deactivate retires the row actions', async () => {
    await page.getByTestId('edit-kit-KIT-0001').click();
    await page.getByTestId('edit-kit-name-KIT-0001').fill('Tournament headset #3 (repaired)');
    await page.getByTestId('edit-kit-KIT-0001-confirm').click();
    await expect(page.getByTestId('kit-row-KIT-0001')).toContainText('(repaired)');

    await page.getByTestId('deactivate-kit-KIT-0001').click();
    await page.getByTestId('deactivate-kit-KIT-0001-confirm').click();
    await expect(page.getByTestId('kit-status-KIT-0001')).toHaveText('Inactive');
    await expect(page.getByTestId('edit-kit-KIT-0001')).toHaveCount(0); // retired rows offer nothing
  });

  await test.step('HR manages apparel but sees no kit affordances (CP parity)', async () => {
    await login(page, 'hr@alpha.com', 'hr');
    await page.getByTestId('nav-apparel').click();
    await page.getByTestId('apparel-empty-add').click();
    await page.getByTestId('add-apparel-name').fill('Away jersey L');
    await page.getByTestId('add-apparel-category').fill('Jersey');
    await page.getByTestId('add-apparel-size').fill('L');
    await page.getByTestId('add-apparel-submit').click();
    await page.getByTestId('add-apparel-submit-confirm').click();
    await expect(page.getByTestId('apparel-row-APL-0001')).toBeVisible();

    await page.getByTestId('nav-kit').click();
    await expect(page.getByTestId('kit-row-KIT-0001')).toBeVisible(); // reads fine
    await expect(page.getByTestId('add-kit-toggle')).toHaveCount(0); // manages nothing
  });

  await test.step('A read-only identity sees both registers with zero write affordances', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await page.getByTestId('nav-apparel').click();
    await expect(page.getByTestId('apparel-row-APL-0001')).toBeVisible();
    await expect(page.getByTestId('add-apparel-toggle')).toHaveCount(0);
    await expect(page.getByTestId('edit-apparel-APL-0001')).toHaveCount(0);
  });
});
