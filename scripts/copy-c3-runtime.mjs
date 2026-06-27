import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const source = path.join(
  root,
  'packages',
  'c3',
  'dist-runtime',
  'c3-runtime.js',
);

const targetDir = path.join(
  root,
  'packages',
  'c3-spfx-host',
  'src',
  'webparts',
  'c3Host',
  'assets',
  'c3-runtime',
);

const target = path.join(targetDir, 'c3-runtime.js');

if (!fs.existsSync(source)) {
  throw new Error(`C3 runtime bundle not found: ${source}`);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);

console.log(`Copied C3 runtime to ${target}`);