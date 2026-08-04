import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CommsMessageDto } from '@c3web/api-contracts';
import { AuthorshipMark } from '../src/tablework/AuthorshipMark';
import { Message } from '../src/tablework/Message';

describe('D-009 authorship marks', () => {
  it('keeps a person named and accountable, with the compact message avatar', () => {
    const markup = renderToStaticMarkup(
      createElement(AuthorshipMark, {
        authorship: { kind: 'person', userId: 'user-1', label: 'Avery Stone' },
        compact: true,
      }),
    );

    expect(markup).toContain('data-authorship="person"');
    expect(markup).toContain('data-author-id="user-1"');
    expect(markup).toContain('actor-avatar');
    expect(markup).toContain('Avery Stone');
    expect(markup).toContain('Person · accountable author');

    const unlabelled = renderToStaticMarkup(
      createElement(AuthorshipMark, {
        authorship: { kind: 'person', userId: 'user-unlabelled', label: null },
        compact: true,
      }),
    );
    expect(unlabelled).toContain('Member · user-unlabelled');
    expect(unlabelled).not.toContain('<strong>Member</strong>');
  });

  it('renders a deterministic system event from its rule, never a person identity', () => {
    const markup = renderToStaticMarkup(
      createElement(AuthorshipMark, {
        authorship: { kind: 'system', rule: 'Three recorded facts derive settlement.' },
      }),
    );

    expect(markup).toContain('data-authorship="system"');
    expect(markup).toContain('System event');
    expect(markup).toContain('Rule · Three recorded facts derive settlement.');
    expect(markup).toContain('May state facts · does not imply acceptance.');
    expect(markup).not.toContain('actor-avatar');
    expect(markup).not.toContain('data-author-id');
  });

  it('renders AI assistance as pending HEARTH-001 provenance, never a person identity', () => {
    const markup = renderToStaticMarkup(
      createElement(AuthorshipMark, {
        authorship: { kind: 'ai_assisted', provenance: 'HEARTH-001', humanRatification: 'pending' },
      }),
    );

    expect(markup).toContain('data-authorship="ai_assisted"');
    expect(markup).toContain('AI-assisted output');
    expect(markup).toContain('HEARTH-001');
    expect(markup).toContain('Not ratified by a human');
    expect(markup).toContain('May state facts · does not imply acceptance.');
    expect(markup).not.toContain('actor-avatar');
    expect(markup).not.toContain('data-author-id');
  });

  it('binds a live message to person authorship without changing its record behavior', () => {
    const message: CommsMessageDto = {
      recalled: false,
      messageId: 'MSG-0001',
      threadId: 'THR-0001',
      seq: 1,
      authorship: { kind: 'person', userId: 'user-1', label: 'Avery Stone' },
      authorUserId: 'user-1',
      authorLabel: 'Avery Stone',
      revisionNo: 1,
      createdAt: '2026-08-05T08:00:00.000Z',
      body: 'The handoff is recorded.',
      links: [],
      attachments: [],
      messageKind: 'decision',
      supersedesMessageId: null,
      blocks: [],
    };

    const markup = renderToStaticMarkup(createElement(Message, { message }));

    expect(markup).toContain('data-tablework="Message"');
    expect(markup).toContain('data-authorship="person"');
    expect(markup).toContain('Decision · MSG-0001');
    expect(markup).toContain('The handoff is recorded.');
  });
});
