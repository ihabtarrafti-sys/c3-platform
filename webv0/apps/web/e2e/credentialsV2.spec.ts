import { test, expect, type Page } from '@playwright/test';

/**
 * S12, end to end over the suite's real state: a governed credential FACTS
 * change on CRED-0001 (created by credentials.spec) carrying a document
 * number, decided from the approval page whose ProposedChange panel shows the
 * number to the owner; then the governed beneficiary lifecycle on PER-0001
 * (request → execute → visible in the registry) and the bank-form download.
 *
 * Suite position: after credentials, before delegation. Footprint: CRED-0001
 * gains facts (later specs don't assert its facts), one beneficiary row, and
 * their approvals — pure history.
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

const aprFrom = async (page: Page): Promise<string> => {
  const note = page.getByTestId('notifications');
  await expect(note).toContainText('Submitted APR-');
  const id = /APR-\d+/.exec(await note.innerText())?.[0];
  expect(id).toBeTruthy();
  return id!;
};

async function decideAndExecute(page: Page, approvalId: string): Promise<void> {
  await page.goto(`/approvals/${approvalId}`);
  await page.getByTestId('begin-review').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('In review');
  await page.getByTestId('approve').click();
  await page.getByTestId('approve-confirm').click();
  await page.getByTestId('execute').click();
  await page.getByTestId('execute-confirm').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('Executed');
}

test('credentials v2 + beneficiaries: governed facts with PII, registry lifecycle, bank form', async ({ page }) => {
  await test.step('a fresh ACTIVE credential is created (CRED-0001 ended the last spec inactive)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people/PER-0001');
    await page.getByTestId('person-add-credential').click();
    await page.getByTestId('person-cred-type').fill('Passport');
    await page.getByTestId('person-cred-issued').fill('2024-01-01');
    await page.getByTestId('person-cred-expires').fill('2034-01-01');
    await page.getByTestId('person-add-credential-confirm').click();
    const addApproval = await aprFrom(page);
    await login(page, 'owner@alpha.com', 'owner');
    await decideAndExecute(page, addApproval);
  });

  const approvalId = await test.step('ops requests a facts change on the new credential with a document number', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people/PER-0001');
    await page.getByTestId('cred-facts-CRED-0002').click();
    await page.getByTestId('cred-facts-kind').fill('Passport');
    await page.getByTestId('cred-facts-number').fill('X98765AB');
    await page.getByTestId('cred-facts-country').fill('Philippines');
    await page.getByTestId('cred-facts-CRED-0002-confirm').click();
    return aprFrom(page);
  });

  await test.step('the owner sees the DECISIVE VALUES (incl. the number) and executes', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto(`/approvals/${approvalId}`);
    const panel = page.getByTestId('proposed-change');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('X98765AB'); // owner holds PII standing
    await expect(panel).toContainText('Philippines');
    await decideAndExecute(page, approvalId);
  });

  const benApproval = await test.step('ops requests a beneficiary — labels and banks only', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('beneficiary-section')).toBeVisible();
    await page.getByTestId('beneficiary-add').click();
    await page.getByTestId('beneficiary-label').fill('ESA main');
    await page.getByTestId('beneficiary-currency').fill('AED');
    await page.getByTestId('beneficiary-bank').fill('Emirates Islamic');
    await page.getByTestId('beneficiary-country').fill('UAE');
    await page.getByTestId('beneficiary-add-confirm').click();
    return aprFrom(page);
  });

  await test.step('owner executes; the registry shows the Draft route; the bank form downloads', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await decideAndExecute(page, benApproval);
    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('beneficiary-row-BEN-0001')).toBeVisible();
    await expect(page.getByTestId('beneficiary-row-BEN-0001')).toContainText('ESA main');
    await expect(page.getByTestId('beneficiary-row-BEN-0001')).toContainText('Draft');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('beneficiary-bank-form').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('bank-registration-PER-0001');
  });

  await test.step('the finance role sees the registry but NOT the credential document number', async () => {
    await login(page, 'finance@alpha.com', 'finance');
    await page.goto('/people/PER-0001');
    // registry visible (finance standing)
    await expect(page.getByTestId('beneficiary-section')).toBeVisible();
    // the PII block (S11) stays structurally absent for finance
    await expect(page.getByTestId('person-pii-block')).toHaveCount(0);
  });
});
