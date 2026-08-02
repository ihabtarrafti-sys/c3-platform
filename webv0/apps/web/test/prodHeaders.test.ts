/**
 * prodHeaders.test.ts — the production Content-Security-Policy.
 *
 * ⚖️ THIS FILE USED TO CARRY A CASE NAMED `'the two sources agree on img-src
 * (Pages mirrors the container)'` WHOSE ASSERTION COVERED `img-src` ALONE.
 * `connect-src` was unasserted in both sources, so **1,202 tests passed while
 * production's web app was forbidden to reach production's API and permitted to
 * reach staging's.** The name claimed the documents were in sync; the code
 * proved one directive was.
 *
 * ⛔ THE RULE THAT FOLLOWS: **a test's name is a claim, and it must not exceed
 * its assertions.** Either the name shrinks to what is proven or the assertions
 * grow to the name. Here they grew.
 *
 * ⚠️ AND THE DEFECT WAS INVISIBLE TO EVERY TOOL WE USE: only a browser enforces
 * CSP, so `curl` against the API returned 200 the whole time. A policy can only
 * be checked by reading it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiOriginFrom, buildCsp, buildHeadersFile } from '../scripts/csp.mjs';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const STAGING_API = 'https://api.staging.c3hq.org';
const PRODUCTION_API = 'https://api.c3hq.org';

/** Every CSP string in a file (nginx carries it twice: server + location). */
function allCsp(text: string): string[] {
  return (text.match(/Content-Security-Policy[:"\s]*([^"\n]+)/g) ?? []).map((m) =>
    m.replace(/^Content-Security-Policy[:"\s]*/, '').trim(),
  );
}

function directive(csp: string, name: string): string {
  const found = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);
  expect(found, `no ${name} in CSP: ${csp}`).toBeTruthy();
  return found!;
}

describe('the CSP is DERIVED from the build’s own API origin', () => {
  it('⛔ each environment permits exactly its own API — and NOT the other’s', () => {
    // This is the whole P0, pinned. Production permitting staging is not a
    // lesser bug than production forbidding production: it is the same defect
    // seen from the other side.
    const prod = buildCsp(apiOriginFrom(PRODUCTION_API));
    expect(prod).toContain(PRODUCTION_API);
    expect(prod, 'production must NOT permit staging’s API').not.toContain(STAGING_API);

    const staging = buildCsp(apiOriginFrom(STAGING_API));
    expect(staging).toContain(STAGING_API);
    expect(staging, 'staging must NOT permit production’s API').not.toContain(PRODUCTION_API);
  });

  it('no environment origin is hardcoded anywhere in the generator', () => {
    // The origin may only arrive as an argument. A literal here would be the
    // same class of defect returning: a value that should be derived, written
    // down instead.
    const source = readFileSync(join(webRoot, 'scripts', 'csp.mts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'csp.mts code must not name an API host').not.toMatch(/api\.(staging\.)?c3hq\.org/);
  });

  it('⛔ the static public/_headers is GONE — a generator beside a stale file is two sources', () => {
    expect(
      existsSync(join(webRoot, 'public', '_headers')),
      'public/_headers must not exist: it would ship instead of the generated one',
    ).toBe(false);
  });

  it('a non-https API origin is refused rather than policed loosely', () => {
    expect(() => apiOriginFrom('http://api.example.org')).toThrow(/non-https/i);
    // localhost stays usable for local work.
    expect(apiOriginFrom('http://localhost:4100')).toBe('http://localhost:4100');
  });

  it('the emitted file carries the derived policy and says it is generated', () => {
    const emitted = buildHeadersFile(apiOriginFrom(PRODUCTION_API));
    expect(emitted).toContain(`connect-src 'self' ${PRODUCTION_API} https://login.microsoftonline.com`);
    expect(emitted).toMatch(/GENERATED — do not edit/);
    // The /sw.js claim that was falsified by production's first deploy must not
    // come back: the rule governs steady state, it does not win a new domain's
    // first deploy.
    expect(emitted).not.toMatch(/prevent recurrence/);
    expect(emitted).toMatch(/MANUAL EDGE PURGE/i);
  });
});

describe('the container path (nginx.conf) — differences are DECISIONS, not drift', () => {
  const nginx = readFileSync(join(webRoot, 'nginx.conf'), 'utf8');

  it('every nginx CSP allows blob: and data: in img-src (M-10 person photos)', () => {
    const policies = allCsp(nginx);
    expect(policies.length, 'nginx must carry its CSP on server AND location').toBeGreaterThan(1);
    for (const csp of policies) {
      const img = directive(csp, 'img-src');
      expect(img).toContain("'self'");
      expect(img).toContain('data:');
      expect(img).toContain('blob:');
    }
  });

  it('nginx and the generated policy agree on EVERY directive except connect-src', () => {
    // The old test compared img-src only. This compares all of them, so a
    // future edit to either source that silently diverges fails here by name.
    const generated = buildCsp(apiOriginFrom(PRODUCTION_API));
    const names = generated.split(';').map((d) => d.trim().split(' ')[0]!);
    for (const csp of allCsp(nginx)) {
      for (const name of names) {
        if (name === 'connect-src') continue; // the one deliberate difference, asserted below
        expect(directive(csp, name), `nginx ${name} must match the generated policy`).toBe(
          directive(generated, name),
        );
      }
    }
  });

  it('⚖️ nginx’s connect-src is DELIBERATELY looser, and that is recorded rather than discovered', () => {
    // The container image is built without a per-environment API origin, so it
    // cannot derive one; it permits https: generally. That is weaker, and it is
    // acceptable ONLY because the container path is not how staging or
    // production deploy — both are Cloudflare Pages. If the container ever
    // becomes a deployment target, this difference must be closed before it is,
    // and this assertion is where that conversation starts.
    for (const csp of allCsp(nginx)) {
      expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https:");
    }
  });
});
