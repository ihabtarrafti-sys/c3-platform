/**
 * prodHeaders.test.ts — the two production Content-Security-Policy sources
 * (Cloudflare Pages `public/_headers` and the container `nginx.conf`) must stay
 * in sync on `img-src`. M-10: person photos are rendered from `blob:` object
 * URLs (PersonAvatar → URL.createObjectURL), so a CSP that omits `blob:` from
 * `img-src` silently degrades a shipped feature to initials in production only.
 * This pins `blob:` into both sources so a future CSP edit can't regress it
 * without turning this test red.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Pull the img-src directive out of the first CSP string found in a file. */
function imgSrc(fileText: string): string {
  const csp = fileText.match(/Content-Security-Policy[:"\s]*([^"\n]+)/)?.[1] ?? '';
  const directive = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('img-src'));
  expect(directive, `no img-src in CSP: ${csp}`).toBeTruthy();
  return directive!;
}

describe('production CSP img-src (M-10)', () => {
  const sources: Record<string, string> = {
    '_headers': join(webRoot, 'public', '_headers'),
    'nginx.conf': join(webRoot, 'nginx.conf'),
  };

  for (const [label, path] of Object.entries(sources)) {
    it(`${label} allows blob: (person photo object URLs) and data:`, () => {
      const text = readFileSync(path, 'utf8');
      // nginx.conf carries the CSP twice (server + location); every occurrence must allow blob:.
      const all = text.match(/img-src[^;"]+/g) ?? [];
      expect(all.length, `expected at least one img-src in ${label}`).toBeGreaterThan(0);
      for (const directive of all) {
        expect(directive, `${label}: ${directive}`).toContain("'self'");
        expect(directive, `${label}: ${directive}`).toContain('data:');
        expect(directive, `${label}: ${directive}`).toContain('blob:');
      }
    });
  }

  it('the two sources agree on img-src (Pages mirrors the container)', () => {
    const a = imgSrc(readFileSync(sources['_headers']!, 'utf8'));
    const b = imgSrc(readFileSync(sources['nginx.conf']!, 'utf8'));
    expect(a).toBe(b);
  });
});
