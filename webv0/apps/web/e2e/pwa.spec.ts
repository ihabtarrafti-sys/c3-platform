import { test, expect } from '@playwright/test';

/**
 * Track B5 — installable PWA metadata. The service worker registers only in a
 * production build (the E2E stack runs the dev server), so this spec proves
 * the install metadata SHIPS: the manifest is linked, fetches as valid JSON
 * with real icons, and the apple-touch-icon + theme-color are present. The
 * service worker and offline shell are verified on the live (HTTPS) staging.
 */

test('PWA: the manifest and install metadata are wired', async ({ page }) => {
  await page.goto('/');

  // The head links the manifest, the apple touch icon, and a theme color.
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0a0c14');

  // The manifest fetches and declares standalone display + a 512px icon.
  const res = await page.request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.name).toContain('C3');
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);

  // The icons are real, served assets.
  expect((await page.request.get('/icons/icon-512.png')).status()).toBe(200);
});
