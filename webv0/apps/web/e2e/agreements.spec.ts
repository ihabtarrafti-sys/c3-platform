import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for the Agreements domain (Sprint 41 — the first domain
 * BEYOND the CP). Runs after addPerson.spec on the shared stack (PER-0001
 * "Jordan Reyes" exists).
 *
 * Flow: governed creation with a value (ops requests → owner executes) → the
 * governed RENEWAL write the CP never shipped → direct non-material edit →
 * an NDA addendum LINKED to its parent → role truth: legal sees the register
 * WITHOUT the value column/field; hr and visitor have no nav and a fail-closed
 * page → governed termination retires the affordances.
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

async function submitAddAgreement(page: Page, type: string, opts: { code?: string; value?: string; linkLabelRe?: RegExp } = {}): Promise<string> {
  await page.getByTestId('nav-agreements').click();
  await page.getByTestId('add-agreement-toggle').click();
  await page.getByTestId('add-agreement-person').click();
  await page.getByRole('option', { name: /Jordan Reyes/ }).click();
  await page.getByTestId('add-agreement-type').fill(type);
  if (opts.code) await page.getByTestId('add-agreement-code').fill(opts.code);
  if (opts.linkLabelRe) {
    await page.getByTestId('add-agreement-link').click();
    await page.getByRole('option', { name: opts.linkLabelRe }).click();
  }
  await page.getByTestId('add-agreement-starts').fill('2026-08-01');
  await page.getByTestId('add-agreement-ends').fill('2027-07-31');
  if (opts.value) await page.getByTestId('add-agreement-value').fill(opts.value);
  await page.getByTestId('add-agreement-submit').click();
  await page.getByTestId('add-agreement-submit-confirm').click();
  await expect(page.getByTestId('notifications')).toContainText('not created until an owner executes');
  return captureApprovalId(page);
}

test('Agreements governed lifecycle, end to end', async ({ page }) => {
  let addApr = '';

  await test.step('Ops requests a player contract with a value; owner executes; register + detail show it', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    addApr = await submitAddAgreement(page, 'Player Contract', { code: 'GKE-PL-2026-001', value: '250000' });

    await login(page, 'owner@alpha.com', 'owner');
    await page.goto(`/approvals/${addApr}`);
    await expect(page.getByTestId('approval-agreement-subject')).toHaveText('Player Contract for PER-0001');
    await ownerExecutes(page, addApr);

    await page.getByTestId('nav-agreements').click();
    await expect(page.getByTestId('agreement-row-AGR-0001')).toBeVisible();
    await expect(page.getByTestId('agreement-value-AGR-0001')).toHaveText('$250,000.00');
    await page.getByTestId('agreement-link-AGR-0001').click();
    await expect(page.getByTestId('agreement-title')).toHaveText('GKE-PL-2026-001');
    await expect(page.getByTestId('agreement-ends')).toHaveText('2027-07-31');
  });

  await test.step('The governed renewal the CP never shipped: term extends only after execution', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/agreements/AGR-0001');
    await page.getByTestId('renew-agreement-AGR-0001').click();
    await page.getByTestId('renew-ends-AGR-0001').fill('2028-07-31');
    await page.getByTestId('renew-agreement-AGR-0001-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('term is unchanged until an owner executes');
    const renewApr = await captureApprovalId(page);

    // Honest pending state: the term has NOT moved yet.
    await expect(page.getByTestId('agreement-ends')).toHaveText('2027-07-31');

    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, renewApr);
    await page.goto('/agreements/AGR-0001');
    await expect(page.getByTestId('agreement-ends')).toHaveText('2028-07-31');
  });

  await test.step('Direct non-material edit is immediate and recorded', async () => {
    await page.getByTestId('edit-agreement-AGR-0001').click();
    await page.getByTestId('edit-agreement-code-AGR-0001').fill('GKE-PL-2026-001-R1');
    await page.getByTestId('edit-agreement-AGR-0001-confirm').click();
    await expect(page.getByTestId('notifications')).toContainText('AGR-0001 updated');
    await expect(page.getByTestId('agreement-title')).toHaveText('GKE-PL-2026-001-R1');
  });

  await test.step('An NDA addendum links to its parent as a first-class relationship', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    const ndaApr = await submitAddAgreement(page, 'NDA Addendum', { linkLabelRe: /AGR-0001/ });
    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, ndaApr);

    await page.goto('/agreements/AGR-0002');
    await expect(page.getByTestId('agreement-parent-link')).toHaveText('AGR-0001');
    await page.getByTestId('agreement-parent-link').click();
    await expect(page.getByTestId('agreement-addendums')).toContainText('AGR-0002');
  });

  await test.step('Legal reads WITHOUT the value; hr and visitor have no agreements surface at all', async () => {
    await login(page, 'legal@alpha.com', 'legal');
    await page.getByTestId('nav-agreements').click();
    await expect(page.getByTestId('agreement-row-AGR-0001')).toBeVisible();
    await expect(page.getByTestId('agreement-value-AGR-0001')).toHaveCount(0); // no value column
    await page.goto('/agreements/AGR-0001');
    await expect(page.getByTestId('agreement-id')).toHaveText('AGR-0001');
    await expect(page.getByTestId('agreement-value')).toHaveCount(0); // no value row
    await expect(page.getByTestId('renew-agreement-AGR-0001')).toHaveCount(0); // read-only: no material affordances

    for (const who of [
      { email: 'hr@alpha.com', role: 'hr' },
      { email: 'visitor@alpha.com', role: 'visitor' },
    ]) {
      await login(page, who.email, who.role);
      await expect(page.getByTestId('nav-agreements')).toHaveCount(0); // nav hidden
      await page.goto('/agreements');
      await expect(page.getByTestId('agreements-denied')).toBeVisible(); // page fails closed, truthfully
    }
  });

  await test.step('Governed termination retires the affordances', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto('/agreements/AGR-0001');
    await page.getByTestId('terminate-agreement-AGR-0001').click();
    await expect(page.getByTestId('terminate-agreement-AGR-0001-confirm')).toBeDisabled(); // reason mandatory
    await page.getByTestId('terminate-reason-AGR-0001').fill('Mutual exit');
    await page.getByTestId('terminate-agreement-AGR-0001-confirm').click();
    const termApr = await captureApprovalId(page);

    await login(page, 'owner@alpha.com', 'owner');
    await ownerExecutes(page, termApr);
    await page.goto('/agreements/AGR-0001');
    await expect(page.getByTestId('agreement-status')).toHaveText('Terminated');
    await expect(page.getByTestId('renew-agreement-AGR-0001')).toHaveCount(0); // terminal offers nothing
    await expect(page.getByTestId('edit-agreement-AGR-0001')).toHaveCount(0);
  });
});
