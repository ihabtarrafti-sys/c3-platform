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

  await test.step('HARDEN-2: per-diem presets — defaults shown, edit is version-guarded, persists', async () => {
    await expect(page.getByTestId('perdiem-presets-panel')).toBeVisible();
    // the org's real defaults (no row yet)
    await expect(page.getByTestId('perdiem-presets-state')).toHaveText('defaults');
    await expect(page.getByTestId('perdiem-preset-row-0')).toContainText('SAR 65.00/day');
    await expect(page.getByTestId('perdiem-preset-row-2')).toContainText('USD 25.00/day');

    // add 50 USD → first write lands as v0
    await page.getByTestId('perdiem-preset-amount').fill('50');
    await page.getByTestId('perdiem-preset-currency').click();
    await page.getByRole('option', { name: 'USD', exact: true }).click();
    await page.getByTestId('perdiem-preset-add').click();
    await expect(page.getByTestId('perdiem-presets-state')).toHaveText('unsaved changes');
    await page.getByTestId('perdiem-presets-save').click();
    await expect(page.getByTestId('notifications')).toContainText('Per-diem presets saved');
    await expect(page.getByTestId('perdiem-presets-state')).toHaveText('v0');

    await page.reload();
    await expect(page.getByTestId('perdiem-preset-row-3')).toContainText('USD 50.00/day');
  });

  await test.step('The new preset is a one-click pick in the per-diem dialog', async () => {
    await page.goto('/missions/MSN-0001');
    await page.getByTestId('perdiem-participant-PER-0001').click();
    await page.getByTestId('perdiem-preset-PER-0001-5000-USD').click();
    await expect(page.getByTestId('perdiem-amount-PER-0001')).toHaveValue('50');
    // close without saving — the roster's per-diem stays as missions.spec left it
    await page.keyboard.press('Escape');
  });

  await test.step('A read-only identity sees no Settings nav', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-settings')).toHaveCount(0);
  });
});

/**
 * S5 — import/export from Settings: the template downloads, a clean file
 * stages ONE ImportBatch approval (nothing lands), the owner executes it and
 * the people appear in the register; a dirty file gets the per-row report and
 * imports nothing (ALL-OR-NOTHING).
 */
test('Settings → import/export: template → staged batch → owner executes → register; dirty file = report, nothing lands', async ({ page }) => {
  const PEOPLE_HEADER = 'personId,fullName,ign,nationality,primaryRole,personnelCode,currentTeam,currentGameTitle,primaryDepartment,entityId,notes,isActive';
  let stagedId = '';

  await test.step('Operations downloads the blank template — headers are the contract', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('import-export-panel')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByTestId('import-template').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('c3-people-template.csv');
    const text = (await (await import('node:fs/promises')).readFile(await file.path(), 'utf8')).trim();
    expect(text).toBe(PEOPLE_HEADER);
  });

  await test.step('A clean 2-person file stages ONE approval — and nothing lands yet', async () => {
    const csv = [PEOPLE_HEADER, ',Imported Ace,ACE,PH,Player,,,,,,,true', ',Imported Beta,,,Manager,,,,Operations,,,true', ''].join('\n');
    await page.getByTestId('import-file-input').setInputFiles({ name: 'geekay-people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect(page.getByTestId('import-staged')).toBeVisible();
    await expect(page.getByTestId('import-staged')).toContainText(/Staged APR-\d+ — 2 people/);
    stagedId = (await page.getByTestId('import-staged').innerText()).match(/APR-\d+/)![0];

    await page.getByTestId('nav-people').click();
    await expect(page.getByTestId('people-table').or(page.getByTestId('people-empty'))).toBeVisible();
    await expect(page.getByText('Imported Ace')).toHaveCount(0); // staged ≠ landed
  });

  await test.step('The owner reviews and executes the batch — the people appear', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto(`/approvals/${stagedId}`);
    await expect(page.getByTestId('approval-import-subject')).toContainText('Import 2 people from "geekay-people.csv"');
    await page.getByTestId('begin-review').click();
    await page.getByTestId('approve').click();
    await page.getByTestId('approve-confirm').click();
    await page.getByTestId('execute').click();
    await page.getByTestId('execute-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Executed');

    await page.getByTestId('nav-people').click();
    await expect(page.getByText('Imported Ace')).toBeVisible();
    await expect(page.getByText('Imported Beta')).toBeVisible();
  });

  await test.step('A dirty file gets the per-row report and imports nothing', async () => {
    await page.getByTestId('nav-settings').click();
    const bad = [PEOPLE_HEADER, 'PER-9999,Filled Id,,,,,,,,,,', ',,,,,,,,,,,maybe', ''].join('\n');
    await page.getByTestId('import-file-input').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad, 'utf8') });
    await expect(page.getByTestId('import-errors')).toBeVisible();
    await expect(page.getByTestId('import-errors')).toContainText('nothing was imported');
    await expect(page.getByTestId('import-errors')).toContainText('Ids are allocated by C3');
    await expect(page.getByTestId('import-error-row').first()).toBeVisible();
  });

  await test.step('The register exports as CSV in exactly the template shape', async () => {
    const download = page.waitForEvent('download');
    await page.getByTestId('export-people').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('c3-people-export.csv');
    const text = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8');
    expect(text.split('\n')[0]).toBe(PEOPLE_HEADER); // export IS the template
    expect(text).toContain('Imported Ace');
  });

  await test.step('Data quality flags the soft signals import let through (S5 riders)', async () => {
    // Imported Beta landed active with no nationality — import is not allowed
    // to block on that (soft signal); the data-quality report names them.
    await expect(page.getByTestId('dq-panel')).toBeVisible();
    await expect(page.getByTestId('dq-total')).not.toHaveText('…');
    await expect(page.getByTestId('dq-peopleMissingNationality')).toBeVisible();
    await page.getByTestId('dq-peopleMissingNationality-toggle').click();
    await expect(page.getByTestId('dq-peopleMissingNationality-list')).toContainText('Imported Beta');
  });
});
