/**
 * nul-audit.mts — NUL-byte / truncation audit for the Web V0 npm root.
 *
 * Guards against the encoding corruption class this repo has hit before
 * (UTF-16/NUL bytes smuggled into source, zero-byte files, truncated JSON).
 * Scans every git-TRACKED file under webv0/ (plus the repo-root CI workflow);
 * fails on:
 *   - any NUL (0x00) byte in a tracked text file;
 *   - a zero-byte tracked file;
 *   - unparseable committed JSON.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const webv0Root = join(dirname(fileURLToPath(import.meta.url)), '..');

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.zip']);

const tracked = execSync('git ls-files -z', { cwd: webv0Root, encoding: 'utf8', maxBuffer: 64e6 })
  .split('\0')
  .filter(Boolean)
  .map((f) => join(webv0Root, f));

// The CI workflow lives at the repository root (.github must be top-level).
const ciWorkflow = join(webv0Root, '..', '.github', 'workflows', 'webv0-ci.yml');
if (existsSync(ciWorkflow)) tracked.push(ciWorkflow);

let failures = 0;
for (const path of tracked) {
  const ext = path.slice(path.lastIndexOf('.'));
  const size = statSync(path).size;
  if (size === 0) {
    console.error(`✖ zero-byte tracked file: ${path}`);
    failures++;
    continue;
  }
  if (BINARY_EXT.has(ext)) continue;
  const buf = readFileSync(path);
  if (buf.includes(0)) {
    console.error(`✖ NUL byte found in: ${path}`);
    failures++;
  }
  if (ext === '.json') {
    try {
      JSON.parse(buf.toString('utf8'));
    } catch {
      console.error(`✖ committed JSON does not parse: ${path}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\nwebv0 NUL/truncation audit: FAILED (${failures} finding(s))`);
  process.exit(1);
}
console.log(`webv0 NUL/truncation audit: ${tracked.length} tracked files clean`);
