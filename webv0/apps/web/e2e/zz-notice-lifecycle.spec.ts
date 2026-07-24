import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for UX11 — a notice minted under one identity must never
 * render under another. Before the fix, NotificationProvider wrapped
 * SessionProvider, so notices lived ABOVE the session and survived sign-out:
 * a "Submitted APR-…" notice minted by ops was still in the stack when the
 * next actor signed in — a disclosure (it can carry a name / id / amount).
 *
 * NAMED zz- TO RUN LAST: a pure leaf that mutates shared tenant state (one
 * approval), so it runs after the id-hardcoding specs and shifts nothing they
 * depend on. It captures the id it mints, asserting the SPECIFIC leaked notice
 * is absent — not a container count (the notice region can be always-present).
 *
 * Tenant is covered by construction (the clear key is `${userId}@${tenantSlug}`
 * — either dimension gates); this pins the actor-change (re-login) path, which
 * is the one a real sign-out/sign-in exercises.
 */

/** Fills the sign-in form already on screen and submits. No page navigation —
 *  see signInAs vs the initial goto. */
async function fillSignIn(page: Page, email: string, role: string): Promise<void> {
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-role').click();
  await page.getByRole('option', { name: role, exact: true }).click();
  await page.getByTestId('login-tenant').fill('alpha');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('role-display')).toContainText(role);
}

/** First sign-in from a fresh page (a reload is fine — nothing to preserve). */
async function login(page: Page, email: string, role: string): Promise<void> {
  await page.goto('/people');
  const logout = page.getByTestId('logout');
  try {
    await logout.waitFor({ state: 'visible', timeout: 4000 });
    await logout.click();
  } catch {
    /* already signed out */
  }
  await fillSignIn(page, email, role);
}

/** IN-APP sign-out then sign-in — NO page reload. This is the disclosure
 *  surface: the React tree (and NotificationProvider's state) stays mounted
 *  across the identity change, so any notice held from the prior session is
 *  still in memory. A page.goto here would remount the tree and wipe the
 *  notices, masking the very bug under test. */
async function signInAs(page: Page, email: string, role: string): Promise<void> {
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-email')).toBeVisible();
  await fillSignIn(page, email, role);
}

/** Ops (signed in) submits AddPerson; returns the minted APR id (which also
 *  leaves a "Submitted APR-…" notice in the stack). */
async function submitAddPerson(page: Page, fullName: string): Promise<string> {
  await page.getByTestId('add-person-toggle').click();
  await page.getByTestId('add-person-fullname').fill(fullName);
  await page.getByTestId('add-person-team').fill('Notice');
  await page.getByTestId('add-person-submit').click();
  await page.getByTestId('add-person-submit-confirm').click();
  const notice = page.getByTestId('notifications');
  await expect(notice).toContainText(/Submitted APR-\d+/);
  const text = (await notice.textContent()) ?? '';
  const all = [...text.matchAll(/Submitted (APR-\d+)/g)];
  return all[all.length - 1]![1]!;
}

test.setTimeout(120_000);

test('Notices never survive a sign-out: a notice minted by one actor does not render for the next', async ({ page }) => {
  // Actor A (operations) mints a notice.
  await login(page, 'ops@alpha.com', 'operations');
  const aprA = await submitAddPerson(page, 'Notice Leak Probe');
  await expect(page.getByTestId('notifications')).toContainText(aprA); // present for A

  // Sign out and in as a DIFFERENT actor (owner) IN-APP — no reload, so the
  // notice state survives the identity change if the fix isn't there.
  await signInAs(page, 'owner@alpha.com', 'owner');

  // B must NOT see A's notice anywhere — target the specific leaked id, not the
  // container (which may be an always-present, empty region). B just landed on
  // /people, where that approval id appears nowhere else.
  await expect(page.getByText(new RegExp(aprA))).toHaveCount(0);
});
