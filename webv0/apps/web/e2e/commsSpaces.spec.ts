/**
 * commsSpaces.spec.ts — Phase B (activation): the UI truth of the ledger, the
 * Heads' Table, and the audience treaty. The deep laws live in the api suite
 * (commsSpaces.test.ts); this spec proves the SURFACES render them.
 *
 * Instance 48: assertions target artifacts (testids, data-truth, data-treaty),
 * never prose.
 */
import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, email: string, role: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: role, exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-submit')).toHaveCount(0);
}

test('the ledger is the Comms front door: nav lands on it, its truth is stamped, a room is born with its log', async ({ page }) => {
  await login(page, 'ops@alpha.com', 'operations');

  // The rail's Comms entry is a real destination now.
  await page.getByTestId('nav-comms').click();
  await expect(page).toHaveURL(/\/comms$/);
  // The page-level truth artifact renders (caught-up = proven-empty, earned).
  await expect(page.locator('[data-truth]').first()).toBeVisible();

  // A room is born from the front door (ops holds the affordance)…
  page.on('dialog', (d) => void d.accept('The Heads’ Table'));
  await page.getByTestId('create-room').click();
  await expect(page).toHaveURL(/\/comms\/threads\/THR-\d+/);

  // …with its seat list and its log opening with Created.
  await expect(page.getByTestId('room-seats')).toBeVisible();
  await expect(page.getByTestId('room-log')).toContainText('Created');

  // THE AUDIENCE TREATY: verified, naming the seated audience; Send exists.
  await expect(page.locator('[data-treaty="verified"]')).toBeVisible();

  // The room speaks: post, and the message region flips to verified.
  await page.locator('#thread-message').fill('Heads only: the sponsor call moved.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('[data-truth="verified"]').first()).toBeVisible();
});

test('the treaty disables Send when the audience cannot be verified', async ({ page }) => {
  await login(page, 'ops@alpha.com', 'operations');
  // The mission resolves; the comms reads fail — the audience (mission) is
  // fine here, so instead fail the MISSION read on a comms page: the treaty
  // must flip to unverified and Send must be disabled.
  await page.route('**/api/v1/missions/MSN-0042', (r) => r.abort());
  await page.route('**/api/v1/comms/missions/MSN-0042/thread**', (r) =>
    r.fulfill({ json: { thread: null, messages: [], myLastReadSeq: null } }),
  );
  await page.route('**/api/v1/comms/missions/MSN-0042/obligations', (r) => r.fulfill({ json: { obligations: [] } }));
  await page.route('**/api/v1/comms/missions/MSN-0042/receipts', (r) => r.fulfill({ json: { receipts: [] } }));
  await page.route('**/api/v1/comms/prefs', (r) => r.fulfill({ json: { receiptsEnabled: true, presenceEnabled: false, version: null } }));
  await page.goto('/missions/MSN-0042/comms');
  await expect(page.locator('[data-treaty="unverified"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
});
