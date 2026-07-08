import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for Sprint 42: the person page as the operational hub
 * (in-context governed actions, deep sections) + withdraw-my-request (the S41
 * single-owner-wedge remedy) + the agreement edit-dialog link field. Runs
 * LAST on the shared stack (PER-0001 and AGR-0001/0002 exist).
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

async function captureApprovalId(page: Page): Promise<string> {
  const all = (await page.getByTestId('notifications').textContent())?.match(/APR-\d{4,}/g);
  expect(all?.length).toBeTruthy();
  return all![all!.length - 1]!;
}

async function ownerExecutes(page: Page, approvalId: string): Promise<void> {
  await page.goto(`/approvals/${approvalId}`);
  await page.getByTestId('begin-review').click();
  await page.getByTestId('approve').click();
  await page.getByTestId('approve-confirm').click();
  await page.getByTestId('execute').click();
  await page.getByTestId('execute-confirm').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('Executed');
}

test('Person hub + withdraw-my-request, end to end', async ({ page }) => {
  let missionApr = '';
  let hubAgreementApr = '';

  await test.step('Ops adds PER-0001 to a mission FROM the person page (pre-filled)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    // A fresh active mission (the missions spec retired MSN-0001).
    await page.getByTestId('nav-missions').click();
    await page.getByTestId('add-mission-toggle').click();
    await page.getByTestId('add-mission-name').fill('Hub Mission');
    await page.getByTestId('add-mission-starts').fill('2026-09-01');
    await page.getByTestId('add-mission-submit').click();
    await page.getByTestId('add-mission-submit-confirm').click();
    await expect(page.getByTestId('mission-row-MSN-0002')).toBeVisible();

    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('person-actions')).toBeVisible();
    await page.getByTestId('person-add-to-mission').click();
    await page.getByTestId('person-mission-pick').click();
    await page.getByRole('option', { name: /Hub Mission/ }).click();
    await page.getByTestId('person-mission-role').fill('Analyst');
    await page.getByTestId('person-add-to-mission-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('Nothing changes until an owner executes');
    missionApr = await captureApprovalId(page);
  });

  await test.step('Withdraw-my-request: the submitter cancels their own agreement request; the guard bars everyone else', async () => {
    await page.getByTestId('person-add-agreement').click();
    await page.getByTestId('person-agreement-type').fill('Side Letter');
    await page.getByTestId('person-agreement-starts').fill('2026-09-01');
    await page.getByTestId('person-agreement-ends').fill('2027-09-01');
    await page.getByTestId('person-add-agreement-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('agreement for PER-0001');
    const withdrawApr = await captureApprovalId(page);

    // The submitter sees and uses Withdraw.
    await page.goto(`/approvals/${withdrawApr}`);
    await page.getByTestId('withdraw').click();
    await page.getByTestId('withdraw-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Withdrawn');
    await expect(page.getByTestId('withdraw')).toHaveCount(0); // terminal: gone

    // A reviewer does NOT get the affordance on someone else's open request.
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto(`/approvals/${missionApr}`);
    await expect(page.getByTestId('begin-review')).toBeVisible();
    await expect(page.getByTestId('withdraw')).toHaveCount(0);
  });

  await test.step('Owner executes the mission add; the hub sections show the connected picture', async () => {
    await ownerExecutes(page, missionApr);
    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('person-missions')).toContainText('Hub Mission');
    await expect(page.getByTestId('person-missions')).toContainText('Analyst');
    await expect(page.getByTestId('person-agreements')).toBeVisible(); // AGR rows from the agreements spec
    await expect(page.getByTestId('person-approvals')).toContainText('Withdrawn'); // the withdrawn request, honestly listed
  });

  await test.step('The agreement edit dialog now links a parent (the S41 UI item)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people/PER-0001');
    await page.getByTestId('person-add-agreement').click();
    await page.getByTestId('person-agreement-type').fill('Hub Contract');
    await page.getByTestId('person-agreement-starts').fill('2026-09-01');
    await page.getByTestId('person-agreement-ends').fill('2027-09-01');
    await page.getByTestId('person-add-agreement-confirm').click();
    hubAgreementApr = await captureApprovalId(page);
    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, hubAgreementApr);

    // The new agreement is on the person; open it and link it to AGR-0001.
    await page.goto('/people/PER-0001');
    const newRow = page.getByTestId('person-agreements').getByText('Hub Contract');
    await expect(newRow).toBeVisible();
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/agreements');
    const hubAgreementId = ((await page.getByTestId('agreements-table').textContent())?.match(/AGR-\d{4,}/g) ?? []).pop()!;
    await page.goto(`/agreements/${hubAgreementId}`);
    await page.getByTestId(`edit-agreement-${hubAgreementId}`).click();
    await page.getByTestId(`edit-agreement-link-${hubAgreementId}`).click();
    await page.getByRole('option', { name: /AGR-0001/ }).click();
    await page.getByTestId(`edit-agreement-${hubAgreementId}-confirm`).click();
    await expect(page.getByTestId('notifications')).toContainText('updated and recorded');
    await expect(page.getByTestId('agreement-parent-link')).toHaveText('AGR-0001');
  });
});
