import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for S6 invoices: an income line on a post-mission
 * P&L becomes real paper — per-entity series number, VAT, stored PDF — the
 * line flips to Invoiced, the Situation Room chases the payment by number,
 * voiding (reason recorded) frees the line and never reuses the number, and
 * the money finishing its journey settles the mission (leaving the stack
 * quiet for the cockpit spec that runs last).
 */

function isoPlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
const YEAR = new Date().toISOString().slice(0, 4);

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

async function advanceStage(page: Page, expectLabel: string): Promise<void> {
  await page.getByTestId('advance-finance-stage').click();
  await page.getByTestId('advance-finance-stage-confirm').click();
  await expect(page.getByTestId('mission-finance-stage')).toHaveText(expectLabel);
}

test.setTimeout(120_000);

test('Invoices: issue from the P&L → series number + PDF; cockpit chases; void frees; settlement quiets', async ({ page }) => {
  let missionUrl = '';
  const invNumber = `INVT-INV-${YEAR}-001`;

  await test.step('Ops stages an issuing entity (code INVT) and a finished mission with an income line', async () => {
    await login(page, 'ops@alpha.com', 'operations');

    // The entity whose code numbers the series.
    await page.getByTestId('nav-entities').click();
    await page.getByTestId('add-entity-toggle').click();
    await page.getByTestId('add-entity-name').fill('Invoice Test Co');
    await page.getByTestId('add-entity-code').fill('INVT');
    await page.getByTestId('add-entity-jurisdiction').fill('UAE');
    await page.getByTestId('add-entity-submit').click();
    await page.getByTestId('add-entity-submit-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('Entity created');

    // A mission that already ended (the settlement phase is the point).
    await page.getByTestId('nav-missions').click();
    await page.getByTestId('add-mission-toggle').click();
    await page.getByTestId('add-mission-name').fill('Invoice Cup');
    await page.getByTestId('add-mission-code').fill(`TR/${YEAR}/0099`);
    await page.getByTestId('add-mission-organizer').fill('VSPN');
    await page.getByTestId('add-mission-starts').fill(isoPlus(-20));
    await page.getByTestId('add-mission-ends').fill(isoPlus(-3));
    await page.getByTestId('add-mission-submit').click();
    await page.getByTestId('add-mission-submit-confirm').click();

    const row = page.locator('[data-testid^="mission-row-"]', { hasText: 'Invoice Cup' }).first();
    await row.locator('[data-testid^="mission-link-"]').click();
    await expect(page.getByTestId('mission-title')).toHaveText('Invoice Cup');
    missionUrl = page.url();

    // One income line, still Expected.
    await page.getByTestId('add-line').click();
    await page.getByTestId('add-line-direction').click();
    await page.getByRole('option', { name: 'Income', exact: true }).click();
    await page.getByTestId('add-line-category').click();
    await page.getByRole('option', { name: 'Prize money', exact: true }).click();
    await page.getByTestId('add-line-label').fill('Prize — 2nd place');
    await page.getByTestId('add-line-amount').fill('8000');
    await page.getByTestId('add-line-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('Line added');
  });

  await test.step('Issue the invoice from the line: series number, VAT, the line flips to Invoiced', async () => {
    const lineRow = page.locator('[data-testid^="pnl-line-PNL-"]').first();
    await expect(lineRow).toContainText('Expected');
    const lineId = (await lineRow.getAttribute('data-testid'))!.replace('pnl-line-', '');

    await page.getByTestId(`invoice-line-${lineId}`).click();
    // Billed-to prefilled from the organizer; the entity is chosen explicitly.
    await expect(page.getByTestId(`invoice-billed-to-${lineId}`)).toHaveValue('VSPN');
    await page.getByTestId(`invoice-entity-${lineId}`).click();
    await page.getByRole('option', { name: /INVT · Invoice Test Co/ }).click();
    await page.getByTestId(`invoice-vat-${lineId}`).fill('5');
    await page.getByTestId(`invoice-line-${lineId}-confirm`).click();

    await expect(page.getByTestId('notifications')).toContainText(`Issued ${invNumber}`);
    await expect(page.getByTestId(`pnl-line-payment-${lineId}`)).toHaveText('Invoiced');
  });

  await test.step('Walk the money phase to PostMission — the cockpit chases the payment BY NUMBER', async () => {
    await expect(page.getByTestId('mission-finance-stage')).toHaveText('Planning');
    await advanceStage(page, 'Finance pending');
    await advanceStage(page, 'Confirmed');
    await advanceStage(page, 'Active');
    await advanceStage(page, 'Post-mission');

    await login(page, 'owner@alpha.com', 'owner');
    await page.getByTestId('nav-situation').click();
    const signals = page.getByTestId('situation-signals');
    await expect(signals).toContainText('Payment outstanding');
    await expect(signals).toContainText('invoiced payment');
    await expect(signals).toContainText(invNumber);
  });

  await test.step('The register holds the paper: row, total with VAT, PDF download by number', async () => {
    await page.getByTestId('nav-invoices').click();
    const row = page.locator('[data-testid^="invoice-row-INV-"]').first();
    await expect(row).toContainText(invNumber);
    await expect(row).toContainText('VSPN');
    await expect(row).toContainText('USD 8,400.00'); // 8,000 + 5% VAT

    const invoiceId = (await row.getAttribute('data-testid'))!.replace('invoice-row-', '');
    const download = page.waitForEvent('download');
    await page.getByTestId(`invoice-pdf-${invoiceId}`).click();
    expect((await download).suggestedFilename()).toBe(`${invNumber}.pdf`);

    // Void with a recorded reason: the number is kept, the line frees up.
    await page.getByTestId(`void-invoice-${invoiceId}`).click();
    await page.getByTestId(`void-reason-${invoiceId}`).fill('Wrong VAT rate');
    await page.getByTestId(`void-invoice-${invoiceId}-confirm`).click();
    await expect(page.getByTestId('notifications')).toContainText('voided');
    await expect(page.getByTestId(`invoice-status-${invoiceId}`)).toHaveText('Voided');
  });

  await test.step('The line is Expected again; recording receipt + settling quiets the cockpit', async () => {
    await page.goto(missionUrl);
    const lineRow = page.locator('[data-testid^="pnl-line-PNL-"]').first();
    const lineId = (await lineRow.getAttribute('data-testid'))!.replace('pnl-line-', '');
    await expect(page.getByTestId(`pnl-line-payment-${lineId}`)).toHaveText('Expected');

    // The money lands (recorded against the line — the single source of truth).
    await page.getByTestId(`payment-line-${lineId}`).click();
    await page.getByTestId(`payment-status-${lineId}`).click();
    await page.getByRole('option', { name: 'Received', exact: true }).click();
    await page.getByTestId(`payment-source-${lineId}`).fill('ESA');
    await page.getByTestId(`payment-line-${lineId}-confirm`).click();
    await expect(page.getByTestId(`pnl-line-payment-${lineId}`)).toHaveText('Received');

    // S8: received money can be distributed — allocate 100% to the org (the
    // allocator's exact-sum law shows on the card), then revoke honestly so
    // the stack stays quiet.
    await page.getByTestId('distribute-toggle').click();
    await page.getByTestId('distribute-line').click();
    await page.getByRole('option', { name: /Prize — 2nd place/ }).click();
    await page.getByTestId('distribute-org-pct').fill('100');
    await expect(page.getByTestId('distribute-share-sum')).toContainText('the org takes 100%');
    await page.getByTestId('distribute-toggle-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('allocated — org USD 8,000.00');
    const distCard = page.locator('[data-testid^="distribution-DIST-"]').first();
    await expect(distCard).toContainText('Pool USD 8,000.00');
    const distId = (await distCard.getAttribute('data-testid'))!.replace('distribution-', '');

    await page.getByTestId(`revoke-${distId}`).click();
    await page.getByTestId(`revoke-reason-${distId}`).fill('Demo allocation — revoked');
    await page.getByTestId(`revoke-${distId}-confirm`).click();
    await expect(page.getByTestId(`distribution-status-${distId}`)).toHaveText('Revoked');

    // All income Received → the mission settles; the settlement signals go
    // quiet (the always-on check LEDGER still lists the checks — that's the
    // honest all-clear — so the assertion targets the signal CARDS only).
    await advanceStage(page, 'Settled');
    await page.getByTestId('nav-situation').click();
    await expect(page.getByTestId('situation-checks')).toBeVisible();
    const signalCards = page.getByTestId('situation-signals');
    if (await signalCards.count()) {
      await expect(signalCards).not.toContainText(invNumber);
      await expect(signalCards).not.toContainText('Invoice Cup');
    }
  });

  await test.step('A visitor sees no Invoices nav and a fail-closed register', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-invoices')).toHaveCount(0);
    await page.goto('/invoices');
    await expect(page.getByTestId('invoices-denied')).toBeVisible();
  });
});
