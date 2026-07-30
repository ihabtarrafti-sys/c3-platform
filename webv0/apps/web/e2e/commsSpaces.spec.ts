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
  // Sign out first when a session already exists (the house pattern) — a
  // re-login without it finds no gate to fill.
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

test('B8: the address book opens a direct thread, and the DM states its retention where the talking happens', async ({ page }) => {
  // A second member must EXIST to be addressable (one-time provisioning login,
  // the house pattern). With a single-member tenant the picker's absence is
  // CORRECT — there is nobody else to write to — so the test provisions rather
  // than asserting against an empty world.
  await login(page, 'lead@alpha.com', 'operations');
  await login(page, 'ops@alpha.com', 'operations');
  await page.getByTestId('nav-comms').click();

  // The address book renders for an entitled member and can be acted on.
  const picker = page.getByTestId('comms-directory');
  await expect(picker).toBeVisible();
  const options = picker.locator('option:not([disabled])');
  await expect(options.first()).toBeAttached();
  await picker.locator('select').selectOption({ index: 1 });

  // A DM opens, and the retention posture is stated in-surface (the artifact,
  // not the prose — instance 48).
  await expect(page).toHaveURL(/\/comms\/threads\/THR-\d+/);
  await expect(page.getByTestId('retention-notice')).toBeVisible();
  // Its audience treaty is verified and names the pair, so Send is live.
  await expect(page.locator('[data-treaty="verified"]')).toBeVisible();
});

test('B-LIVE: a message ARRIVES without a refresh (a second real session posts)', async ({ page, context }) => {
  await login(page, 'lead@alpha.com', 'operations');
  await login(page, 'ops@alpha.com', 'operations');

  // Ops opens a DM with lead and sits on the ledger (the other party's view).
  await page.getByTestId('nav-comms').click();
  // Select the person BY IDENTITY, never by position: in the full battery the
  // tenant holds every member each spec has signed in as, so `index: 1` picks
  // someone else and the DM is opened with the wrong party. The first version
  // of this test assumed a near-empty world and passed only in isolation.
  const picker = page.getByTestId('comms-directory').locator('select');
  const leadValue = await picker.locator('option', { hasText: 'lead@alpha.com' }).first().getAttribute('value');
  expect(leadValue, 'lead must be addressable in the directory').toBeTruthy();
  await picker.selectOption(leadValue!);
  await expect(page).toHaveURL(/\/comms\/threads\/THR-\d+/);
  const threadUrl = page.url();
  const threadId = threadUrl.split('/').pop()!;

  // The other member posts from a second session…
  const other = await context.browser()!.newContext();
  const otherPage = await other.newPage();
  await login(otherPage, 'lead@alpha.com', 'operations');
  await otherPage.goto(threadUrl);
  await otherPage.locator('#thread-message').fill('arriving live, no refresh');
  await otherPage.getByRole('button', { name: 'Send', exact: true }).click();

  // …and it appears on the first session WITHOUT a reload (the artifact, not
  // the words: the message region re-renders through its gated query).
  await expect(page.getByText('arriving live, no refresh')).toBeVisible({ timeout: 20_000 });
  await other.close();
  void threadId;
});

test('B-LIVE: a dead stream renders STALE with its last-confirmed time — never old rows presented as current', async ({ page }) => {
  await login(page, 'ops@alpha.com', 'operations');
  await page.getByTestId('nav-comms').click();

  // The stream is then cut for every subsequent attempt: this is the BUFFERED
  // /DEAD case, which delivers nothing — including heartbeats — so the client's
  // watchdog must convert silence into a visible stale stamp rather than
  // leaving a healthy-looking screen.
  await page.route('**/api/v1/comms/stream', (r) => r.abort());
  await page.reload();

  await expect(page.locator('[data-truth="stale"]')).toBeVisible({ timeout: 30_000 });
});
