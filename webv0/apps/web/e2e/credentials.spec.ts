import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for the governed Credentials workflow (Sprint 36).
 * Runs after addPerson.spec on the same live stack, so PER-0001 (Jordan
 * Reyes) exists; approval ids are captured from the UI, never hardcoded.
 *
 * Flow: Operations requests a credential via the governed dialog (dates as
 * plain ISO strings) → Owner approves + executes through the standard
 * approval surface → the register shows the credential with its DERIVED
 * status → the person profile shows the credentials section → a governed
 * deactivation flips it to Inactive → read-only role sees no write affordance.
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

async function captureApprovalId(page: Page): Promise<string> {
  const note = page.getByTestId('notifications');
  const match = (await note.textContent())?.match(/APR-\d{4,}/);
  expect(match).toBeTruthy();
  return match![0];
}

async function ownerExecutes(page: Page, approvalId: string): Promise<void> {
  await page.goto(`/approvals/${approvalId}`);
  await page.getByTestId('begin-review').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('In review');
  await page.getByTestId('approve').click();
  await page.getByTestId('approve-confirm').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('Approved');
  await page.getByTestId('execute').click();
  await page.getByTestId('execute-confirm').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('Executed');
}

test('Credentials governed workflow, end to end', async ({ page }) => {
  let addApprovalId = '';

  await test.step('Operations requests a credential for PER-0001 (nothing exists yet)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-credentials').click();
    await expect(page.getByTestId('credentials-empty')).toBeVisible();

    await page.getByTestId('add-credential-toggle').click();
    await page.getByTestId('add-credential-person').click();
    await page.getByRole('option', { name: /Jordan Reyes/ }).click();
    await page.getByTestId('add-credential-type').fill('Coaching License A');
    await page.getByTestId('add-credential-issuer').fill('Federation');
    await page.getByTestId('add-credential-issued').fill('2026-01-02');
    await page.getByTestId('add-credential-expires').fill('2031-12-30');
    await page.getByTestId('add-credential-submit').click();
    await page.getByTestId('add-credential-submit-confirm').click();

    await expect(page.getByTestId('notifications')).toContainText('for approval. The credential is not created');
    addApprovalId = await captureApprovalId(page);
    await expect(page.getByTestId('credentials-empty')).toBeVisible(); // still nothing
  });

  await test.step('Owner approves and executes; the credential appears with its derived status', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto(`/approvals/${addApprovalId}`);
    await expect(page.getByTestId('approval-credential-subject')).toHaveText('Coaching License A for PER-0001');
    await ownerExecutes(page, addApprovalId);

    await page.getByTestId('nav-credentials').click();
    const row = page.getByTestId('credential-row-CRED-0001');
    await expect(row).toBeVisible();
    await expect(row).toContainText('2031-12-30'); // the exact date, byte-for-byte
    await expect(page.getByTestId('credential-status-CRED-0001')).toHaveText('Active');
  });

  await test.step('The person profile shows the credentials section', async () => {
    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('person-credentials')).toBeVisible();
    await expect(page.getByTestId('person-credentials')).toContainText('Coaching License A');
  });

  await test.step('A governed deactivation flips the derived status to Inactive', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-credentials').click();
    await page.getByTestId('deactivate-credential-CRED-0001').click();
    await page.getByTestId('deactivate-credential-CRED-0001-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('deactivate CRED-0001');
    const deactApprovalId = await captureApprovalId(page);

    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, deactApprovalId);
    await page.getByTestId('nav-credentials').click();
    await expect(page.getByTestId('credential-status-CRED-0001')).toHaveText('Inactive');
  });

  await test.step('A read-only identity can read but sees no write affordance', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await page.getByTestId('nav-credentials').click();
    await expect(page.getByTestId('credential-row-CRED-0001')).toBeVisible();
    await expect(page.getByTestId('add-credential-toggle')).toHaveCount(0);
    await expect(page.getByTestId('deactivate-credential-CRED-0001')).toHaveCount(0);
  });
});
