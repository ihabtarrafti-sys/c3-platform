/**
 * verify-entra-bundle.mts — proves the PRODUCTION (entra) web bundle contains
 * no development-login control, route reference, or dev-auth material.
 *
 * Builds apps/web with VITE_AUTH_PROVIDER=entra into a throwaway outDir, then
 * scans every emitted asset for dev-auth markers. The build-time constant
 * IS_ENTRA dead-code-eliminates the dev sign-in UI and dev AuthClient; this
 * script is the enforcement that the elimination actually happened.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const webv0Root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(webv0Root, 'apps', 'web');
const outDir = join(webDir, 'dist-entra-verify');

const MARKERS = [
  'dev/login', // the dev login route
  'adoptDevLogin', // dev AuthClient surface
  'login-role', // dev form test ids
  'login-submit',
  'login-tenant',
  'Development identity provider', // dev sign-in copy
  'DEV_AUTH_SECRET',
];

rmSync(outDir, { recursive: true, force: true });

const res = spawnSync(
  process.execPath,
  [join(webDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', webDir, '--outDir', outDir, '--emptyOutDir'],
  {
    cwd: webv0Root,
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_AUTH_PROVIDER: 'entra',
      VITE_API_BASE_URL: 'https://api.staging.c3hq.org',
      VITE_ENTRA_CLIENT_ID: '00000000-0000-0000-0000-00000000cafe',
      VITE_ENTRA_TENANT_ID: '00000000-0000-0000-0000-00000000beef',
      VITE_ENTRA_API_SCOPE: 'api://00000000-0000-0000-0000-00000000f00d/C3.Access',
    },
  },
);
if (res.status !== 0) {
  console.error(res.stdout);
  console.error(res.stderr);
  console.error('entra production build FAILED');
  process.exit(1);
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

if (!existsSync(outDir)) {
  console.error('entra build produced no output directory');
  process.exit(1);
}

let scanned = 0;
const findings: string[] = [];
for (const file of walk(outDir)) {
  scanned++;
  const content = readFileSync(file, 'utf8');
  for (const marker of MARKERS) {
    if (content.includes(marker)) findings.push(`${marker} -> ${file}`);
  }
}

rmSync(outDir, { recursive: true, force: true });

if (findings.length > 0) {
  console.error('✖ dev-auth material found in the entra production bundle:');
  for (const f of findings) console.error('  ', f);
  process.exit(1);
}
console.log(`entra bundle verification: ${scanned} emitted files contain no dev-login control or dev-auth material`);
