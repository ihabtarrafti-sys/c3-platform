/**
 * Iris Mission Command — the first in-place transformation contract.
 *
 * This guard is intentionally about mechanisms, not a screenshot:
 *  - one mission opens as three independently controllable modules while six
 *    cross-route and command-loop modules remain closed until requested;
 *  - window state survives navigation/reload, but malformed device state does not;
 *  - minimize, close, reopen, move, resize, and presets are deterministic;
 *  - a dead live channel makes previously witnessed module data stale centrally;
 *  - Iris is the default face while Afterglow remains an explicit option.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MISSION_COMMAND,
  isActionableWitness,
  missionCommandReducer,
  restoreMissionCommand,
  withModuleChannelTruth,
} from '../src/tablework/missionCommandModel';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (relative: string): string => readFileSync(join(srcDir, relative), 'utf8');

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/../g)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe('Iris Mission Command workspace model', () => {
  it('opens one mission as three real modules and keeps six adjacent command modules closed in Commander', () => {
    expect(DEFAULT_MISSION_COMMAND.layout).toBe('commander');
    expect(DEFAULT_MISSION_COMMAND.windows.map((window) => window.id)).toEqual([
      'mission-field',
      'mission-current',
      'mission-obligations',
      'mission-finance',
      'approvals-register',
      'calendar-horizon',
      'command-constellation',
      'command-attention',
      'mission-continuity',
    ]);
    expect(DEFAULT_MISSION_COMMAND.windows.slice(0, 3).every((window) => window.visibility === 'open')).toBe(true);
    expect(DEFAULT_MISSION_COMMAND.windows.slice(3).every((window) => window.visibility === 'closed')).toBe(true);
  });

  it('minimizes, closes, reopens, moves, resizes, and restores a preset deterministically', () => {
    const minimized = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'set-visibility',
      id: 'mission-current',
      visibility: 'minimized',
    });
    expect(minimized.windows.find((window) => window.id === 'mission-current')?.visibility).toBe('minimized');
    expect(minimized.layout).toBe('custom');

    const closed = missionCommandReducer(minimized, {
      type: 'set-visibility',
      id: 'mission-obligations',
      visibility: 'closed',
    });
    const reopened = missionCommandReducer(closed, { type: 'open', id: 'mission-obligations' });
    expect(reopened.windows.find((window) => window.id === 'mission-obligations')?.visibility).toBe('open');

    const moved = missionCommandReducer(reopened, {
      type: 'set-rect',
      id: 'mission-field',
      rect: { x: -20, y: 9, width: 140, height: 12 },
    });
    expect(moved.layout).toBe('custom');
    expect(moved.windows.find((window) => window.id === 'mission-field')?.rect).toEqual({
      x: 0,
      y: 9,
      width: 100,
      height: 26,
    });

    const review = missionCommandReducer(moved, { type: 'apply-layout', layout: 'review' });
    expect(review.layout).toBe('review');
    expect(review.windows.find((window) => window.id === 'mission-obligations')?.visibility).toBe('open');
  });

  it('accepts only validated persisted device state and falls back safely', () => {
    const changed = missionCommandReducer(DEFAULT_MISSION_COMMAND, {
      type: 'set-visibility',
      id: 'mission-field',
      visibility: 'minimized',
    });
    expect(restoreMissionCommand(JSON.stringify(changed))).toEqual(changed);
    expect(restoreMissionCommand('{not json')).toEqual(DEFAULT_MISSION_COMMAND);
    expect(restoreMissionCommand(JSON.stringify({ windows: [{ id: 'people-scoreboard' }] }))).toEqual(
      DEFAULT_MISSION_COMMAND,
    );
  });

  it('makes live-channel staleness a module-contract property, not a caller memory test', () => {
    const verified = { kind: 'verified' as const, at: new Date('2026-07-30T20:00:00.000Z') };
    expect(
      withModuleChannelTruth(verified, {
        healthy: false,
        lastConfirmedAt: new Date('2026-07-30T20:00:00.000Z'),
      }),
    ).toMatchObject({
      kind: 'stale',
      verifiedAt: new Date('2026-07-30T20:00:00.000Z'),
      message: 'The live channel is not confirmed.',
    });
    expect(
      withModuleChannelTruth({ kind: 'denied', reasonClass: 'MISSION_READ_DENIED' }, { healthy: false, lastConfirmedAt: null }),
    ).toEqual({ kind: 'denied', reasonClass: 'MISSION_READ_DENIED' });
    expect(withModuleChannelTruth(verified, { healthy: false, lastConfirmedAt: null })).toMatchObject({
      kind: 'stale',
      verifiedAt: verified.at,
      message: 'The live channel is not confirmed.',
    });
  });

  it('permits governed actions only from a current successful witness', () => {
    expect(isActionableWitness({ kind: 'verified', at: new Date() })).toBe(true);
    expect(isActionableWitness({ kind: 'proven-empty', at: new Date() })).toBe(true);
    expect(isActionableWitness({ kind: 'loading' })).toBe(false);
    expect(isActionableWitness({ kind: 'stale', verifiedAt: new Date(), message: 'offline' })).toBe(false);
    expect(isActionableWitness({ kind: 'denied', reasonClass: 'MISSION_READ_DENIED' })).toBe(false);
    expect(isActionableWitness({ kind: 'fetch-failed', message: 'offline' })).toBe(false);

    const thread = read('tablework/Thread.tsx');
    const page = read('pages/MissionCommsPage.tsx');
    const obligation = read('tablework/ObligationCard.tsx');
    expect(thread).toContain('const actionsFresh = isActionableWitness(truth)');
    expect(page).toContain('obligationActionsAvailable');
    expect(obligation).toContain('lapsed || readOnly || cancelled');
  });

  it('gives obligations their own polling witness instead of borrowing message-stream health', () => {
    const queries = read('queries.ts');
    const start = queries.indexOf('export const useMissionObligations');
    const end = queries.indexOf('export const useMissionReceipts', start);
    const obligationQuery = queries.slice(start, end);
    expect(obligationQuery).toContain('refetchInterval: 10_000');
    expect(obligationQuery).toContain('refetchIntervalInBackground: true');

    const page = read('pages/MissionCommsPage.tsx');
    const truthBlock = page.slice(page.indexOf('const obligationsTruth'), page.indexOf('return (', page.indexOf('const obligationsTruth')));
    expect(truthBlock).toContain('truthStateOf');
    expect(truthBlock).not.toContain('withModuleChannelTruth');
  });

  it('remounts device layout state at the mission boundary', () => {
    const page = read('pages/MissionCommsPage.tsx');
    expect(page).toContain('<MissionCommandWorkspace');
    expect(page).toContain('<MissionCommsScreen key={missionId}');
    expect(page).toMatch(/<MintObligationFloat\s+key=\{missionId\}/);
  });

  it('preserves mounted module state when a window is minimized or closed', () => {
    const workspace = read('tablework/MissionCommandWorkspace.tsx');
    const css = read('tablework/mission-command.css');
    expect(workspace).toContain("hidden={windowState.visibility !== 'open'}");
    expect(workspace).not.toContain("windowState.visibility === 'closed') return null");
    expect(css).toContain('.mission-command [hidden]');
  });

  it('restores focus to the obligation window when fresh governed controls disappear', () => {
    const page = read('pages/MissionCommsPage.tsx');
    const workspace = read('tablework/MissionCommandWorkspace.tsx');
    const card = read('tablework/ObligationCard.tsx');
    const materials = read('tablework/materials.tsx');
    expect(page).toContain('actionable: obligationActionsAvailable && !lapsed');
    expect(page).toContain('data-governed-control');
    expect(card).toContain('data-governed-control');
    expect(workspace).toContain('governedControlWindow');
    expect(workspace).toContain('previousActionability');
    expect(workspace).toContain('aria-label={`${module.title} window`}');
    expect(page).toContain('focusFallback={focusObligationsWindow}');
    expect(page).toContain('[data-module="mission-obligations"]');
    expect(materials).toContain('focusFallback?: () => HTMLElement | null');
    expect(materials).toContain('opener.getClientRects().length > 0');
  });

  it('keeps desktop manipulation truthful and keyboard-operable', () => {
    const workspace = read('tablework/MissionCommandWorkspace.tsx');
    const css = read('tablework/mission-command.css');
    expect(workspace).toContain("const COMPACT_QUERY = '(max-width: 71.999rem)'");
    expect(workspace).toContain('window.matchMedia(COMPACT_QUERY)');
    expect(workspace).toContain("event.key === 'ArrowLeft'");
    expect(workspace).toContain('focusDockButton');
    expect(workspace).toContain('focusWindow');
    expect(css).toContain('min-height: var(--c3-tw-target-min)');
    expect(css).not.toContain('outline: none');
  });

  it('keeps each truth state visually distinct and reserves multicolour gradients for earned truth', () => {
    const css = read('tablework/mission-command.css');
    for (const token of ['--c3-truth-verified', '--c3-truth-quiet', '--c3-truth-stale', '--c3-truth-denied', '--c3-truth-failed']) {
      expect(css).toContain(`var(${token})`);
    }
    expect(css).not.toContain('var(--c3-iris-route-a),\n    var(--c3-iris-sun)');
    expect(css).not.toContain('linear-gradient(90deg, var(--c3-iris-route-a)');
  });
});

describe('Iris identity handoff', () => {
  it('makes Iris the default face and keeps Afterglow as an explicit option', () => {
    const mode = read('theme/mode.tsx');
    const main = read('main.tsx');
    const frame = read('tablework/AppFrame.tsx');
    const html = readFileSync(join(srcDir, '..', 'index.html'), 'utf8');

    expect(mode).toContain("readStored('c3-skin', ['iris', 'afterglow'] as const, 'iris')");
    expect(mode).toContain('document.documentElement.dataset.c3Skin = skin');
    expect(main).toContain("theme/brand/iris.tokens.css");
    expect(main.indexOf('theme/brand/iris.tokens.css')).toBeGreaterThan(main.indexOf('theme/brand/c3.tokens.css'));
    expect(frame).toContain('data-testid="skin-toggle"');
    expect(frame).toContain("skin === 'iris' ? 'Iris' : 'Afterglow'");
    expect(html).toContain('data-c3-skin="iris" data-c3-theme="cozy-dark"');
    expect(html).toContain('<script src="/theme-init.js"></script>');
  });

  it('keeps small Iris text at WCAG AA contrast on persistent surfaces in both themes', () => {
    const tokens = read('theme/brand/iris.tokens.css');
    for (const theme of ['cozy-dark', 'fresh-light']) {
      const start = tokens.indexOf(`[data-c3-skin='iris'][data-c3-theme='${theme}']`);
      const end = tokens.indexOf('\n}', start) + 2;
      const block = tokens.slice(start, end);
      const value = (name: string) => {
        const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
        expect(match, `${name} must be a literal in the ${theme} Iris contract`).not.toBeNull();
        return match![1]!;
      };
      const surfaces = [
        value('--c3-iris-windowbar'),
        value('--c3-iris-dock'),
        value('--c3-iris-window'),
        value('--c3-surface-elevated'),
        value('--c3-surface-raised'),
      ];
      for (const foreground of [
        value('--c3-ink-quiet'),
        value('--c3-accent-coral'),
        value('--c3-accent-amber'),
        value('--c3-accent-periwinkle'),
        value('--c3-accent-aqua'),
      ]) {
        for (const background of surfaces) expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
