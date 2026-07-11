import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end evidence for Track B4 — contextual comments. Runs on the shared
 * stack after addPerson (which creates PER-0001, active). Proves the comment
 * thread renders on a record, a comment posts and appears, and the thread is
 * append-only + ordered. The @mention → notification path is proven at the
 * API layer (comments.test.ts).
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

test('Comments: a thread on a record posts, renders, and stays ordered', async ({ page }) => {
  await test.step('Owner opens a person and starts the discussion', async () => {
    await login(page, 'owner@alpha.com', 'owner');
    await page.goto('/people/PER-0001');
    await expect(page.getByTestId('comment-thread')).toBeVisible();
    await expect(page.getByTestId('comments-empty')).toBeVisible();

    await page.getByTestId('comment-body').fill('First note: passport renewal due soon.');
    await page.getByTestId('comment-submit').click();
    await expect(page.getByTestId('notifications')).toContainText('Comment posted');
    await expect(page.getByTestId('comment-thread')).toContainText('First note: passport renewal due soon.');
    await expect(page.getByTestId('comment-thread')).toContainText('owner@alpha.com');
  });

  await test.step('A second comment appends below the first; the thread persists a reload', async () => {
    await page.getByTestId('comment-body').fill('Second note: confirmed with the player.');
    await page.getByTestId('comment-submit').click();
    await expect(page.getByTestId('comment-thread')).toContainText('Second note: confirmed with the player.');

    await page.reload();
    const thread = page.getByTestId('comment-thread');
    await expect(thread).toContainText('First note: passport renewal due soon.');
    await expect(thread).toContainText('Second note: confirmed with the player.');
    // oldest first: the first note appears before the second in the DOM
    const firstIdx = (await thread.textContent())!.indexOf('First note');
    const secondIdx = (await thread.textContent())!.indexOf('Second note');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});
