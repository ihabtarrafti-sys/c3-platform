import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for Track B1 — request corrections. Runs on the shared
 * embedded stack (one worker), capturing its own approval id from the UI.
 *
 * "Polish freely until review starts — every change on the record; after
 * that, frozen; corrections are new requests."
 *
 * Flow: Operations submits an AddPerson request with a typo → edits it in
 * place before review (Edited ×1 badge) → the Owner rejects it → Operations
 * revises & resubmits a corrected, LINKED fresh request.
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

async function captureApr(page: Page): Promise<string> {
  const note = page.getByTestId('notifications');
  const match = (await note.textContent())?.match(/APR-\d{4,}/);
  expect(match, 'a fresh APR id in the toast').toBeTruthy();
  return match![0];
}

test('Request corrections: edit before review, then revise a rejected request', async ({ page }) => {
  let apr = '';

  await test.step('Operations submits an AddPerson request with a typo', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('add-person-toggle').click();
    await page.getByTestId('add-person-fullname').fill('Alixandra Vega'); // deliberate typo
    await page.getByTestId('add-person-submit').click();
    await page.getByTestId('add-person-submit-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('Submitted APR-');
    apr = await captureApr(page);
  });

  await test.step('Edit before review: the name is fixed in place, on the record', async () => {
    await page.goto(`/approvals/${apr}`);
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Submitted');
    await expect(page.getByTestId('approval-fullname')).toHaveText('Alixandra Vega');

    await page.getByTestId('edit-request').click();
    const field = page.getByTestId('correction-fullName');
    await expect(field).toHaveValue('Alixandra Vega');
    await field.fill('Alexandra Vega');
    await page.getByTestId('edit-request-confirm').click();

    await expect(page.getByTestId('notifications')).toContainText('Request edited');
    await expect(page.getByTestId('approval-fullname')).toHaveText('Alexandra Vega');
    await expect(page.getByTestId('edited-badge')).toHaveText('Edited ×1');
  });

  await test.step('The Owner rejects it (a decision the submitter cannot make)', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto(`/approvals/${apr}`);
    await page.getByTestId('begin-review').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('In review');
    await page.getByTestId('reject').click();
    await page.getByTestId('reject-reason').fill('Use the legal full name');
    await page.getByTestId('reject-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Rejected');
  });

  await test.step('Operations revises & resubmits — a fresh LINKED request', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto(`/approvals/${apr}`);
    await page.getByTestId('revise-request').click();
    const field = page.getByTestId('correction-fullName');
    await expect(field).toHaveValue('Alexandra Vega'); // prefilled from the original input
    await field.fill('Alexandra Maria Vega');
    await page.getByTestId('revise-request-confirm').click();

    // The old request now points forward and stays Rejected.
    await expect(page.getByTestId('superseded-by-link')).toBeVisible();
    const freshApr = (await page.getByTestId('superseded-by-link').textContent())!.trim();
    expect(freshApr).not.toBe(apr);

    // The fresh request is Submitted and points back.
    await page.goto(`/approvals/${freshApr}`);
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Submitted');
    await expect(page.getByTestId('approval-fullname')).toHaveText('Alexandra Maria Vega');
    await expect(page.getByTestId('revision-of-link')).toHaveText(apr);
  });
});
