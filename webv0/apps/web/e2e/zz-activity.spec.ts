import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for Track B3 — the Activity Feed. Named to sort LAST on
 * the shared, single-worker stack ON PURPOSE: the feed is a read-only
 * projection of the accumulated audit stream, so it is most honestly tested
 * against the history every other spec has already written. It creates
 * nothing (that would pollute registers earlier specs assume empty).
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

test('Activity feed: the accumulated org journal reads back with headlines and provenance', async ({ page }) => {
  await test.step('Owner sees a populated, human-readable journal', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto('/activity');
    const feed = page.getByTestId('activity-feed');
    await expect(feed).toBeVisible();
    // Real rows, each with its actor (provenance). The exact headline text is
    // asserted at the API layer; here we prove the page renders the journal.
    await expect(feed).toContainText('by ');
    await expect(feed.locator('[data-testid^="activity-"]').first()).toBeVisible();
    // Newest-first paging: with a full suite's history (well over one page of
    // audited actions), a "Load more" appears.
    await expect(page.getByTestId('activity-load-more')).toBeVisible();
    // Following it fetches an older page without error.
    await page.getByTestId('activity-load-more').click();
    await expect(feed.locator('[data-testid^="activity-"]')).not.toHaveCount(0);
  });

  await test.step('A read-only identity is denied the feed', async () => {
    await login(page, 'visitor@alpha.com', 'visitor');
    await expect(page.getByTestId('nav-activity')).toHaveCount(0);
    await page.goto('/activity');
    await expect(page.getByTestId('activity-denied')).toBeVisible();
  });
});
