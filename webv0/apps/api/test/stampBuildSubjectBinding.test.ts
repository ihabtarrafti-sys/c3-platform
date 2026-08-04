import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const webv0Root = fileURLToPath(new URL('../../../', import.meta.url));
const tsx = join(webv0Root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const stampBuild = join(webv0Root, 'apps', 'api', 'scripts', 'stampBuild.mts');
const approvedSharedRemote = /^https:\/\/github\.com\/ihabtarrafti-sys\/c3-platform(?:\.git)?\/?$/i;
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function locallyBackedOrigin(): { work: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'c3-stamp-origin-'));
  temporaryRoots.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');

  git(root, 'init', '--bare', origin);
  git(root, 'init', work);
  git(work, 'config', 'user.name', 'Crucible Fixture');
  git(work, 'config', 'user.email', 'crucible@example.invalid');
  writeFileSync(join(work, 'subject.txt'), 'subject-bound fixture\n', 'utf8');
  git(work, 'add', 'subject.txt');
  git(work, 'commit', '-m', 'fixture');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', 'origin', 'HEAD:refs/heads/master');
  git(work, 'fetch', 'origin');
  return { work, origin };
}

describe('stampBuild binds “shared remote” to the remote subject', () => {
  it('CR-SWEEP-05: refuses a same-machine repository merely named origin', () => {
    const fixture = locallyBackedOrigin();
    const rawOrigin = git(fixture.work, 'config', '--get', 'remote.origin.url');

    // Independent fixture oracles: this is the wrong subject while every
    // currently implemented refusal route is satisfied.
    expect(rawOrigin).toBe(fixture.origin);
    expect(rawOrigin).not.toMatch(approvedSharedRemote);
    expect(git(fixture.work, 'status', '--porcelain')).toBe('');

    const head = git(fixture.work, 'rev-parse', 'HEAD');
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', head, 'origin/master'], {
      cwd: fixture.work,
      encoding: 'utf8',
    });
    expect(ancestry.status, `fixture must satisfy the ancestry guard:\n${ancestry.stderr}`).toBe(0);

    const result = spawnSync(process.execPath, [tsx, stampBuild], {
      cwd: fixture.work,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const diagnostic = `status=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

    expect(result.error, diagnostic).toBeUndefined();
    // RED now: stampBuild exits 0 and prints the production ceremony.
    expect(
      result.status,
      `a local origin is not evidence of an off-machine shared repository\n${diagnostic}`,
    ).not.toBe(0);
  });
});
