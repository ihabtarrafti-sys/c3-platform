import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecheckingTruthPanel } from '../src/tablework/RecheckingTruthPanel';

const stale = {
  kind: 'stale' as const,
  verifiedAt: new Date('2026-08-06T10:00:00.000Z'),
  message: 'The register is being checked again.',
};

describe('rechecking truth copy', () => {
  it('keeps an in-flight refresh stale without falsely calling it failed', () => {
    const markup = renderToStaticMarkup(
      createElement(
        RecheckingTruthPanel,
        { state: stale, rechecking: true, emptyLabel: 'No records.', testids: { stale: 'stale-region' } },
        createElement('span', null, 'cached witness'),
      ),
    );

    expect(markup).toContain('data-truth="stale"');
    expect(markup).toContain('new check is in progress');
    expect(markup).toContain('cached witness');
    expect(markup).not.toContain('FAILED');
  });

  it('retains the failure warning when the latest refresh really failed', () => {
    const markup = renderToStaticMarkup(
      createElement(RecheckingTruthPanel, { state: stale, rechecking: false, emptyLabel: 'No records.' }),
    );

    expect(markup).toContain('latest check FAILED');
  });
});
