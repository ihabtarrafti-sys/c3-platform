import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { E2E_API_ORIGIN } from './support/ports';

/**
 * End-to-end evidence for the Tablework pilot (Comms UI-3): the Mission Comms
 * screen on its standalone frame at /missions/:id/comms.
 *
 * The arc: ops opens the conversation from the mission workspace → posts (the
 * D1 warning is present; an APR reference renders as a navigate-only card) →
 * attaches → mints an ordinary two-person obligation → delivers evidence →
 * the named authority ALONE sees Accept and
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
// Read from the harness's single source of truth rather than hardcoded: a spec
// that pins the port itself can outlive a config change and talk to a server
// this run never started (instance 57).
const API = E2E_API_ORIGIN;

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

/** Test 2 normally reuses test 1's mission, but a failed test restarts the
 *  worker (module state resets) — provision independently rather than
 *  cascading a second, misleading failure. */
async function ensureMission(page: Page, name: string): Promise<void> {
  if (missionId) return;
  await page.getByTestId('nav-missions').click();
  await page.getByTestId('add-mission-toggle').click();
  await page.getByTestId('add-mission-name').fill(name);
  await page.getByTestId('add-mission-starts').fill('2026-09-08');
  await page.getByTestId('add-mission-submit').click();
  await page.getByTestId('add-mission-submit-confirm').click();
  await page.getByRole('row', { name: new RegExp(name) }).locator('[data-testid^="mission-link-"]').click();
  missionId = /\/missions\/(MSN-\d+)/.exec(page.url())![1]!;
}

async function foregroundModule(page: Page, moduleId: string): Promise<void> {
  await page.locator(`[data-window-launcher="${moduleId}"]`).click();
  await expect(page.locator(`[data-module="${moduleId}"]`)).toBeVisible();
}

async function openObligationFloat(page: Page) {
  // Workspace OS consumes a governed click in a background window to bring
  // that window forward without acting. Foreground Obligations explicitly,
  // then exercise the action from its re-witnessed surface.
  await foregroundModule(page, 'mission-obligations');
  const trigger = page.getByRole('button', { name: 'Create obligation' });
  await trigger.click();
  const float = page.locator('dialog.float-surface[open]');
  await expect(float).toBeVisible();
  return { float, trigger };
}

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

  await test.step('Minting: the ordinary two-person record is born all-unknown', async () => {
    const { float } = await openObligationFloat(page);

    await float.getByRole('textbox', { name: 'Description' }).fill('Participant pack to publisher');
    await float.getByRole('combobox', { name: 'Accountable owner' }).selectOption({ label: 'ops@alpha.com · operations' });
    await float.getByRole('combobox', { name: 'Beneficiary', exact: true }).selectOption('external');
    await float.getByRole('textbox', { name: 'Beneficiary label' }).fill('The publisher');

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
    await foregroundModule(page, 'mission-obligations');
    await card.getByRole('button', { name: 'Accept' }).click();
    await expect(card.locator('[data-truth-state="known"]')).toHaveCount(2);
    await expect(card.locator('[data-truth-state="known"]')).toContainText(['Delivery', 'Acceptance']);
    await expect(card.locator('[data-truth-state="unknown"]')).toHaveCount(1);
    await expect(card.locator('[data-truth-state="unknown"]')).toContainText('Done');
    await expect(card.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(card.locator('[data-tablework="AcceptanceProvenance"]')).toHaveCount(0);
  });

  await test.step('Done third; the disclosed receipt reads back', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await page.goto(`/missions/${missionId}/comms`);
    const card = page.locator('[data-tablework="ObligationCard"]');
    await foregroundModule(page, 'mission-obligations');
    await card.getByRole('button', { name: 'Record Done' }).click();
    await expect(card.locator('[data-truth-state="known"]')).toHaveCount(3);
    await expect(card.locator('[data-truth-state="known"]')).toContainText(['Delivery', 'Acceptance', 'Done']);
    // The authority's read is disclosed: their cursor reached the thread's end.
    await expect(page.locator('[data-tablework="Receipts"]')).toContainText('Seen by lead@alpha.com');
    await page.screenshot({ path: `${SHOTS}/02-done-dark-desktop.png`, fullPage: true });
  });

  await test.step('The unread divider sits exactly at the reader’s cursor', async () => {
    await foregroundModule(page, 'mission-current');
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

test('Tablework Comms: same-person acceptance stays visibly distinct when superseded', async ({ page }) => {
  test.slow();
  await login(page, 'ops@alpha.com', 'operations');
  await ensureMission(page, 'Comms Self Acceptance Cup');
  await page.goto(`/missions/${missionId}/comms`);

  const { float } = await openObligationFloat(page);
  await float.getByRole('textbox', { name: 'Description' }).fill('Solo evidence acceptance');
  await float.getByRole('combobox', { name: 'Accountable owner' }).selectOption({ label: 'ops@alpha.com · operations' });
  await float.getByRole('combobox', { name: 'Beneficiary', exact: true }).selectOption('external');
  await float.getByRole('textbox', { name: 'Beneficiary label' }).fill('The publisher');
  await float.getByRole('combobox', { name: 'Accepting member' }).selectOption({ label: 'ops@alpha.com · operations' });
  await expect(float.getByText('C3 will record that same-person act plainly')).toBeVisible();
  await expect(float.getByRole('alert')).toHaveCount(0);
  await float.getByRole('textbox', { name: 'Due' }).fill('2026-09-16T16:00');
  await float.getByRole('textbox', { name: 'Evidence requirement' }).fill('Signed solo evidence pack');
  await float.getByRole('button', { name: 'Create the record' }).click();

  let card = page.locator('[data-tablework="ObligationCard"]', { hasText: 'Solo evidence acceptance' });
  await expect(card).toBeVisible();
  await expect(card.locator('[data-tablework="AcceptanceProvenance"]')).toHaveCount(0);
  await card
    .locator('input[aria-label="Deliver requested evidence"]')
    .setInputFiles({ name: 'solo-pack.png', mimeType: 'image/png', buffer: PNG });
  await expect(card.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(card.locator('[data-tablework="AcceptanceProvenance"]')).toHaveCount(0);
  await card.getByRole('button', { name: 'Accept' }).click();

  const provenance = card.locator('[data-tablework="AcceptanceProvenance"][data-acceptance-shape="self"]');
  await expect(provenance).toContainText('Same-person record');
  await expect(provenance).toContainText('ops@alpha.com both delivered evidence and accepted it as the named authority.');
  await expect(provenance).not.toHaveAttribute('data-acceptance-emphasis', 'governance-sensitive');
  await expect(card.locator('[data-truth-state]')).toHaveCount(3);

  await page.reload();
  card = page.locator('[data-tablework="ObligationCard"]', { hasText: 'Solo evidence acceptance' });
  await expect(card.locator('[data-tablework="AcceptanceProvenance"][data-acceptance-shape="self"]')).toContainText(
    'ops@alpha.com both delivered evidence and accepted it as the named authority.',
  );

  await foregroundModule(page, 'mission-obligations');
  await card.getByRole('textbox', { name: 'Reason' }).fill('The accepted record is no longer current');
  await card.getByRole('button', { name: 'Cancel' }).click();

  const superseded = card.locator(
    '[data-tablework="AcceptanceProvenance"][data-acceptance-shape="self"][data-acceptance-lifecycle="cancelled"]',
  );
  await expect(superseded).toHaveAttribute('data-acceptance-emphasis', 'governance-sensitive');
  await expect(superseded).toContainText('Superseded same-person record');
  await expect(superseded).toHaveCSS('display', 'block');
  await expect(superseded).toHaveCSS('border-left-width', '3px');

  await page.reload();
  card = page.locator('[data-tablework="ObligationCard"]', { hasText: 'Solo evidence acceptance' });
  await expect(
    card.locator('[data-tablework="AcceptanceProvenance"][data-acceptance-emphasis="governance-sensitive"]'),
  ).toContainText('Before cancellation, ops@alpha.com both delivered evidence and accepted it as the named authority.');
});

test('Tablework Comms: lapse posture, keyboard contract, reduced-effects glass collapse', async ({ page }) => {
  test.slow();

  await test.step('Keyboard: the skip-link is the first stop and lands in the Room', async () => {
    await login(page, 'ops@alpha.com', 'operations');
    await ensureMission(page, 'Comms Shell Cup');
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
    const { float, trigger } = await openObligationFloat(page);
    const backdrop = await float.evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(backdrop).toBe('none'); // glass collapsed — the reduced-effects law
    await page.keyboard.press('Escape');
    await expect(float).toBeHidden();
    await expect(trigger).toBeFocused(); // native dialog focus-return
    await page.evaluate(() => localStorage.setItem('c3-effects', 'full'));
  });

  await test.step('Lapse: the write is refused, the posture flips, reads and own-prefs stay live', async () => {
    // This test may run in a fresh worker after an earlier failure. Earn its
    // retained-history claim here instead of borrowing another test's message.
    await foregroundModule(page, 'mission-current');
    await page.locator('#thread-message').fill('Baseline history remains readable.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('[data-tablework="Message"]', { hasText: 'Baseline history remains readable.' })).toBeVisible();

    await page.request.post(`${API}/__e2e/comms-entitlement`, { data: { state: 'lapsed' } });
    await page.reload();
    await foregroundModule(page, 'mission-current');
    await page.locator('#thread-message').fill('This send must be refused.');
    await page.getByRole('button', { name: 'Send' }).click();

    // The truthful flip: banner up, composer REMOVED, obligation actions gone —
    // the retained history still reads.
    await expect(page.locator('[data-tablework="LapsedBanner"]')).toContainText('read-only');
    await expect(page.locator('.compose')).toHaveCount(0);
    await expect(page.locator('[data-tablework="ObligationActions"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create obligation' })).toHaveCount(0);
    await expect(page.locator('[data-tablework="Message"]', { hasText: 'Baseline history remains readable.' })).toBeVisible();
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
