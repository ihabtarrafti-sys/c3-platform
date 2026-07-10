import { test, expect, type Page } from '@playwright/test';

/**
 * S10 notifications — the bell over real state this suite already produced:
 * earlier specs ran approvals with ops submitting and owner deciding, so the
 * OWNER holds unread "awaits review" rows and OPS holds unread transition
 * rows (APR-0001 reached Executed in addPerson.spec). This spec only READS
 * and ACKNOWLEDGES (rows are never deleted; acks affect no later spec).
 *
 * NOTE: the suite provisions members at FIRST LOGIN, so the very first
 * submission (APR-0001) fanned out before the owner existed — the owner's
 * oldest rows start at the first approval submitted AFTER their first login.
 * The spec therefore self-derives which "awaits review" row to exercise
 * instead of hardcoding APR-0001 on the owner side.
 *
 * Suite position: after missions, before personHub — creates nothing.
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

test('notification bell: pipeline rows, ack semantics, mark-all-read', async ({ page }) => {
  await test.step('Owner has unread submission rows; the badge says so', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await expect(page.getByTestId('notif-bell')).toBeVisible();
    await expect(page.getByTestId('notif-badge')).toBeVisible();
  });

  const { before, signalKey } = await test.step('The inbox lists an approval awaiting review, unread', async () => {
    const count = parseInt(await page.getByTestId('notif-badge').innerText(), 10);
    expect(count).toBeGreaterThanOrEqual(1);
    await page.getByTestId('notif-bell').click();
    const row = page.getByTestId('notif-item').filter({ hasText: 'awaits review' }).first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-read', 'false');
    const key = await row.getAttribute('data-signal-key');
    expect(key).toMatch(/^APR-\d+:Submitted$/);
    return { before: count, signalKey: key! };
  });

  await test.step('Clicking a row acknowledges it and navigates to the approval', async () => {
    const approvalId = signalKey.split(':')[0];
    await page.locator(`[data-signal-key="${signalKey}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/approvals/${approvalId}$`));
    await expect(page.getByTestId('approval-detail-status')).toBeVisible();
    // the ack landed: count dropped by exactly one (or the badge vanished at 0)
    if (before > 1) {
      await expect(page.getByTestId('notif-badge')).toHaveText(String(before - 1));
    } else {
      await expect(page.getByTestId('notif-badge')).toHaveCount(0);
    }
    // the row remains — read, never deleted
    await page.getByTestId('notif-bell').click();
    await expect(page.locator(`[data-signal-key="${signalKey}"]`)).toHaveAttribute('data-read', 'true');
    await page.keyboard.press('Escape');
  });

  await test.step('Mark all read clears the badge; rows stay', async () => {
    if (before > 1) {
      await page.getByTestId('notif-bell').click();
      await page.getByTestId('notif-mark-all').click();
      await expect(page.getByTestId('notif-badge')).toHaveCount(0);
      await expect(page.locator(`[data-signal-key="${signalKey}"]`)).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });

  await test.step('Ops (the requester) holds the decision narration for APR-0001', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await expect(page.getByTestId('notif-badge')).toBeVisible();
    await page.getByTestId('notif-bell').click();
    const executed = page.locator('[data-signal-key="APR-0001:Executed"]');
    await expect(executed).toBeVisible();
    await expect(executed).toContainText('APR-0001 is now Executed');
    // ops' inbox was untouched by the owner's acknowledgements
    await expect(executed).toHaveAttribute('data-read', 'false');
  });
});
