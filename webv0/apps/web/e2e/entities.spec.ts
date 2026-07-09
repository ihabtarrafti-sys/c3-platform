import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for the Entities domain (S48) + ENTITY-LEVEL agreements
 * (Tier-0 S1). Direct-audited CRUD for the tenant's legal operating entities,
 * the owner/operations management gate, the "signed with" threading on Add
 * Person, and the person-less agreement: a sponsorship anchored to the entity
 * alone rides the governed pipeline (the anchor rule visible in the browser).
 * Runs alphabetically after agreements (AGR-0001/0002 exist), before equipment;
 * the entity is deactivated at the end so later specs see no active entity.
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
  // Tier-0 S1 adds a governed entity-level agreement round-trip (requester ≠
  // approver logins) on top of the CRUD walk — triple the budget.
  test.slow();

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
  });

  await test.step('An ENTITY-LEVEL agreement: no person, anchored to the entity alone (Tier-0 S1)', async () => {
    // Ops requests a sponsorship with NO person. The submit stays disabled
    // while the request is anchored to nothing — the anchor rule in the UI.
    await page.getByTestId('nav-agreements').click();
    await page.getByTestId('add-agreement-toggle').click();
    await page.getByTestId('add-agreement-type').fill('Sponsorship');
    await page.getByTestId('add-agreement-starts').fill('2026-08-01');
    await page.getByTestId('add-agreement-ends').fill('2027-07-31');
    await expect(page.getByTestId('add-agreement-submit')).toBeDisabled(); // anchored to nothing
    await page.getByTestId('add-agreement-entity').click();
    await page.getByRole('option', { name: /Geekay Esports/ }).click();
    await page.getByTestId('add-agreement-submit').click();
    await page.getByTestId('add-agreement-submit-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('not created until an owner executes');
    const all = (await page.getByTestId('notifications').textContent())?.match(/APR-\d{4,}/g);
    const entApr = all![all!.length - 1]!;

    // Owner executes; the approval subject names the ENTITY, never a fake person.
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto(`/approvals/${entApr}`);
    await expect(page.getByTestId('approval-agreement-subject')).toHaveText('Sponsorship for ENT-0001');
    await page.getByTestId('begin-review').click();
    await page.getByTestId('approve').click();
    await page.getByTestId('approve-confirm').click();
    await page.getByTestId('execute').click();
    await page.getByTestId('execute-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Executed');

    // The register shows the person-less row honestly; the detail names the entity.
    await page.getByTestId('nav-agreements').click();
    await expect(page.getByTestId('agreement-row-AGR-0003')).toBeVisible();
    await expect(page.getByTestId('agreement-person-AGR-0003')).toHaveText('—');
    await expect(page.getByTestId('agreement-entity-AGR-0003')).toHaveText('Geekay Esports FZ-LLC');
    await page.getByTestId('agreement-link-AGR-0003').click();
    await expect(page.getByTestId('agreement-no-person')).toHaveText('— (entity-level)');
    await expect(page.getByTestId('agreement-entity')).toHaveText('Geekay Esports FZ-LLC');
  });

  await test.step('The entity is retired again so later specs see no active entity', async () => {
    await page.getByTestId('nav-entities').click();
    await page.getByTestId('deactivate-entity-ENT-0001').click();
    await page.getByTestId('deactivate-entity-ENT-0001-confirm').click();
    await expect(page.getByTestId('entity-status-ENT-0001')).toHaveText('Inactive');
  });

  await test.step('A read-only identity sees no Entities nav (management is gated)', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-entities')).toHaveCount(0);
  });
});
