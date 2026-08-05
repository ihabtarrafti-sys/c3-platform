import type { ThreadRoomResponse } from '@c3web/api-contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import {
  conversationRelayTruthOf,
  conversationWriteRefusalOf,
  type ConversationRelayTruthFacts,
} from '../src/tablework/ConversationRelay';

const witnessedAt = Date.parse('2026-08-05T20:15:00.000Z');
const healthy = { healthy: true, lastConfirmedAt: '2026-08-05T20:15:00.000Z' } as const;
const emptyRoom: ThreadRoomResponse = {
  thread: {
    threadId: 'THR-9003',
    kind: 'direct',
    anchorType: null,
    anchorId: null,
    title: null,
    status: 'active',
    lastSeq: 0,
    lastMessageAt: null,
    createdAt: '2026-08-05T20:00:00.000Z',
  },
  messages: [],
  myLastReadSeq: null,
  participants: [],
  events: [],
  retentionDays: 30,
};
const populatedRoom = {
  ...emptyRoom,
  thread: { ...emptyRoom.thread, lastSeq: 1, lastMessageAt: '2026-08-05T20:14:00.000Z' },
  messages: [
    {
      recalled: false,
      messageId: 'MSG-9003',
      threadId: 'THR-9003',
      seq: 1,
      authorship: { kind: 'person', userId: 'user-operator', label: 'Operator' },
      authorUserId: 'user-operator',
      authorLabel: 'Operator',
      revisionNo: 1,
      createdAt: '2026-08-05T20:14:00.000Z',
      body: 'The relay is witnessed.',
      links: [],
      attachments: [],
      messageKind: 'note',
      supersedesMessageId: null,
      blocks: [],
    },
  ],
} satisfies ThreadRoomResponse;

const facts = (overrides: Partial<ConversationRelayTruthFacts> = {}): ConversationRelayTruthFacts => ({
  data: undefined,
  error: null,
  isLoading: false,
  isFetching: false,
  dataUpdatedAt: witnessedAt,
  channel: healthy,
  ...overrides,
});

describe('Conversation Relay truth', () => {
  it('derives loading, verified, proven-empty, denied, failed, and stale independently', () => {
    expect(conversationRelayTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(conversationRelayTruthOf(facts({ data: populatedRoom }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(conversationRelayTruthOf(facts({ data: emptyRoom }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(
      conversationRelayTruthOf(facts({ error: new ApiError(403, 'COMMS_DENIED', 'No seat.') })),
    ).toEqual({ kind: 'denied', reasonClass: 'COMMS_DENIED' });
    expect(conversationRelayTruthOf(facts({ error: new Error('room read failed') }))).toEqual({
      kind: 'fetch-failed',
      message: 'room read failed',
    });
    expect(
      conversationRelayTruthOf(
        facts({
          data: populatedRoom,
          channel: { healthy: false, lastConfirmedAt: '2026-08-05T20:10:00.000Z' },
        }),
      ),
    ).toEqual({
      kind: 'stale',
      verifiedAt: new Date('2026-08-05T20:10:00.000Z'),
      message: 'The live channel is not confirmed.',
    });
  });

  it.each([401, 403])('revokes cached room rows on authoritative HTTP %s', (status) => {
    expect(
      conversationRelayTruthOf(
        facts({
          data: populatedRoom,
          error: new ApiError(status, 'COMMS_REFUSED', 'The room was refused.'),
          isFetching: true,
        }),
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'COMMS_REFUSED' });
  });

  it('collapses missing and inaccessible rooms to the same privacy-safe refusal', () => {
    expect(
      conversationRelayTruthOf(facts({ error: new ApiError(404, 'THREAD_NOT_FOUND', 'Missing.') })),
    ).toEqual({ kind: 'denied', reasonClass: 'THREAD_NOT_AVAILABLE' });
    expect(
      conversationRelayTruthOf(
        facts({
          data: populatedRoom,
          error: new ApiError(404, 'THREAD_NOT_SEATED', 'Outside your access.'),
          isFetching: true,
        }),
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'THREAD_NOT_AVAILABLE' });
  });

  it('withholds cached rows and cached emptiness throughout revalidation', () => {
    expect(conversationRelayTruthOf(facts({ data: populatedRoom, isFetching: true }))).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'This conversation is being checked again.',
    });
    expect(conversationRelayTruthOf(facts({ data: emptyRoom, isFetching: true })).kind).toBe('stale');
  });
});

describe('Conversation Relay write boundary', () => {
  it('shares module lapse, revokes posting on 401/403, and lets a post 404 collapse the room', () => {
    expect(conversationWriteRefusalOf(new ApiError(403, 'MODULE_READ_ONLY', 'Lapsed.'), 'post')).toBe('module-read-only');
    expect(conversationWriteRefusalOf(new ApiError(401, 'SESSION_REFUSED', 'Refused.'), 'post')).toBe('conversation-write-revoked');
    expect(conversationWriteRefusalOf(new ApiError(403, 'POST_REFUSED', 'Refused.'), 'post')).toBe('conversation-write-revoked');
    expect(conversationWriteRefusalOf(new ApiError(404, 'THREAD_NOT_FOUND', 'Missing.'), 'post')).toBe('room-unavailable');
  });

  it.each([401, 403, 404])('revokes only seat administration on a seat-write HTTP %s', (status) => {
    expect(
      conversationWriteRefusalOf(new ApiError(status, 'SEAT_REFUSED', 'Refused.'), 'seat'),
    ).toBe('seat-administration-revoked');
  });

  it('keeps ordinary transport and conflict failures scoped to their own error', () => {
    expect(conversationWriteRefusalOf(new Error('offline'), 'post')).toBe('ordinary-failure');
    expect(conversationWriteRefusalOf(new ApiError(409, 'CONFLICT', 'Changed.'), 'seat')).toBe('ordinary-failure');
  });
});
