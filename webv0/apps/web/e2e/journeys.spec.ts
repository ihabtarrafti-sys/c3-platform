import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for the Journeys workflow (Sprint 37). Runs after
 * addPerson/credentials specs on the same stack (PER-0001 exists); approval
 * ids captured from the UI.
 *
 * Flow: governed initiation (ops requests → owner executes → born Active) →
 * DIRECT-audited transitions with honest immediacy (suspend → resume →
 * complete stamps the end date) → a second journey cancelled with a mandatory
 * reason → person profile shows the journeys section → read-only role sees no
 * lifecycle affordances.
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
  const match = (await page.getByTestId('notifications').textContent())?.match(/APR-\d{4,}/);
  expect(match).toBeTruthy();
  return match![0];
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

async function initiateAsOps(page: Page, journeyType: string): Promise<string> {
  await page.getByTestId('nav-journeys').click();
  await page.getByTestId('initiate-journey-toggle').click();
  await page.getByTestId('initiate-journey-person').click();
  await page.getByRole('option', { name: /Jordan Reyes/ }).click();
  await page.getByTestId('initiate-journey-type').fill(journeyType);
  await page.getByTestId('initiate-journey-started').fill('2026-07-01');
  await page.getByTestId('initiate-journey-submit').click();
  await page.getByTestId('initiate-journey-submit-confirm').click();
  await expect(page.getByTestId('notifications')).toContainText('The journey is not initiated');
  return captureApprovalId(page);
}

test('Journeys lifecycle workflow, end to end', async ({ page }) => {
  await test.step('Governed initiation: ops requests, owner executes, journey born Active', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    const apr = await initiateAsOps(page, 'Pro Contract Onboarding');

    await login(page, 'owner@alpha.com', 'owner');
    await page.goto(`/approvals/${apr}`);
    await expect(page.getByTestId('approval-journey-subject')).toHaveText('Pro Contract Onboarding for PER-0001');
    await ownerExecutes(page, apr);

    await page.getByTestId('nav-journeys').click();
    await expect(page.getByTestId('journey-row-JRN-0001')).toBeVisible();
    await expect(page.getByTestId('journey-status-JRN-0001')).toHaveText('Active');
  });

  await test.step('Direct transitions: suspend → resume → complete (end date stamped)', async () => {
    await page.getByTestId('transition-suspend-JRN-0001').click();
    await page.getByTestId('transition-suspend-JRN-0001-confirm').click();
    await expect(page.getByTestId('journey-status-JRN-0001')).toHaveText('Suspended');

    await page.getByTestId('transition-resume-JRN-0001').click();
    await page.getByTestId('transition-resume-JRN-0001-confirm').click();
    await expect(page.getByTestId('journey-status-JRN-0001')).toHaveText('Active');

    await page.getByTestId('transition-complete-JRN-0001').click();
    await page.getByTestId('transition-complete-JRN-0001-confirm').click();
    await expect(page.getByTestId('journey-status-JRN-0001')).toHaveText('Completed');
    await expect(page.getByTestId('journey-row-JRN-0001')).toContainText(/\d{4}-\d{2}-\d{2}/); // ended date visible
    // Terminal: no lifecycle buttons remain on the row.
    await expect(page.getByTestId('transition-suspend-JRN-0001')).toHaveCount(0);
  });

  await test.step('A second journey is cancelled with a mandatory, recorded reason', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    const apr = await initiateAsOps(page, 'Trial Period');
    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, apr);

    await page.getByTestId('nav-journeys').click();
    await page.getByTestId('transition-cancel-JRN-0002').click();
    // Confirm is disabled until a reason is typed.
    await expect(page.getByTestId('transition-cancel-JRN-0002-confirm')).toBeDisabled();
    await page.getByTestId('cancel-reason-JRN-0002').fill('Trial ended early');
    await page.getByTestId('transition-cancel-JRN-0002-confirm').click();
    await expect(page.getByTestId('journey-status-JRN-0002')).toHaveText('Cancelled');
  });

  await test.step('The person profile shows the journeys section', async () => {
    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('person-journeys')).toBeVisible();
    await expect(page.getByTestId('person-journeys')).toContainText('Pro Contract Onboarding');
  });

  await test.step('A read-only identity sees the register but no lifecycle affordances', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await page.getByTestId('nav-journeys').click();
    await expect(page.getByTestId('journey-row-JRN-0001')).toBeVisible();
    await expect(page.getByTestId('initiate-journey-toggle')).toHaveCount(0);
    await expect(page.getByTestId('transition-cancel-JRN-0002')).toHaveCount(0);
  });
});
