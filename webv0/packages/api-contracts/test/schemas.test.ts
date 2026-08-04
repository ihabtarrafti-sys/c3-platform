import { describe, it, expect } from 'vitest';
import {
  submitAddPersonRequestSchema,
  rejectRequestSchema,
  versionedRequestSchema,
  approvalSchema,
  personIdParamSchema,
  approvalIdParamSchema,
  commsMessageSchema,
} from '../src/index';

describe('wire contracts', () => {
  it('accepts a valid AddPerson submission and rejects unknown keys', () => {
    expect(submitAddPersonRequestSchema.safeParse({ input: { fullName: 'A' } }).success).toBe(true);
    expect(submitAddPersonRequestSchema.safeParse({ input: { fullName: 'A', Id: 5 } }).success).toBe(false);
    expect(submitAddPersonRequestSchema.safeParse({ input: { fullName: '' } }).success).toBe(false);
  });

  it('requires expectedVersion on mutations', () => {
    expect(versionedRequestSchema.safeParse({ expectedVersion: 0 }).success).toBe(true);
    expect(versionedRequestSchema.safeParse({}).success).toBe(false);
    expect(versionedRequestSchema.safeParse({ expectedVersion: -1 }).success).toBe(false);
  });

  it('reject requires a non-empty reason', () => {
    expect(rejectRequestSchema.safeParse({ expectedVersion: 1, reason: 'dup' }).success).toBe(true);
    expect(rejectRequestSchema.safeParse({ expectedVersion: 1, reason: '  ' }).success).toBe(false);
  });

  it('path params enforce canonical id shapes', () => {
    expect(personIdParamSchema.safeParse({ personId: 'PER-0001' }).success).toBe(true);
    expect(personIdParamSchema.safeParse({ personId: '1' }).success).toBe(false);
    expect(approvalIdParamSchema.safeParse({ approvalId: 'APR-0009' }).success).toBe(true);
  });

  it('approval response schema validates a representative row', () => {
    const row = {
      approvalId: 'APR-0001', operationType: 'AddPerson', targetPersonId: 'PENDING-ADDPERSON',
      targetId: null, reason: null, status: 'Submitted',
      payload: { operationType: 'AddPerson', input: { fullName: 'A', ign: null, nationality: null, primaryRole: null, personnelCode: null, currentTeam: null, currentGameTitle: null, primaryDepartment: null, notes: null } },
      submittedBy: 'ops@a.com', submittedAt: '2026-07-05T00:00:00.000Z',
      reviewedBy: null, reviewedAt: null, rejectionReason: null, executedAt: null, executionError: null,
      version: 0, editCount: 0, revisionOf: null, supersededBy: null,
      createdAt: '2026-07-05T00:00:00.000Z', updatedAt: '2026-07-05T00:00:00.000Z',
    };
    expect(approvalSchema.safeParse(row).success).toBe(true);
  });

  it('adds explicit person authorship while preserving the frozen-v1 identity aliases', () => {
    const message = {
      recalled: false,
      messageId: 'MSG-0001',
      threadId: 'THR-0001',
      seq: 1,
      authorship: { kind: 'person', userId: 'user-1', label: 'Mara' },
      authorUserId: 'user-1',
      authorLabel: 'Mara',
      revisionNo: 1,
      createdAt: '2026-08-05T00:00:00.000Z',
      body: 'Status recorded.',
      links: [],
      attachments: [],
      messageKind: 'note',
      supersedesMessageId: null,
    };

    expect(commsMessageSchema.parse(message).authorship).toEqual(message.authorship);
    expect(commsMessageSchema.safeParse({ ...message, authorship: undefined }).success).toBe(false);
    expect(commsMessageSchema.safeParse({ ...message, authorUserId: undefined }).success).toBe(false);
    expect(commsMessageSchema.safeParse({ ...message, authorUserId: 'user-2' }).success).toBe(false);
    expect(commsMessageSchema.safeParse({ ...message, authorLabel: 'Another person' }).success).toBe(false);
    expect(commsMessageSchema.safeParse({ ...message, authorship: { kind: 'system', rule: 'deadline elapsed' } }).success).toBe(false);

    const recalled = {
      recalled: true,
      messageId: 'MSG-0001',
      threadId: 'THR-0001',
      seq: 1,
      authorship: { kind: 'person', userId: 'user-1', label: null },
      authorUserId: 'user-1',
      authorLabel: null,
      revisionNo: 1,
      createdAt: '2026-08-05T00:00:00.000Z',
      recall: { reasonCode: 'AuthorRecall', actorLabel: 'Mara', at: '2026-08-05T00:01:00.000Z' },
    };
    expect(commsMessageSchema.parse(recalled).authorship).toEqual(recalled.authorship);
    expect(commsMessageSchema.safeParse({ ...recalled, authorLabel: undefined }).success).toBe(false);
  });
});
