// gen-pwa-icons.mjs — rasterize the brand symbol into PWA PNG icons using
// playwright-core (already a dev dep; no image toolchain needed). Produces the
// icon set the manifest references. Re-run if the brand symbol changes.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const symbol = readFileSync(join(here, '..', 'public', 'brand', 'c3-symbol-white.svg'), 'utf8');
const BRAND = '#4f46e5'; // indigo-600 — the C3 brand tile

// One page renders a centered white symbol on the brand tile; `pad` is the
// fraction of empty margin (maskable icons need a safe zone).
function html(pad) {
  const inset = `${pad * 100}%`;
  return `<!doctype html><html><body style="margin:0"><div style="width:512px;height:512px;background:${BRAND};display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:${inset}">
    <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">${symbol}</div>
  </div></body></html>`;
}

const exe = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true });

async function render(pad, size, name) {
  const page = await browser.newPage({ viewport: { width: 512, height: 512}, deviceScaleFactor: size / 512 });
  await page.setContent(html(pad), { waitUntil: 'networkidle' });
  const el = await page.$('div');
  const buf = await el.screenshot({ type: 'png' });
  writeFileSync(join(outDir, name), buf);
  await page.close();
  console.log(`wrote icons/${name} (${size}px)`);
}

// any-purpose icons (tight), maskable (safe-zone padded), apple-touch.
await render(0.14, 192, 'icon-192.png');
await render(0.14, 512, 'icon-512.png');
await render(0.22, 512, 'icon-maskable-512.png');
await render(0.14, 180, 'apple-touch-icon.png');

await browser.close();
console.log('PWA icons generated.');
