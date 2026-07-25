import { test, expect, type Page } from '@playwright/test';

/**
 * zzz-intake-erasure.spec — Wave 2 · Lane D · mandate D2.
 *
 * Guest intake is the highest-risk screen in the pivot: it carries an
 * IRREVERSIBLE action ("its details (and any files) are wiped. This cannot be
 * undone"), it renders a one-time capability token, and until this file it had
 * ZERO coverage — while being refactored. Manual QA is the weakest instrument
 * we have and it was the only one pointed at the only unrecoverable surface.
 *
 * DELIBERATELY NARROW. This is not coverage of the screen. It pins exactly two
 * properties of the erasure path, and nothing else:
 *
 *   (a) the erasure REQUIRES its confirmation — opening the reject dialog and
 *       dismissing it erases nothing;
 *   (b) the erasure acts on the INTENDED record — confirming on one submission
 *       wipes that one and leaves its neighbour untouched.
 *
 * RED-PROVEN before landing: with the guard removed (the reject trigger wired
 * straight to the mutation) step (a) fails — see the lane report.
 *
 * NAMED zzz- TO RUN LAST. The suite shares one accumulating database on a
 * single worker and specs run in file order. This spec is a pure LEAF: it
 * mints intake links and sandbox rows only. It never PROMOTES, so it allocates
 * no APR- sequence and creates no person — nothing downstream can shift under
 * the id-hardcoding specs. Every id it touches is captured from the DOM, so it
 * is correct in isolation and in the suite.
 *
 * Structure-agnostic ON PURPOSE: it addresses the screen only through
 * behaviour-frozen testids and visible copy, never through DOM shape — so the
 * same file is the oracle for the Fluent page and for its Tablework
 * conversion.
 */

/**
 * Run-unique names. The sandbox accumulates across runs against a reused
 * server, and a rejected row keeps its ROW while losing its NAME — so a fixed
 * name would make `toHaveCount(0)` weaker on the first run and ambiguous on
 * the second. Unique names keep every assertion exact on a warm database.
 */
const RUN = Date.now().toString(36).toUpperCase();
const TARGET = `Erasure Target Alpha ${RUN}`;
const BYSTANDER = `Erasure Bystander Beta ${RUN}`;

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

/** Mint a single-use link as staff and return the guest URL shown ONCE. */
async function mintGuestUrl(page: Page): Promise<string> {
  await page.goto('/intake');
  await page.getByTestId('intake-mint').click();
  const box = page.getByTestId('intake-minted');
  await expect(box).toBeVisible();
  const shown = await box.innerText();
  const match = shown.match(/\/intake\/[A-Za-z0-9_-]+/);
  expect(match, 'the minted box must show the one-time guest link').not.toBeNull();
  return match![0];
}

/** Walk the PUBLIC guest form (no account) and submit one named joiner. */
async function guestSubmits(page: Page, guestPath: string, fullName: string): Promise<void> {
  await page.goto(guestPath);
  await page.getByTestId('guest-fullName').fill(fullName);
  await page.getByTestId('guest-submit').click();
  await expect(page.getByTestId('guest-done')).toBeVisible();
}

/** The sandbox row carrying this name, and the submission id baked into it. */
function sandboxRow(page: Page, fullName: string) {
  return page.locator('[data-testid^="intake-sub-"]').filter({ hasText: fullName });
}
async function submissionIdOf(page: Page, fullName: string): Promise<string> {
  const testId = await sandboxRow(page, fullName).getAttribute('data-testid');
  expect(testId, `a sandbox row for ${fullName} must exist`).not.toBeNull();
  return testId!.replace('intake-sub-', '');
}

test('Guest intake · erasure: reject requires its confirmation, and wipes only the intended submission', async ({ page }) => {
  let targetId = '';

  await test.step('Two guests land in the sandbox — the target and a bystander', async () => {
    await login(page, 'ops@alpha.com', 'operations');

    await guestSubmits(page, await mintGuestUrl(page), TARGET);
    await guestSubmits(page, await mintGuestUrl(page), BYSTANDER);

    await page.goto('/intake');
    await expect(sandboxRow(page, TARGET)).toBeVisible();
    await expect(sandboxRow(page, BYSTANDER)).toBeVisible();
    targetId = await submissionIdOf(page, TARGET);
  });

  await test.step('(a) THE GUARD — opening the reject dialog and dismissing it erases NOTHING', async () => {
    await page.getByTestId(`intake-reject-${targetId}`).click();
    // The confirmation is a SEPARATE, explicit act — and it states the
    // consequence before anything happens.
    await expect(page.getByTestId(`intake-reject-${targetId}-confirm`)).toBeVisible();
    await expect(page.getByText('This cannot be undone.').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(`intake-reject-${targetId}-confirm`)).toHaveCount(0);

    // The submission is untouched: still Pending, still carrying its details.
    await expect(sandboxRow(page, TARGET)).toBeVisible();
    await expect(sandboxRow(page, TARGET)).toContainText('Pending');
    // And the mutation did not fire behind the dialog — a reload proves the
    // SERVER still holds the payload, not just this render.
    await page.reload();
    await expect(sandboxRow(page, TARGET)).toContainText('Pending');
  });

  await test.step('(b) THE TARGET — confirming wipes THIS submission and no other', async () => {
    await page.getByTestId(`intake-reject-${targetId}`).click();
    await page.getByTestId(`intake-reject-${targetId}-confirm`).click();
    await expect(page.getByTestId('notifications')).toContainText('Submission rejected — its details were wiped.');

    // The target's details are GONE from the register — the name it was
    // submitted under no longer renders anywhere on the page.
    await expect(page.getByTestId(`intake-sub-${targetId}`)).toContainText('Rejected');
    await expect(page.getByText(TARGET)).toHaveCount(0);

    // The bystander is untouched — the erasure acted on the intended record.
    await expect(sandboxRow(page, BYSTANDER)).toBeVisible();
    await expect(sandboxRow(page, BYSTANDER)).toContainText('Pending');
  });

  await test.step('The wipe survives a reload — it happened on the server, not in this tab', async () => {
    await page.reload();
    await expect(page.getByText(TARGET)).toHaveCount(0);
    await expect(sandboxRow(page, BYSTANDER)).toContainText('Pending');
    await expect(page.getByTestId(`intake-sub-${targetId}`)).toContainText('Rejected');
  });
});
