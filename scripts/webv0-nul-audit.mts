/**
 * webv0-nul-audit.mts — NUL-byte / truncation audit for the Web V0 surface.
 *
 * Guards against the encoding corruption class this repo has hit before
 * (UTF-16/NUL bytes smuggled into source, zero-byte files, truncated JSON).
 * Scans every git-TRACKED file under the Web V0 paths; fails on:
 *   - any NUL (0x00) byte in a tracked text file;
 *   - a zero-byte tracked file;
 *   - unparseable committed JSON (package manifests, OpenAPI artifacts).
 */
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCOPES = [
  'apps/',
  'packages/domain/',
  'packages/authz/',
  'packages/api-contracts/',
  'packages/application/',
  'packages/persistence/',
  'packages/test-support/',
  'infra/',
  '.github/',
  'scripts/webv0-',
  'tsconfig.base.json',
  'vitest.workspace.ts',
  '.env.example',
];

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.zip']);

const tracked = execSync('git ls-files -z', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64e6 })
  .split('\0')
  .filter((f) => f && SCOPES.some((s) => f.startsWith(s)));

let failures = 0;
for (const file of tracked) {
  const path = join(repoRoot, file);
  const ext = file.slice(file.lastIndexOf('.'));
  const size = statSync(path).size;
  if (size === 0) {
    console.error(`✖ zero-byte tracked file: ${file}`);
    failures++;
    continue;
  }
  if (BINARY_EXT.has(ext)) continue;
  const buf = readFileSync(path);
  if (buf.includes(0)) {
    console.error(`✖ NUL byte found in: ${file}`);
    failures++;
  }
  if (ext === '.json') {
    try {
      JSON.parse(buf.toString('utf8'));
    } catch {
      console.error(`✖ committed JSON does not parse: ${file}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\nwebv0 NUL/truncation audit: FAILED (${failures} finding(s))`);
  process.exit(1);
}
console.log(`webv0 NUL/truncation audit: ${tracked.length} tracked files clean`);
