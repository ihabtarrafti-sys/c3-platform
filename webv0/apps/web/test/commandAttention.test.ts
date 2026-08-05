import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { CommsLedgerResponse } from '@c3web/api-contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api';
import {
  CommandAttentionView,
  commandAttentionTruthOf,
  type CommandAttentionTarget,
  type CommandAttentionTruthFacts,
} from '../src/tablework/CommandAttention';

const witnessedAt = Date.parse('2026-08-05T18:00:00.000Z');
const healthy = { healthy: true, lastConfirmedAt: new Date(witnessedAt) } as const;
const emptyLedger: CommsLedgerResponse = {
  awaitingMyAcceptance: [],
  awaitingMyDelivery: [],
  awaitingMySettle: [],
  watching: [],
  threads: [],
};
const populatedLedger = {
  ...emptyLedger,
  awaitingMyAcceptance: [
    {
      obligation: {
        obligationId: 'OBL-0001',
        threadId: 'THR-0001',
        description: 'Confirm the field note',
        dueAt: '2026-08-06T09:00:00.000Z',
        state: 'Delivered',
      },
      threadKind: 'anchored',
      anchorType: 'Mission',
      anchorId: 'MSN-0001',
      threadTitle: null,
    },
  ],
  threads: [
    {
      thread: {
        threadId: 'THR-0002',
        kind: 'direct',
        anchorType: null,
        anchorId: null,
        title: null,
      },
      myLastReadSeq: 4,
      unread: 2,
    },
  ],
} as unknown as CommsLedgerResponse;

const facts = (overrides: Partial<CommandAttentionTruthFacts> = {}): CommandAttentionTruthFacts => ({
  data: undefined,
  error: null,
  isLoading: false,
  isFetching: false,
  dataUpdatedAt: witnessedAt,
  channel: healthy,
  ...overrides,
});

describe('Command Attention truth', () => {
  it('derives all six states from its own person-scoped ledger and channel', () => {
    expect(commandAttentionTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(commandAttentionTruthOf(facts({ data: populatedLedger }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(commandAttentionTruthOf(facts({ data: emptyLedger }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(
      commandAttentionTruthOf(
        facts({ error: new ApiError(403, 'COMMS_DENIED', 'No standing.') }),
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'COMMS_DENIED' });
    expect(commandAttentionTruthOf(facts({ error: new Error('offline') }))).toEqual({
      kind: 'fetch-failed',
      message: 'offline',
    });
    expect(
      commandAttentionTruthOf(
        facts({
          data: populatedLedger,
          channel: { healthy: false, lastConfirmedAt: '2026-08-05T17:45:00.000Z' },
        }),
      ),
    ).toEqual({
      kind: 'stale',
      verifiedAt: new Date('2026-08-05T17:45:00.000Z'),
      message: 'The live channel is not confirmed.',
    });
  });

  it.each([401, 403])('revokes cached personal rows on authoritative HTTP %s', (status) => {
    expect(
      commandAttentionTruthOf(
        facts({
          data: populatedLedger,
          error: new ApiError(status, 'COMMS_REFUSED', 'The ledger was refused.'),
          isFetching: true,
        }),
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'COMMS_REFUSED' });
  });

  it('withholds both a cached all-clear and cached rows during revalidation', () => {
    expect(commandAttentionTruthOf(facts({ data: emptyLedger, isFetching: true }))).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'Your attention ledger is being checked again.',
    });
    expect(commandAttentionTruthOf(facts({ data: populatedLedger, isFetching: true })).kind).toBe('stale');
  });
});

describe('Command Attention rendering', () => {
  it('shows the four personal stations and unread conversations as navigation only', () => {
    const targets: CommandAttentionTarget[] = [];
    const resolveHref = vi.fn((target: CommandAttentionTarget) => {
      targets.push(target);
      return target.threadId === 'THR-0001'
        ? '/missions/MSN-0001/comms'
        : '/comms/threads/THR-0002';
    });
    const markup = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/' },
        createElement(CommandAttentionView, {
          data: populatedLedger,
          truth: { kind: 'verified', at: new Date(witnessedAt) },
          resolveHref,
        }),
      ),
    );

    expect(markup).toContain('Awaiting my acceptance');
    expect(markup).toContain('Awaiting my delivery');
    expect(markup).toContain('Awaiting my settle');
    expect(markup).toContain('Watching');
    expect(markup).toContain('Unread conversations');
    expect(markup).toContain('href="/missions/MSN-0001/comms"');
    expect(markup).toContain('href="/comms/threads/THR-0002"');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    expect(targets).toEqual([
      {
        kind: 'obligation-thread',
        obligationId: 'OBL-0001',
        threadId: 'THR-0001',
        threadKind: 'anchored',
        anchorType: 'Mission',
        anchorId: 'MSN-0001',
      },
      {
        kind: 'unread-thread',
        threadId: 'THR-0002',
        threadKind: 'direct',
        anchorType: null,
        anchorId: null,
      },
    ]);
  });

  it('renders a failed read as failure and never as a caught-up claim', () => {
    const markup = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/' },
        createElement(CommandAttentionView, {
          data: undefined,
          truth: { kind: 'fetch-failed', message: 'network unavailable' },
          resolveHref: () => '/',
        }),
      ),
    );

    expect(markup).toContain('data-truth="fetch-failed"');
    expect(markup).toContain('network unavailable');
    expect(markup).not.toContain('You are caught up');
  });
});
