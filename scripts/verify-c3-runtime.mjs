/**
 * verify-c3-runtime.mjs
 *
 * Sprint 21 Phase 4 — Verification helper for the C3 SPFx runtime bundle.
 *
 * Checks:
 *   1. Build output exists and is non-empty:
 *        packages/c3/dist-runtime/c3-runtime.js  (gitignored — only present after build)
 *   2. Committed SPFx asset copy exists and is non-empty:
 *        packages/c3-spfx-host/src/webparts/c3Host/assets/c3-runtime/c3-runtime.js
 *   3. Both files have the same SHA-256 hash (confirms copy ran after the latest build).
 *
 * Prints: file sizes, last-modified timestamps, full SHA-256 hashes, PASS / FAIL result.
 * Exits 0 if all checks pass. Exits 1 if any check fails.
 *
 * Uses only Node built-ins: node:fs, node:path, node:crypto.
 *
 * Usage:
 *   npm run verify:runtime
 *   (Intended to run after: npm run beta:runtime)
 */

import fs     from 'node:fs';
import path   from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = process.cwd();

const SOURCE = path.join(ROOT, 'packages', 'c3', 'dist-runtime', 'c3-runtime.js');
const TARGET = path.join(
  ROOT,
  'packages', 'c3-spfx-host', 'src', 'webparts', 'c3Host',
  'assets', 'c3-runtime', 'c3-runtime.js',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  if (n >= 1024)        return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function fmtTime(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Check a file and print a report row.
 * Returns { stat, hash } on success, null on failure.
 */
function checkFile(label, filePath) {
  console.log(`  ${label}`);
  console.log(`  ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.log('  ✗  NOT FOUND\n');
    return null;
  }

  const stat = fs.statSync(filePath);

  if (stat.size === 0) {
    console.log('  ✗  EXISTS BUT EMPTY\n');
    return null;
  }

  const hash = sha256(filePath);
  console.log(`  ✓  ${fmtBytes(stat.size)}  |  modified ${fmtTime(stat.mtime)}`);
  console.log(`     SHA-256: ${hash}\n`);
  return { stat, hash };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('\n════════════════════════════════════════════════════');
console.log(' C3 Runtime Bundle Verification');
console.log('════════════════════════════════════════════════════\n');

let ok = true;

console.log('── Build output (gitignored — must run beta:runtime first) ──\n');
const src = checkFile('dist-runtime:', SOURCE);
if (!src) ok = false;

console.log('── Committed SPFx host asset ──\n');
const tgt = checkFile('spfx-host asset:', TARGET);
if (!tgt) ok = false;

// Hash comparison — only if both files were readable
if (src && tgt) {
  console.log('── Hash comparison ──\n');
  if (src.hash === tgt.hash) {
    console.log('  ✓  SHA-256 hashes match — bundle is in sync.\n');
  } else {
    console.log('  ✗  SHA-256 MISMATCH — build output and committed copy differ.');
    console.log('     The copy was not run after the last build, or a file was modified.');
    console.log('     Run:  npm run beta:runtime');
    console.log('     Then: git add packages/c3-spfx-host/.../c3-runtime.js');
    console.log('           git commit -m "build(...): Update SPFx runtime bundle"\n');
    ok = false;
  }
}

console.log('════════════════════════════════════════════════════');
if (ok) {
  console.log(' PASS — runtime bundle is verified and ready to commit.');
} else {
  console.log(' FAIL — one or more checks did not pass. See above.');
}
console.log('════════════════════════════════════════════════════\n');

process.exit(ok ? 0 : 1);
