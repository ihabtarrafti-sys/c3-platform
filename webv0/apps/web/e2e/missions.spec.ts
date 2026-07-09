import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for the Missions capstone (Sprint 39). Runs last on the
 * shared stack (PER-0001 "Jordan Reyes" exists from addPerson.spec).
 *
 * Flow: direct-audited shell create → governed roster add (ops requests,
 * owner executes) with BOTH duplicate refusals witnessed in the browser
 * (pending: second submit refused while the first is open; active: refused
 * once the pair is live) → governed removal → re-add REACTIVATES the same
 * membership row (one row, new role) → shell edit + deactivate retire the
 * affordances honestly → read-only role sees everything, touches nothing.
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
  // Notices accumulate within a session; the NEWEST (last) APR is the one
  // this step just created.
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

async function submitAddParticipant(page: Page, role: string): Promise<string> {
  await page.getByTestId('add-participant-person').click();
  await page.getByRole('option', { name: /Jordan Reyes/ }).click();
  await page.getByTestId('add-participant-role').fill(role);
  await page.getByTestId('add-participant-submit').click();
  await page.getByTestId('add-participant-submit-confirm').click();
  await expect(page.getByTestId('notifications')).toContainText('The roster is unchanged');
  return captureApprovalId(page);
}

test('Missions capstone workflow, end to end', async ({ page }) => {
  // Finance S4 adds a full P&L walk (lines CRUD + blended profit) on top of the
  // governed roster round-trips — triple the budget rather than thin the proof.
  test.slow();
  let addApr = '';

  await test.step('Ops creates the mission shell (immediate, recorded) and opens its page', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-missions').click();
    await expect(page.getByTestId('missions-empty')).toBeVisible();

    await page.getByTestId('add-mission-toggle').click();
    await page.getByTestId('add-mission-name').fill('Spring Invitational');
    await page.getByTestId('add-mission-game').fill('VALORANT');
    await page.getByTestId('add-mission-starts').fill('2026-08-01');
    await page.getByTestId('add-mission-submit').click();
    await page.getByTestId('add-mission-submit-confirm').click();

    await expect(page.getByTestId('mission-row-MSN-0001')).toBeVisible();
    await expect(page.getByTestId('mission-status-MSN-0001')).toHaveText('Active');
    await page.getByTestId('mission-link-MSN-0001').click();
    await expect(page.getByTestId('mission-title')).toHaveText('Spring Invitational');
    await expect(page.getByTestId('participants-empty')).toBeVisible();
  });

  await test.step('Governed add: submitted, then the duplicate-PENDING guard refuses a second request', async () => {
    addApr = await submitAddParticipant(page, 'Player');
    expect(addApr).toBeTruthy();

    // Second request for the same pair while the first is open: refused at
    // the door, roster untouched.
    await page.getByTestId('add-participant-person').click();
    await page.getByRole('option', { name: /Jordan Reyes/ }).click();
    await page.getByTestId('add-participant-role').fill('Coach');
    await page.getByTestId('add-participant-submit').click();
    await page.getByTestId('add-participant-submit-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('open approval already exists');
    await page.getByRole('button', { name: 'Cancel' }).click(); // refused dialog stays open — dismiss
    await expect(page.getByTestId('participants-empty')).toBeVisible();
  });

  await test.step('Owner executes: the participant lands with the person name; duplicate-ACTIVE now refused', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, addApr);

    await page.goto('/missions/MSN-0001');
    await expect(page.getByTestId('participant-row-PER-0001')).toBeVisible();
    await expect(page.getByTestId('participant-row-PER-0001')).toContainText('Jordan Reyes');
    await expect(page.getByTestId('participant-status-PER-0001')).toHaveText('Active');

    // The duplicate-ACTIVE guard refuses a fresh request for the live pair.
    await page.getByTestId('add-participant-person').click();
    await page.getByRole('option', { name: /Jordan Reyes/ }).click();
    await page.getByTestId('add-participant-role').fill('Player');
    await page.getByTestId('add-participant-submit').click();
    await page.getByTestId('add-participant-submit-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('already an active participant');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('A per-diem daily rate is set on the participant (direct-audited, financial-gated)', async () => {
    await expect(page.getByTestId('participant-perdiem-PER-0001')).toHaveText('—'); // none yet
    await page.getByTestId('perdiem-participant-PER-0001').click();
    await page.getByTestId('perdiem-amount-PER-0001').fill('250');
    await page.getByTestId('perdiem-currency-PER-0001').click();
    await page.getByRole('option', { name: 'SAR', exact: true }).click();
    await page.getByTestId('perdiem-participant-PER-0001-confirm').click();
    await expect(page.getByTestId('participant-perdiem-PER-0001')).toContainText('SAR 250.00/day');
  });

  await test.step('Governed removal, then re-adding REACTIVATES the same membership (one row, new role)', async () => {
    // Requester ≠ approver: ops submits each change, the owner executes it.
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/missions/MSN-0001');
    await page.getByTestId('remove-participant-PER-0001').click();
    await page.getByTestId('remove-participant-PER-0001-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('The roster is unchanged'); // wait for the notice before capturing
    const removalApr = await captureApprovalId(page);
    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, removalApr);

    await page.goto('/missions/MSN-0001');
    await expect(page.getByTestId('participant-status-PER-0001')).toHaveText('Removed');
    await expect(page.getByTestId('remove-participant-PER-0001')).toHaveCount(0); // removed rows offer nothing

    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/missions/MSN-0001');
    const readdApr = await submitAddParticipant(page, 'Coach');
    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, readdApr);
    await page.goto('/missions/MSN-0001');
    await expect(page.getByTestId('participant-status-PER-0001')).toHaveText('Active');
    await expect(page.getByTestId('participant-row-PER-0001')).toContainText('Coach');
    // ONE row for the pair across the whole lifecycle.
    await expect(page.getByTestId('participants-table').locator('tbody tr')).toHaveCount(1);
  });

  await test.step('P&L: income and expense lines with an HONEST blend — per-diem excluded while open-ended', async () => {
    // Owner is on MSN-0001 (still no end date). The roster's SAR per-diem shows
    // as a daily rate only, and the panel says why totals exclude it.
    await expect(page.getByTestId('mission-pnl-panel')).toBeVisible();
    await expect(page.getByTestId('pnl-perdiem-PER-0001')).toContainText('SAR 250.00/day');
    await expect(page.getByTestId('pnl-open-ended-note')).toBeVisible();

    // Income: prize money. Expense: flights. Both USD — the blend is complete.
    await page.getByTestId('add-line').click();
    await page.getByTestId('add-line-label').fill('Prize — 2nd place');
    await page.getByTestId('add-line-amount').fill('10000');
    await page.getByTestId('add-line-confirm').click();
    await expect(page.getByTestId('pnl-line-amount-PNL-0001')).toHaveText('USD 10,000.00');

    await page.getByTestId('add-line').click();
    await page.getByTestId('add-line-direction').click();
    await page.getByRole('option', { name: 'Expense', exact: true }).click();
    await page.getByTestId('add-line-label').fill('Flights');
    await page.getByTestId('add-line-amount').fill('2000');
    await page.getByTestId('add-line-confirm').click();
    await expect(page.getByTestId('pnl-line-amount-PNL-0002')).toHaveText('USD 2,000.00');
    await expect(page.getByTestId('pnl-profit-usd')).toHaveText('Profit ≈ USD 8,000.00');

    // Edit the expense (versioned, immediate) — the profit follows.
    await page.getByTestId('edit-line-PNL-0002').click();
    await page.getByTestId('edit-line-PNL-0002-amount').fill('2500');
    await page.getByTestId('edit-line-PNL-0002-confirm').click();
    await expect(page.getByTestId('pnl-profit-usd')).toHaveText('Profit ≈ USD 7,500.00');

    // Remove it — the line disappears from the P&L.
    await page.getByTestId('remove-line-PNL-0002').click();
    await page.getByTestId('remove-line-PNL-0002-confirm').click();
    await expect(page.getByTestId('pnl-line-PNL-0002')).toHaveCount(0);
    await expect(page.getByTestId('pnl-profit-usd')).toHaveText('Profit ≈ USD 10,000.00');
  });

  await test.step('Shell edit is versioned and immediate; deactivation retires the affordances', async () => {
    await page.getByTestId('edit-mission-MSN-0001').click();
    await page.getByTestId('edit-mission-ends-MSN-0001').fill('2026-08-15');
    await page.getByTestId('edit-mission-MSN-0001-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('MSN-0001 updated');

    await page.getByTestId('deactivate-mission-MSN-0001').click();
    await page.getByTestId('deactivate-mission-MSN-0001-confirm').click();
    await expect(page.getByTestId('mission-status')).toHaveText('Inactive');
    await expect(page.getByTestId('edit-mission-MSN-0001')).toHaveCount(0); // retired shells offer nothing
    await expect(page.getByTestId('add-participant-submit')).toHaveCount(0); // no additions to a retired mission

    // The P&L stays READABLE on the retired shell — and with the end date set,
    // the SAR per-diem total is now computable but has no stored rate: the
    // blend is honestly withheld and the culprit named (never invented).
    await expect(page.getByTestId('pnl-perdiem-PER-0001')).toContainText('× 15d = SAR 3,750.00');
    await expect(page.getByTestId('pnl-missing-rates')).toContainText('SAR');
    await expect(page.getByTestId('add-line')).toHaveCount(0); // frozen record: no new lines
  });

  await test.step('A read-only identity sees the register and the roster with zero affordances — and NO money', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await page.getByTestId('nav-missions').click();
    await expect(page.getByTestId('mission-row-MSN-0001')).toBeVisible();
    await page.getByTestId('mission-link-MSN-0001').click();
    await expect(page.getByTestId('participant-row-PER-0001')).toBeVisible();
    await expect(page.getByTestId('add-participant-submit')).toHaveCount(0);
    await expect(page.getByTestId('remove-participant-PER-0001')).toHaveCount(0);
    await expect(page.getByTestId('edit-mission-MSN-0001')).toHaveCount(0);
    await expect(page.getByTestId('mission-pnl-panel')).toHaveCount(0); // P&L absent for canViewFinancials-denied roles
  });
});
