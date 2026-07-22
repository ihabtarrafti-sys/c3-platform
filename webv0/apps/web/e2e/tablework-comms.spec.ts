import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * End-to-end evidence for the Tablework pilot (Comms UI-3): the Mission Comms
 * screen on its standalone frame at /missions/:id/comms.
 *
 * The arc: ops opens the conversation from the mission workspace → posts (the
 * D1 warning is present; an APR reference renders as a navigate-only card) →
 * attaches → mints an obligation (the SoD seam refuses accountable==acceptance
 * inline) → delivers evidence → the named authority ALONE sees Accept and
 * accepts → Done — the three truths flip ONE at a time. Receipts disclose
 * ("Seen by"), the unread divider sits at the cursor, and the privacy toggle
 * hides a suppressed receipt. Then the lapse posture (banner + composer and
 * actions REMOVED, reads + own-prefs live), the keyboard contract (skip-link,
 * Escape + focus return), and the reduced-effects collapse of Float glass.
 *
 * Ordering: 'tablework-comms' sorts AFTER every spec with hardcoded MSN ids
 * (missions/personHub/search/settings/situationRoom) and before teams (which
 * hardcodes none) — the mission id is captured, never assumed.
 *
 * Screenshots for the owner's review land in test-results/comms-shots/.
 */

const SHOTS = 'test-results/comms-shots';
const API = 'http://127.0.0.1:4100';

// A real 1x1 PNG — the API verifies magic bytes, not just the declared type.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

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

let missionId = '';

test('Tablework Comms: the full obligation arc — three truths flip one at a time; receipts disclose and hide', async ({ page }) => {
  test.slow();
  mkdirSync(SHOTS, { recursive: true });

  await test.step('The acceptance authority exists as a member (one-time provisioning login)', async () => {
    await login(page, 'lead@alpha.com', 'operations');
  });

  await test.step('Ops creates a mission and crosses into the conversation', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.getByTestId('nav-missions').click();
    await page.getByTestId('add-mission-toggle').click();
    await page.getByTestId('add-mission-name').fill('Comms Pilot Cup');
    await page.getByTestId('add-mission-starts').fill('2026-09-08');
    await page.getByTestId('add-mission-submit').click();
    await page.getByTestId('add-mission-submit-confirm').click();
    await page.getByRole('row', { name: /Comms Pilot Cup/ }).locator('[data-testid^="mission-link-"]').click();
    await expect(page.getByTestId('mission-title')).toHaveText('Comms Pilot Cup');
    missionId = /\/missions\/(MSN-\d+)/.exec(page.url())![1]!;

    await page.getByTestId('mission-conversation-link').click();
    await expect(page).toHaveURL(new RegExp(`/missions/${missionId}/comms`));
    // The standalone Tablework frame — and never the Fluent shell — owns this route.
    await expect(page.locator('.tw-root')).toBeVisible();
    await expect(page.locator('.lt-shell')).toHaveCount(0);
  });

  await test.step('D1 + the boundary notes ride the composer; a post renders with a navigate-only approval card', async () => {
    await expect(page.locator('[data-tablework="VisibilityWarning"]')).toHaveText('Visible to everyone who can see this mission.');
    await expect(page.getByText('Approval references only navigate.', { exact: false })).toBeVisible();

    await page.locator('#thread-message').fill('The signed pack is due Friday — tracking under APR-0001.');
    await page.getByRole('button', { name: 'Send' }).click();
    const approvalCard = page.locator('[data-tablework="ApprovalLinkReference"]');
    await expect(approvalCard).toBeVisible();
    // Identity + Open, NOTHING else: the only affordance is a LINK to the record.
    await expect(approvalCard.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/approvals/APR-0001');
    await expect(approvalCard.locator('button')).toHaveCount(0);
  });

  await test.step('An attachment posts through the document laws and offers a Download', async () => {
    await page
      .locator('input[aria-label="Attach a file to the conversation"]')
      .setInputFiles({ name: 'venue-brief.png', mimeType: 'image/png', buffer: PNG });
    const attachment = page.locator('[data-tablework="AttachmentRow"]');
    await expect(attachment).toBeVisible();
    await expect(attachment).toContainText('venue-brief.png');
    await expect(attachment.getByRole('button', { name: 'Download' })).toBeVisible();
  });

  await test.step('Minting: the SoD seam refuses accountable==acceptance inline, then the record is born all-unknown', async () => {
    await page.getByRole('button', { name: 'Create obligation' }).click();
    const float = page.locator('dialog.float-surface');
    await expect(float).toBeVisible();

    await float.getByRole('textbox', { name: 'Description' }).fill('Participant pack to publisher');
    await float.getByRole('combobox', { name: 'Accountable owner' }).selectOption({ label: 'ops@alpha.com · operations' });
    await float.getByRole('combobox', { name: 'Beneficiary', exact: true }).selectOption('external');
    await float.getByRole('textbox', { name: 'Beneficiary label' }).fill('The publisher');

    // The SoD probe: the accountable owner cannot be their own acceptance authority.
    await float.getByRole('combobox', { name: 'Accepting member' }).selectOption({ label: 'ops@alpha.com · operations' });
    await expect(float.getByRole('alert')).toContainText('cannot be their own acceptance authority');
    await float.getByRole('combobox', { name: 'Accepting member' }).selectOption({ label: 'lead@alpha.com · operations' });

    await float.getByRole('textbox', { name: 'Due' }).fill('2026-09-15T16:00');
    await float.getByRole('textbox', { name: 'Evidence requirement' }).fill('Signed participant pack');
    await float.getByRole('button', { name: 'Create the record' }).click();

    const card = page.locator('[data-tablework="ObligationCard"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Participant pack to publisher');
    // Three INDEPENDENT truths, all honestly unknown at birth.
    await expect(card.locator('[data-truth-state="unknown"]')).toHaveCount(3);
    // Ops is not the named authority: no Accept/Reject rendered.
    await expect(card.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  });

  await test.step('Evidence delivery flips Delivery ALONE', async () => {
    await page
      .locator('input[aria-label="Deliver requested evidence"]')
      .setInputFiles({ name: 'signed-pack.png', mimeType: 'image/png', buffer: PNG });
    const card = page.locator('[data-tablework="ObligationCard"]');
    await expect(card.locator('[data-truth-state="known"]')).toHaveCount(1);
    // Name the flipped fact — a count alone doesn't say WHICH truth moved.
    await expect(card.locator('[data-truth-state="known"]')).toContainText('Delivery');
    await expect(card.locator('[data-truth-state="unknown"]')).toHaveCount(2);
    await expect(card.locator('[data-tablework="EvidenceRequestSlot"]')).toContainText('signed-pack.png');
    // THE IDENTITY CLAUSE, load-bearing: the state is now Delivered — the ONLY
    // reason ops sees no Accept is that ops is not the named authority.
    await expect(card.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Reject' })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/01-delivered-dark-desktop.png`, fullPage: true });
  });

  await test.step('The named authority ALONE sees Accept — and Acceptance flips second', async () => {
    await login(page, 'lead@alpha.com', 'operations');
    await page.goto(`/missions/${missionId}/comms`);
    const card = page.locator('[data-tablework="ObligationCard"]');
    await expect(card.getByRole('button', { name: 'Accept' })).toBeVisible();
    // Linger at the end of the thread: the read cursor advances on SEEING it
    // (debounced) — this is what the receipts step witnesses later.
    await page.waitForTimeout(2000);
    await card.getByRole('button', { name: 'Accept' }).click();
    await expect(card.locator('[data-truth-state="known"]')).toHaveCount(2);
    await expect(card.locator('[data-truth-state="known"]')).toContainText(['Delivery', 'Acceptance']);
    await expect(card.locator('[data-truth-state="unknown"]')).toHaveCount(1);
    await expect(card.locator('[data-truth-state="unknown"]')).toContainText('Done');
    await expect(card.getByRole('button', { name: 'Accept' })).toHaveCount(0);
  });

  await test.step('Done third; the disclosed receipt reads back', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto(`/missions/${missionId}/comms`);
    const card = page.locator('[data-tablework="ObligationCard"]');
    await card.getByRole('button', { name: 'Record Done' }).click();
    await expect(card.locator('[data-truth-state="known"]')).toHaveCount(3);
    await expect(card.locator('[data-truth-state="known"]')).toContainText(['Delivery', 'Acceptance', 'Done']);
    // The authority's read is disclosed: their cursor reached the thread's end.
    await expect(page.locator('[data-tablework="Receipts"]')).toContainText('Seen by lead@alpha.com');
    await page.screenshot({ path: `${SHOTS}/02-done-dark-desktop.png`, fullPage: true });
  });

  await test.step('The unread divider sits exactly at the reader’s cursor', async () => {
    await page.locator('#thread-message').fill('Wrapped — thanks all.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('[data-tablework="Message"]').last()).toContainText('Wrapped');

    await login(page, 'lead@alpha.com', 'operations');
    await page.goto(`/missions/${missionId}/comms`);
    const divider = page.locator('.unread-divider');
    await expect(divider).toBeVisible();
    // The divider is IMMEDIATELY before the first message past the cursor.
    await expect(page.locator('.unread-divider + article')).toContainText('Wrapped');
  });

  await test.step('The privacy toggle hides the suppressed receipt from the other side', async () => {
    await page.getByRole('button', { name: /My read receipts: shared/ }).click();
    await expect(page.getByRole('button', { name: /My read receipts: private/ })).toBeVisible();

    await login(page, 'ops@alpha.com', 'operations');
    await page.goto(`/missions/${missionId}/comms`);
    await expect(page.locator('.tw-root .conversation')).toBeVisible();
    await expect(page.locator('[data-tablework="Receipts"]')).toHaveCount(0);
  });

  await test.step('The premium eye: light theme + the narrow frame', async () => {
    await page.evaluate(() => localStorage.setItem('c3-mode', 'light'));
    await page.reload();
    await expect(page.locator('.tw-root')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/03-light-desktop.png`, fullPage: true });

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('.narrow-navigation')).toBeVisible();
    await expect(page.locator('.place-rail')).toBeHidden();
    await page.screenshot({ path: `${SHOTS}/04-light-mobile.png`, fullPage: true });

    await page.evaluate(() => localStorage.setItem('c3-mode', 'dark'));
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await page.screenshot({ path: `${SHOTS}/05-dark-desktop.png` });
  });
});

test('Tablework Comms: lapse posture, keyboard contract, reduced-effects glass collapse', async ({ page }) => {
  test.slow();

  await test.step('Keyboard: the skip-link is the first stop and lands in the Room', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto(`/missions/${missionId}/comms`);
    await expect(page.locator('.tw-root')).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tw-room')).toBeFocused();
  });

  await test.step('Reduced effects collapse the Float to opaque; Escape returns focus to the opener', async () => {
    await page.evaluate(() => localStorage.setItem('c3-effects', 'reduced'));
    await page.reload();
    const trigger = page.getByRole('button', { name: 'Create obligation' });
    await trigger.click();
    const float = page.locator('dialog.float-surface');
    await expect(float).toBeVisible();
    const backdrop = await float.evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(backdrop).toBe('none'); // glass collapsed — the reduced-effects law
    await page.keyboard.press('Escape');
    await expect(float).toBeHidden();
    await expect(trigger).toBeFocused(); // native dialog focus-return
    await page.evaluate(() => localStorage.setItem('c3-effects', 'full'));
  });

  await test.step('Lapse: the write is refused, the posture flips, reads and own-prefs stay live', async () => {
    await page.request.post(`${API}/__e2e/comms-entitlement`, { data: { state: 'lapsed' } });
    await page.reload();
    await page.locator('#thread-message').fill('This send must be refused.');
    await page.getByRole('button', { name: 'Send' }).click();

    // The truthful flip: banner up, composer REMOVED, obligation actions gone —
    // the retained history still reads.
    await expect(page.locator('[data-tablework="LapsedBanner"]')).toContainText('read-only');
    await expect(page.locator('.compose')).toHaveCount(0);
    await expect(page.locator('[data-tablework="ObligationActions"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create obligation' })).toHaveCount(0);
    await expect(page.locator('[data-tablework="Message"]').first()).toBeVisible();
    // The refused message never landed.
    await expect(page.locator('[data-tablework="Message"]', { hasText: 'must be refused' })).toHaveCount(0);

    // One's own preferences remain one's own through lapse.
    await page.getByRole('button', { name: /My read receipts/ }).click();
    await expect(page.getByRole('button', { name: /My read receipts: private/ })).toBeVisible();
    await page.screenshot({ path: 'test-results/comms-shots/06-lapsed-dark-desktop.png', fullPage: true });

    // Restore for anything that follows on the shared stack.
    await page.request.post(`${API}/__e2e/comms-entitlement`, { data: { state: 'active' } });
    await page.reload();
    await expect(page.locator('.compose')).toBeVisible();
    // Server truth after a FRESH fetch: the refused send never PERSISTED —
    // non-persistence, not merely client non-render.
    await expect(page.locator('[data-tablework="Message"]').first()).toBeVisible();
    await expect(page.locator('[data-tablework="Message"]', { hasText: 'must be refused' })).toHaveCount(0);
  });
});
