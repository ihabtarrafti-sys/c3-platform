import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for the Situation Room (Sprint 43). Runs LAST on the
 * shared stack: by this point every prior spec has resolved its own state, so
 * the cockpit opens ALL CLEAR — the honest zero-state — and then this spec
 * manufactures a real cross-domain story and watches the cockpit tell it.
 */

function isoPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

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

// This spec does more end-to-end work than any other (wedge resolution plus
// two full governed chains across four logins): give it double the budget.
test.setTimeout(120_000);

test('Situation Room: the honest all-clear, then a cross-domain story with its fix', async ({ page }) => {
  await test.step('The sentinel catches the stack’s REAL leftover wedge; withdrawing it yields the honest all-clear', async () => {
    // The members spec leaves an owner-submitted approval open, and the
    // provisioned directory has exactly one owner — a genuine governance
    // wedge. The cockpit must surface it, and the remedy must resolve it.
    await login(page, 'owner@alpha.com', 'owner');
    await page.getByTestId('nav-situation').click();
    await expect(page.getByTestId('situation-signals')).toContainText('Governance wedge');
    await expect(page.getByTestId('situation-signals')).toContainText("its submitter is the organization's only owner");

    await page.getByRole('button', { name: 'Withdraw or resolve →' }).first().click();
    await page.getByTestId('withdraw').click();
    await page.getByTestId('withdraw-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Withdrawn');

    await page.getByTestId('nav-situation').click();
    await expect(page.getByTestId('situation-all-clear')).toBeVisible();
    await expect(page.getByTestId('situation-checks')).toContainText('wedge');
    await expect(page.getByTestId('situation-checks')).toContainText('Mission readiness');
  });

  await test.step('A soon-expiring credential on an active roster becomes an IMMEDIATE story card', async () => {
    // PER-0001 sits on the active roster of MSN-0002 (from the hub spec).
    // Give them a credential that expires before that mission window closes.
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people/PER-0001');
    await page.getByTestId('person-add-credential').click();
    await page.getByTestId('person-cred-type').fill('Signal License');
    await page.getByTestId('person-cred-issued').fill(isoPlus(-30));
    // Expires in 5 days — inside the ≤7-day urgency band, before the mission.
    await page.getByTestId('person-cred-expires').fill(isoPlus(5));
    await page.getByTestId('person-add-credential-confirm').click();
    const apr = await captureApprovalId(page);
    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, apr);

    await page.getByTestId('nav-situation').click();
    const signals = page.getByTestId('situation-signals');
    await expect(signals).toContainText('Signal License expires in 5 days');
    await expect(signals).toContainText('is on the active roster of MSN-0002');
    await expect(signals).toContainText('No replacement request is pending');
    await expect(signals).toContainText('impact 3 × urgency 3');
  });

  await test.step('The card’s primary action leads to the fix; a pending fix demotes the story to IN MOTION', async () => {
    // Clear the stacked notices from the governed chain first — they can
    // intercept pointer events over the first card's actions.
    while (await page.getByRole('button', { name: 'Dismiss' }).count()) {
      await page.getByRole('button', { name: 'Dismiss' }).first().click();
    }
    const credentialCard = page.locator('[data-testid^="signal-action-CredentialExpiry"]').first();
    await credentialCard.scrollIntoViewIfNeeded();
    await credentialCard.click();
    await expect(page.getByTestId('person-actions')).toBeVisible(); // landed on the hub, dialogs ready

    // Submit the replacement (as owner it would wedge — so as ops).
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people/PER-0001');
    await page.getByTestId('person-add-credential').click();
    await page.getByTestId('person-cred-type').fill('Signal License (renewed)');
    await page.getByTestId('person-cred-issued').fill(isoPlus(0));
    await page.getByTestId('person-cred-expires').fill(isoPlus(365));
    await page.getByTestId('person-add-credential-confirm').click();
    await captureApprovalId(page);

    await page.getByTestId('nav-situation').click();
    await expect(page.getByTestId('situation-signals')).toContainText('In motion');
    await expect(page.getByTestId('situation-signals')).toContainText('A replacement credential request is already pending');
  });

  await test.step('The cockpit is an operational surface: the visitor has no nav and a fail-closed page', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-situation')).toHaveCount(0);
    await page.goto('/situation');
    await expect(page.getByTestId('situation-denied')).toBeVisible();
  });
});
