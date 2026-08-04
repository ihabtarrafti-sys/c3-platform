/**
 * deployCeremony.test.ts — the ceremony is RENDERED and read, not type-checked.
 *
 * ⛔ WHY THIS TEST EXISTS. The production deploy ceremony has shipped two
 * operator-facing defects, and a human running it caught BOTH:
 *
 *   1. bare `railway …` — the owner hit `The term 'railway' is not recognized`
 *      mid-deploy, because the text assumed a global install.
 *   2. an UNPINNED `railway up` (CR-029) — run from `webv0/`, which is linked to
 *      STAGING, in a ceremony whose verification step names `api.c3hq.org`.
 *
 * ⚖️ `tsc` passed both times, and it always will: **a template literal is
 * type-correct no matter what it says.** The only thing that can catch a wrong
 * VALUE is something that renders it and reads the result. A backtick inside one
 * of these literals once produced a runtime error that type-checked cleanly, and
 * the test that caught it rendered `csp.mts`'s output. Same shape, same reason.
 *
 * ⚠️ THE PIN CHECK ENUMERATES THE SURFACE RATHER THAN LISTING THE COMMANDS.
 * A test asserting "these three commands are pinned" is a SUBSET of the ceremony,
 * not a seal on it (LAW 27) — a fourth command added later would be unpinned and
 * the test would still pass, which is exactly how CR-029 got in. So it finds
 * EVERY CLI invocation in the rendered text and requires each one to be pinned.
 */
import { describe, expect, it } from 'vitest';
import {
  API_ORIGIN,
  CANONICAL_REPO,
  PIN,
  PROJECT,
  RAILWAY,
  SERVICE,
  githubRepoIdentity,
  isCanonicalSharedRemote,
  renderCeremony,
} from '../scripts/ceremony.mjs';

const TOKEN = '93ba330d4bea';
const HEAD = 'a5885f05f473769049ea41e6a6adbf98cedb4400';
const CEREMONY = renderCeremony(TOKEN, HEAD);

/** Every line that invokes the Railway CLI, whatever the subcommand. */
function railwayCommandLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('@railway/cli') || /(^|\s)railway\s/.test(l));
}

describe('⛔ every Railway command names its target explicitly (CR-029)', () => {
  it('finds the CLI invocations at all — the check has something to check', () => {
    // Guards the enumerator itself: a regex that matches nothing would make every
    // assertion below vacuously true, which is the muted-instrument failure.
    expect(railwayCommandLines(CEREMONY).length).toBeGreaterThanOrEqual(3);
  });

  it('⛔ EVERY invocation carries the project pin — no exceptions, no list', () => {
    for (const line of railwayCommandLines(CEREMONY)) {
      expect(line, `unpinned Railway command would resolve via the ambient STAGING link: ${line}`).toContain(
        `-p ${PROJECT}`,
      );
    }
  });

  it('the two MUTATING commands also pin the service', () => {
    // `status` takes no --service (checked against the CLI's own --help); the
    // commands that CHANGE something must name the service as well as the project.
    for (const line of railwayCommandLines(CEREMONY).filter((l) => /\bup\b|variable set/.test(l))) {
      expect(line, `a mutating command must name its service: ${line}`).toContain(`-s ${SERVICE}`);
    }
  });

  it('⛳ the detector can FAIL — an unpinned command is caught', () => {
    // Positive control. Without this, a pin check that silently matched nothing
    // would report the same green as a correct one (LAW 29: right by coincidence).
    const sabotaged = CEREMONY.replace(` up ${PIN}`, ' up');
    expect(sabotaged, 'the sabotage must actually change the text').not.toBe(CEREMONY);
    const unpinned = railwayCommandLines(sabotaged).filter((l) => !l.includes(`-p ${PROJECT}`));
    expect(unpinned.length, 'the check must notice the command it was built to notice').toBe(1);
  });
});

describe('⛔ `origin` is a nickname — the remote SUBJECT is pinned (CR-028)', () => {
  it('accepts the canonical repository over https, with or without .git', () => {
    expect(isCanonicalSharedRemote('https://github.com/ihabtarrafti-sys/c3-platform')).toBe(true);
    expect(isCanonicalSharedRemote('https://github.com/ihabtarrafti-sys/c3-platform.git')).toBe(true);
    expect(isCanonicalSharedRemote('https://github.com/ihabtarrafti-sys/c3-platform/')).toBe(true);
  });

  it('⚖️ TRANSPORT IS NOT IDENTITY — an ssh clone is the same shared repository', () => {
    // Refusing ssh would reject a legitimate clone for a reason unrelated to the
    // threat. What is being pinned is which repository, not how it is reached.
    expect(isCanonicalSharedRemote('git@github.com:ihabtarrafti-sys/c3-platform.git')).toBe(true);
    expect(isCanonicalSharedRemote('ssh://git@github.com/ihabtarrafti-sys/c3-platform')).toBe(true);
  });

  it('is case-insensitive about the repository name, as GitHub is', () => {
    expect(isCanonicalSharedRemote('https://github.com/IhabTarrafti-Sys/C3-Platform')).toBe(true);
  });

  it('⛔ REFUSES a local path merely NAMED origin — the finding itself', () => {
    expect(isCanonicalSharedRemote('/tmp/c3-stamp-origin-abc/origin.git')).toBe(false);
    expect(isCanonicalSharedRemote('C:\\Users\\x\\AppData\\Local\\Temp\\origin.git')).toBe(false);
    expect(isCanonicalSharedRemote('file:///tmp/origin.git')).toBe(false);
  });

  it('⛔ REFUSES lookalikes — a permissive pattern would be the same defect', () => {
    // Each of these contains the canonical string somewhere. A substring check
    // would admit all of them; that class of error already shipped once here in
    // the CSP verifier, which is why this is exact-token matching.
    for (const hostile of [
      'https://github.com/attacker/c3-platform',
      'https://github.com/ihabtarrafti-sys/c3-platform-evil',
      'https://github.com.evil.test/ihabtarrafti-sys/c3-platform',
      'https://notgithub.com/ihabtarrafti-sys/c3-platform',
      'https://github.com/ihabtarrafti-sys/c3-platform/extra',
      'https://gitlab.com/ihabtarrafti-sys/c3-platform',
    ]) {
      expect(isCanonicalSharedRemote(hostile), `must refuse ${hostile}`).toBe(false);
    }
  });

  it('reports a non-GitHub remote as having no identity at all', () => {
    expect(githubRepoIdentity('/tmp/origin.git')).toBeNull();
    expect(githubRepoIdentity('https://github.com/ihabtarrafti-sys/c3-platform')).toBe(CANONICAL_REPO);
  });
});

describe('⛔ the printed commands are RUNNABLE as printed', () => {
  it('uses the npx form, never a bare `railway` that assumes a global install', () => {
    for (const line of railwayCommandLines(CEREMONY)) {
      expect(line, `a bare \`railway\` is not runnable on a machine without a global install: ${line}`).toContain(
        RAILWAY,
      );
    }
  });

  it('⛔ nothing is left unrendered — no template placeholder survives', () => {
    // The failure mode a backtick slip produces: text that looks fine to tsc and
    // ships a literal `${...}` to the operator.
    expect(CEREMONY).not.toMatch(/\$\{/);
    expect(CEREMONY).not.toContain('undefined');
    expect(CEREMONY).not.toContain('[object Object]');
  });
});

describe('⚖️ the witness halves stay coupled', () => {
  it('`--skip-deploys` rides the variable set — the freshness half depends on it', () => {
    const setLine = railwayCommandLines(CEREMONY).find((l) => l.includes('variable set'));
    expect(setLine).toBeDefined();
    expect(setLine, 'without --skip-deploys the deploymentId moves before step 3 ships').toContain('--skip-deploys');
  });

  it('the token in the set command is the token the header announced', () => {
    // Two places state the token. If they can disagree, the operator can ship a
    // stamp naming a commit the verifier will not expect.
    expect(CEREMONY).toContain(`[stamp] token ${TOKEN}`);
    expect(CEREMONY).toContain(`C3_BUILD_TOKEN=${TOKEN}`);
  });

  it('⛔ verification is PROJECT-SCOPED — the same project the deploy was pinned to (CR-029)', () => {
    // Without this the verifier compares a before-id and an after-id that may come
    // from different projects, and calls their difference a successful deploy.
    expect(CEREMONY).toContain(`<before-deployment-id> ${PROJECT}`);
  });

  it('verification targets the production origin and the FULL commit sha', () => {
    expect(CEREMONY).toContain(`verifyVersion.mts ${API_ORIGIN} ${HEAD}`);
    // The short sha appears in the header for humans; the verifier needs the full
    // one, because the token is computed from it.
    expect(CEREMONY).toContain(`commit ${HEAD.slice(0, 12)}`);
  });

  it('the steps are printed in the order the witness requires', () => {
    const at = (needle: string) => CEREMONY.indexOf(needle);
    expect(at('status --json')).toBeGreaterThan(-1);
    expect(at('variable set')).toBeGreaterThan(at('status --json'));
    expect(at(`up ${PIN}`)).toBeGreaterThan(at('variable set'));
    expect(at('verifyVersion.mts')).toBeGreaterThan(at(`up ${PIN}`));
  });
});
