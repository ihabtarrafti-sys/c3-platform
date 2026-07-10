import { test, expect, type Page } from '@playwright/test';

/**
 * Tier 0.5 approver delegation, end to end: the owner grants hr review+
 * execute standing for a window (Settings), the cockpit shows the elevated
 * authority, the delegate decides ANOTHER member's request (a REJECT — no
 * side effects land), and revocation removes the standing immediately.
 * Also proves the backup tile answers honestly when unconfigured.
 *
 * Suite position: after credentials, before entities. Footprint: one
 * Rejected approval + one Revoked delegation — both pure history; hr ends
 * the spec exactly as it started (no standing).
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

const iso = (d: Date) => d.toISOString().slice(0, 10);

test('approver delegation: grant → delegate decides → revoke', async ({ page }) => {
  const today = iso(new Date());
  const nextWeek = iso(new Date(Date.now() + 7 * 86_400_000));

  await test.step('Owner grants hr a delegation window in Settings', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto('/settings');
    await expect(page.getByTestId('delegation-panel')).toBeVisible();
    // the backup tile answers honestly in this unconfigured environment
    await expect(page.getByTestId('backup-status-panel')).toContainText('Not configured');

    await page.getByTestId('delegation-grantee').click();
    await page.getByRole('option', { name: /hr@alpha\.com/ }).click();
    await page.getByTestId('delegation-starts').fill(today);
    await page.getByTestId('delegation-ends').fill(nextWeek);
    await page.getByTestId('delegation-reason').fill('Owner travelling — E2E');
    await page.getByTestId('delegation-grant').click();
    await expect(page.getByTestId('delegation-row-DLG-0001')).toBeVisible();
    await expect(page.getByTestId('delegation-state-DLG-0001')).toHaveText('Active');
  });

  await test.step('The cockpit shows the elevated authority for its whole life', async () => {
    await page.goto('/situation');
    await expect(page.getByTestId('situation-checks')).toContainText('Delegation active');
  });

  const approvalId = await test.step('Ops submits a request for the delegate to decide', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/people');
    await page.getByTestId('add-person-toggle').click();
    await page.getByTestId('add-person-fullname').fill('Delegation Probe');
    await page.getByTestId('add-person-submit').click();
    await page.getByTestId('add-person-submit-confirm').click();
    const note = page.getByTestId('notifications');
    await expect(note).toContainText('Submitted APR-');
    const text = await note.innerText();
    const id = /APR-\d+/.exec(text)?.[0];
    expect(id).toBeTruthy();
    return id!;
  });

  await test.step('hr (the delegate) reviews and REJECTS — no side effects', async () => {
    await login(page, 'hr@alpha.com', 'hr');
    // the register is open to the delegate
    await page.goto(`/approvals/${approvalId}`);
    await page.getByTestId('begin-review').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('In review');
    await page.getByTestId('reject').click();
    await page.getByTestId('reject-reason').fill('Not needed — delegation E2E probe');
    await page.getByTestId('reject-confirm').click();
    await expect(page.getByTestId('approval-detail-status')).toHaveText('Rejected');
  });

  await test.step('Owner revokes; hr loses the standing immediately', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto('/settings');
    await page.getByTestId('delegation-revoke-DLG-0001').click();
    await page.getByTestId('delegation-revoke-reason').fill('Back — E2E complete');
    await page.getByTestId('delegation-revoke-confirm').click();
    await expect(page.getByTestId('delegation-state-DLG-0001')).toHaveText('Revoked');

    await login(page, 'hr@alpha.com', 'hr');
    // the approvals surface is closed again — the register page itself refuses
    // (the nav link is deliberately ungated; the PAGE is the truth surface)
    await page.goto('/approvals');
    await expect(page.getByTestId('approvals-denied')).toBeVisible();
  });
});
