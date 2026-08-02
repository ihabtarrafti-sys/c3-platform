/**
 * emitHeaders.mts — writes `dist/_headers` after `vite build`.
 *
 * ⛔ IT REFUSES RATHER THAN GUESSES. Without `VITE_API_BASE_URL` there is no
 * honest `connect-src`, so this exits non-zero and the build fails. It does not
 * fall back to a default, and it does not emit a permissive policy: a build that
 * cannot say which API it talks to must not produce a security header claiming
 * it knows.
 *
 * That is the whole lesson of the P0 it exists to prevent — the previous file
 * had a hardcoded staging origin, so a production build produced a confident,
 * wrong policy instead of a loud failure.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { apiOriginFrom, buildHeadersFile } from './csp.mjs';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(webRoot, 'dist');

const apiBaseUrl = process.env.VITE_API_BASE_URL;
if (!apiBaseUrl) {
  console.error(
    '[emit-headers] REFUSING: VITE_API_BASE_URL is not set.\n' +
      '  The CSP connect-src is derived from it, so without it this build cannot state\n' +
      '  which API the app may reach. Set it (the same value the app builds against) and\n' +
      '  re-run. A default here would be how production shipped staging\'s origin.',
  );
  process.exit(1);
}

let origin: string;
try {
  origin = apiOriginFrom(apiBaseUrl);
} catch (err) {
  console.error(`[emit-headers] REFUSING: ${(err as Error).message}`);
  process.exit(1);
}

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, '_headers'), buildHeadersFile(origin), 'utf8');
console.log(`[emit-headers] dist/_headers written — connect-src permits ${origin}`);
