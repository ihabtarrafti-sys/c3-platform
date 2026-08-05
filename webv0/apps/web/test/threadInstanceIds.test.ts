import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Thread } from '../src/tablework/Thread';

const threadProps = {
  missionName: 'North Star',
  threadTitle: 'Current',
  participantsLine: '2 participants',
  messages: [],
  myLastReadSeq: null,
  lapsed: false,
  seenLine: null,
  posting: false,
  onPost: vi.fn(async () => true),
  onAttach: vi.fn(async () => undefined),
  truth: { kind: 'proven-empty', at: new Date('2026-08-05T18:00:00.000Z') } as const,
  audienceTreaty: { text: 'Visible to this mission.', verified: true },
};

describe('Thread DOM identity', () => {
  it('preserves every legacy id and reference when no instance identity is supplied', () => {
    const markup = renderToStaticMarkup(createElement(Thread, threadProps));

    expect(markup).toContain('North Star · Mission Thread');
    expect(markup).toContain('>Anchored</span>');
    expect(markup).toContain('placeholder="Write in the North Star Mission Thread"');
    expect(markup).toContain('aria-labelledby="thread-heading"');
    expect(markup).toContain('<h2 id="thread-heading">Current</h2>');
    expect(markup).toContain('for="thread-message"');
    expect(markup).toContain('id="thread-message"');
  });

  it('lets two live Thread instances coexist without duplicate ids or broken references', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(Thread, { ...threadProps, instanceId: 'mission-current' }),
        createElement(Thread, { ...threadProps, instanceId: 'room-THR-0002' }),
      ),
    );
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

    expect(ids).toEqual([
      'mission-current-thread-heading',
      'mission-current-thread-message',
      'room-THR-0002-thread-heading',
      'room-THR-0002-thread-message',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(markup).toContain('aria-labelledby="mission-current-thread-heading"');
    expect(markup).toContain('for="mission-current-thread-message"');
    expect(markup).toContain('aria-labelledby="room-THR-0002-thread-heading"');
    expect(markup).toContain('for="room-THR-0002-thread-message"');
    expect(markup).not.toMatch(/(?:aria-labelledby|for)="(?:thread-heading|thread-message)"/);
  });

  it('lets an embedded conversation name its context, standing, and composer truthfully', () => {
    const markup = renderToStaticMarkup(
      createElement(Thread, {
        ...threadProps,
        missionName: 'Alyssa and Ihab',
        contextLabel: 'Conversation',
        standingLabel: 'Seated',
        composerNoun: 'conversation',
      }),
    );

    expect(markup).toContain('Alyssa and Ihab · Conversation');
    expect(markup).toContain('>Seated</span>');
    expect(markup).toContain('placeholder="Write in the Alyssa and Ihab conversation"');
    expect(markup).not.toContain('Mission Thread');
    expect(markup).not.toContain('>Anchored</span>');
  });
});
