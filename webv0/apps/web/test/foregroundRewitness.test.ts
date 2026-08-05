import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(import.meta.dirname, '..', 'src');
const read = (relative: string): string => readFileSync(join(srcDir, relative), 'utf8');

/**
 * Source-ownership contract only: runtime truth behavior remains exercised by
 * irisWorkspaceShell plus the workspace browser journeys. These checks make
 * the extraction boundary explicit so a module cannot quietly grow a second,
 * divergent foreground lifecycle.
 */
describe('foreground re-witness source ownership', () => {
  it('keeps the before-paint, exposure-restoration, and cancellation lifecycle in one hook', () => {
    const hook = read('tablework/useForegroundRewitness.ts');

    expect(hook).toContain('const enteredForeground = foreground && !previousForeground.current;');
    expect(hook).toContain('useLayoutEffect(() => {');
    expect(hook).toContain('if (!foregroundRef.current || !enabledRef.current || rewitnessingRef.current) return;');
    expect(hook).toContain("window.addEventListener('focus', restoreExposure)");
    expect(hook).toContain("document.addEventListener('visibilitychange', onVisibilityChange)");
    expect(hook).toContain('requestRef.current += 1;');
    expect(hook).toContain('return rewitnessing || enteredForeground;');
  });

  it('makes Finance delegate with its capability-derived query gate', () => {
    const finance = read('pages/MissionFinancePage.tsx');

    expect(finance).toContain('queryEnabled = enabled && canView');
    expect(finance).toContain('const query = useMissionsFinanceSummary(queryEnabled);');
    expect(finance).toContain('const rewitnessing = useForegroundRewitness({');
    expect(finance).toContain('enabled: queryEnabled,');
    expect(finance).toContain('isFetching: isFetching || rewitnessing,');
    expect(finance).not.toContain("window.addEventListener('focus'");
    expect(finance).not.toContain("document.addEventListener('visibilitychange'");
  });
});
