import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for S8 — the MULTI-PERSON PAYOUT path, the most
 * money-sensitive surface on the mission P&L and (before this file) the one
 * with no oracle. settlement.spec only ever drives an org-100% / zero-share
 * distribution; nothing exercised per-person shares, the largest-remainder
 * allocation, mark-paid with a bank LABEL, unpay, or the revoke gate.
 *
 * NAMED zz- TO RUN LAST. The suite shares one accumulating database on a
 * single worker; specs run in file order. This spec is a pure LEAF (nothing
 * reads its records) that MUTATES shared tenant state — people, a mission, a
 * distribution. Running last, it cannot shift the business-id counters
 * (addPerson's PER-0001) or the situation-room state (situationRoom's
 * all-clear) that order-dependent specs downstream rely on. It captures every
 * id it creates dynamically, so it is correct in isolation and in the suite.
 *
 * The money truth this spec pins (domain/distribution.ts): org cut + Σ share
 * amounts == pool, EXACTLY, by largest remainder — no cent lost or invented.
 * The case is the minimal one that catches a naive split: pool USD 100.01,
 * org 10%, two players 50/50. Org floor = USD 10.00, player pool 9001¢, and
 * 50/50 of an ODD pool lands as USD 45.01 + USD 45.00 — equal shares, unequal
 * cents. A naive "/2" would pay 45.00 twice and lose a cent.
 *
 * Assertions are on displayed MONEY via behaviour-frozen testids and the
 * arithmetic relationship (org + Σ shares == pool) — nothing about Tablework
 * DOM shape — so this survives the Wave-2/3 rewrites and any re-skin.
 *
 * The distribute dialog also carries the ONE Selector keyboard path the rest
 * of the suite cannot reach: choosing an option with a real ArrowDown→Enter
 * (every other spec clicks the option). The choose must commit AND leave the
 * dialog open — proving Enter selected the option without pressing the
 * dialog's confirm default.
 */

function isoPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
/** The payout row's USD amount → minor units. Matches the currency-prefixed
 *  amount ("USD 45.01") specifically — the row also carries the share PERCENT
 *  ("50.00%"), which a bare decimal match would grab first. */
function toMinor(rowText: string): number {
  const m = /USD\s+([\d,]+\.\d{2})/.exec(rowText);
  if (!m) throw new Error(`no USD amount in ${JSON.stringify(rowText)}`);
  return Math.round(parseFloat(m[1]!.replace(/,/g, '')) * 100);
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

/** Ops (signed in) submits AddPerson; returns the newly minted APR id. Business
 *  ids accumulate across the shared e2e server, so nothing is hardcoded. */
async function submitAddPerson(page: Page, fullName: string): Promise<string> {
  await page.getByTestId('add-person-toggle').click();
  await page.getByTestId('add-person-fullname').fill(fullName);
  await page.getByTestId('add-person-team').fill('Payouts');
  await page.getByTestId('add-person-submit').click();
  await page.getByTestId('add-person-submit-confirm').click();
  const notice = page.getByTestId('notifications');
  await expect(notice).toContainText(/Submitted APR-\d+/);
  const text = (await notice.textContent()) ?? '';
  const all = [...text.matchAll(/Submitted (APR-\d+)/g)];
  return all[all.length - 1]![1]!;
}

/** Owner (signed in) approves + executes an AddPerson; returns the PER id. */
async function approveExecutePerson(page: Page, aprId: string): Promise<string> {
  await page.goto(`/approvals/${aprId}`);
  await page.getByTestId('begin-review').click();
  await page.getByTestId('approve').click();
  await page.getByTestId('approve-confirm').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('Approved');
  await page.getByTestId('execute').click();
  await page.getByTestId('execute-confirm').click();
  await expect(page.getByTestId('approval-detail-status')).toHaveText('Executed');
  return ((await page.getByTestId('created-person-link').textContent()) ?? '').trim();
}

test.setTimeout(180_000);

test('Distributions: two players, an odd pool, the exact-cent split; mark paid by bank LABEL; the revoke gate', async ({ page }) => {
  let personA = '';
  let personB = '';
  let missionUrl = '';
  let lineId = '';
  let distId = '';

  await test.step('Provision two people through the governed ceremony (self-contained fixture)', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    const aprA = await submitAddPerson(page, 'Payout Player A');
    // Reload to clear the notice stack — otherwise the next submit's id capture
    // could match the first person's lingering "Submitted APR-…" notice.
    await page.goto('/people');
    const aprB = await submitAddPerson(page, 'Payout Player B');
    expect(aprB).not.toBe(aprA);

    await login(page, 'owner@alpha.com', 'owner');
    personA = await approveExecutePerson(page, aprA);
    personB = await approveExecutePerson(page, aprB);
    expect(personA).toMatch(/^PER-\d+$/);
    expect(personB).toMatch(/^PER-\d+$/);
    expect(personA).not.toBe(personB);
  });

  await test.step('A mission with one income line of USD 100.01, driven to Received', async () => {
    await page.getByTestId('nav-missions').click();
    await page.getByTestId('add-mission-toggle').click();
    await page.getByTestId('add-mission-name').fill('Payout Cup');
    await page.getByTestId('add-mission-organizer').fill('VSPN');
    await page.getByTestId('add-mission-starts').fill(isoPlus(-20));
    await page.getByTestId('add-mission-ends').fill(isoPlus(-3));
    await page.getByTestId('add-mission-submit').click();
    await page.getByTestId('add-mission-submit-confirm').click();

    const row = page.locator('[data-testid^="mission-row-"]', { hasText: 'Payout Cup' }).first();
    await row.locator('[data-testid^="mission-link-"]').click();
    await expect(page.getByTestId('mission-title')).toHaveText('Payout Cup');
    missionUrl = page.url();

    await page.getByTestId('add-line').click();
    await page.getByTestId('add-line-direction').click();
    await page.getByRole('option', { name: 'Income', exact: true }).click();
    await page.getByTestId('add-line-category').click();
    await page.getByRole('option', { name: 'Prize money', exact: true }).click();
    await page.getByTestId('add-line-label').fill('Prize — 2nd place');
    await page.getByTestId('add-line-amount').fill('100.01');
    await page.getByTestId('add-line-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('Line added');

    const lineRow = page.locator('[data-testid^="pnl-line-PNL-"]').first();
    lineId = (await lineRow.getAttribute('data-testid'))!.replace('pnl-line-', '');
    await page.getByTestId(`payment-line-${lineId}`).click();
    await page.getByTestId(`payment-status-${lineId}`).click();
    await page.getByRole('option', { name: 'Received', exact: true }).click();
    await page.getByTestId(`payment-source-${lineId}`).fill('ESA');
    await page.getByTestId(`payment-line-${lineId}-confirm`).click();
    await expect(page.getByTestId(`pnl-line-payment-${lineId}`)).toHaveText('Received');
  });

  await test.step('Open Distribute and pick the line by KEYBOARD (ArrowDown→Enter commits, dialog stays open)', async () => {
    await page.getByTestId('distribute-toggle').click();
    const lineSelector = page.getByTestId('distribute-line');
    // Real keys — the exact arrow/Enter choose path no other spec reaches.
    await lineSelector.press('ArrowDown'); // opens the listbox
    await lineSelector.press('Enter'); // chooses the (only) option
    // The choice committed…
    await expect(lineSelector).toContainText('Prize — 2nd place');
    // …AND Enter did NOT press the dialog's confirm default — the sheet is open.
    await expect(page.getByTestId('distribute-toggle-confirm')).toBeVisible();
  });

  await test.step('Add the two players, org 10%, 50/50 — the running sum reaches exactly 100%', async () => {
    // No team on this mission, so the seed is empty; add both players explicitly.
    await page.getByTestId('distribute-add-person').click();
    await page.getByRole('option', { name: new RegExp(personA) }).click();
    await page.getByTestId('distribute-add-person').click();
    await page.getByRole('option', { name: new RegExp(personB) }).click();

    await page.getByTestId('distribute-org-pct').fill('10');
    await page.getByTestId(`distribute-share-${personA}`).fill('50');
    await page.getByTestId(`distribute-share-${personB}`).fill('50');
    await expect(page.getByTestId('distribute-share-sum')).toContainText('100.00%');

    await page.getByTestId('distribute-toggle-confirm').click();
    // Org floor = USD 10.00 (10% of 100.01, floored — the org never rounds up).
    await expect(page.getByTestId('notifications')).toContainText('org USD 10.00 + 2 payout row');

    const card = page.locator('[data-testid^="distribution-DIST-"]').first();
    distId = (await card.getAttribute('data-testid'))!.replace('distribution-', '');
    await expect(card).toContainText('Pool USD 100.01');
  });

  await test.step('THE INVARIANT: equal shares, unequal cents — {45.01, 45.00}, and org + Σ shares == pool EXACTLY', async () => {
    const textA = (await page.getByTestId(`payout-${distId}-${personA}`).textContent()) ?? '';
    const textB = (await page.getByTestId(`payout-${distId}-${personB}`).textContent()) ?? '';
    const aMinor = toMinor(textA);
    const bMinor = toMinor(textB);

    // The largest-remainder split: one player 4501, the other 4500 (the spare
    // cent by the deterministic tie-break). Asserted as a SET — the fixture's
    // id assignment, not the allocator, decides which player wins the tie.
    expect([aMinor, bMinor].sort((x, y) => x - y)).toEqual([4500, 4501]);

    // org cut (1000) + both shares == the pool (10001), to the cent.
    const orgMinor = 1000;
    expect(orgMinor + aMinor + bMinor).toBe(10001);
  });

  await test.step('Mark one payout Paid by bank LABEL only — and there is NO field to enter an account number', async () => {
    await page.getByTestId(`pay-${distId}-${personA}`).click();
    // The standing bank-data law, pinned by the ABSENCE of the means to break it:
    // no FORM FIELD asks for an account/IBAN number (the dialog's prose may
    // reassure "never account numbers" — that's honesty, not a field, so this
    // targets labelled inputs via getByLabel, not page text).
    const payDialog = page.locator('dialog[open]');
    await expect(payDialog.getByLabel(/account\s*(number|no)|IBAN/i)).toHaveCount(0);
    // The label is REQUIRED: confirm is disabled until it carries a value.
    await expect(page.getByTestId(`pay-${distId}-${personA}-confirm`)).toBeDisabled();
    await page.getByTestId(`pay-label-${distId}-${personA}`).fill('ESA');
    await expect(page.getByTestId(`pay-${distId}-${personA}-confirm`)).toBeEnabled();
    await page.getByTestId(`pay-${distId}-${personA}-confirm`).click();

    await expect(page.getByTestId(`payout-status-${distId}-${personA}`)).toHaveText('Paid');
    await expect(page.getByTestId(`payout-${distId}-${personA}`)).toContainText('ESA');
  });

  await test.step('The revoke gate: revoke is OFFERED only while every payout is Pending', async () => {
    // With one payout Paid, the revoke control does not exist — the law made
    // unreachable, not merely refused on click.
    await expect(page.getByTestId(`revoke-${distId}`)).toHaveCount(0);

    // Unmark (an audited correction) → all pending again → revoke returns.
    await page.getByTestId(`unpay-${distId}-${personA}`).click();
    await page.getByTestId(`unpay-${distId}-${personA}-confirm`).click();
    await expect(page.getByTestId(`payout-status-${distId}-${personA}`)).toHaveText('Pending');
    await expect(page.getByTestId(`revoke-${distId}`)).toBeVisible();
  });

  await test.step('Revoke with a recorded reason frees the line', async () => {
    await page.getByTestId(`revoke-${distId}`).click();
    await page.getByTestId(`revoke-reason-${distId}`).fill('Corrected split — reissuing');
    await page.getByTestId(`revoke-${distId}-confirm`).click();
    await expect(page.getByTestId(`distribution-status-${distId}`)).toHaveText('Revoked');
    expect(page.url()).toBe(missionUrl);
  });
});
