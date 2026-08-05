import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CommsMessageDto, CommsObligationDto } from '@c3web/api-contracts';
import {
  MissionContinuity,
  joinMissionContinuityWitness,
  projectMissionContinuity,
  type MissionContinuitySources,
} from '../src/tablework/MissionContinuity';
import type { WitnessState } from '../src/tablework/TruthPanel';

const messageOne: CommsMessageDto = {
  recalled: false,
  messageId: 'MSG-0001',
  threadId: 'THR-0001',
  seq: 1,
  authorship: { kind: 'person', userId: 'user-avery', label: 'Avery' },
  authorUserId: 'user-avery',
  authorLabel: 'Avery',
  revisionNo: 1,
  createdAt: '2026-08-05T08:00:00.000Z',
  body: 'Use the northern relay.',
  links: [],
  attachments: [],
  messageKind: 'decision',
  supersedesMessageId: null,
  blocks: [],
};

const recalledMessage: CommsMessageDto = {
  recalled: true,
  messageId: 'MSG-0003',
  threadId: 'THR-0001',
  seq: 3,
  authorship: { kind: 'person', userId: 'user-cameron', label: 'Cameron' },
  authorUserId: 'user-cameron',
  authorLabel: 'Cameron',
  revisionNo: 1,
  createdAt: '2026-08-05T08:02:00.000Z',
  recall: {
    reasonCode: 'AuthorRecall',
    actorLabel: 'Cameron',
    at: '2026-08-05T08:06:00.000Z',
  },
};

const supersedingMessage: CommsMessageDto = {
  recalled: false,
  messageId: 'MSG-0002',
  threadId: 'THR-0001',
  seq: 2,
  authorship: { kind: 'person', userId: 'user-bea', label: 'Bea' },
  authorUserId: 'user-bea',
  authorLabel: 'Bea',
  revisionNo: 1,
  createdAt: '2026-08-05T08:05:00.000Z',
  body: 'Use the eastern relay.',
  links: [],
  attachments: [],
  messageKind: 'decision',
  supersedesMessageId: 'MSG-0001',
  blocks: [],
};

const obligation: CommsObligationDto = {
  obligationId: 'OBL-0001',
  threadId: 'THR-0001',
  sourceMessageId: 'MSG-0001',
  state: 'Cancelled',
  description: 'Deliver the revised passport.',
  accountableUserId: 'user-avery',
  requesterUserId: 'user-bea',
  beneficiaryKind: 'account',
  beneficiaryUserId: 'user-cameron',
  beneficiaryLabel: null,
  acceptanceKind: 'account',
  acceptanceUserId: 'user-bea',
  acceptanceLabel: null,
  dueAt: '2026-08-06T08:00:00.000Z',
  evidenceRequirement: 'Revised passport',
  version: 3,
  createdAt: '2026-08-05T08:01:00.000Z',
  events: [
    {
      eventType: 'EvidenceDelivered',
      fromState: 'Open',
      toState: 'Delivered',
      actorUserId: 'user-avery',
      actorLabel: 'Avery',
      reason: null,
      attestation: null,
      deliveryEpisodeVersion: 1,
      at: '2026-08-05T08:03:00.000Z',
    },
    {
      eventType: 'Accepted',
      fromState: 'Delivered',
      toState: 'Accepted',
      actorUserId: 'user-bea',
      actorLabel: 'Bea',
      reason: null,
      attestation: 'Accepted as named authority.',
      deliveryEpisodeVersion: 1,
      at: '2026-08-05T08:04:00.000Z',
    },
    {
      eventType: 'Cancelled',
      fromState: 'Accepted',
      toState: 'Cancelled',
      actorUserId: 'user-bea',
      actorLabel: 'Bea',
      reason: 'Requirement superseded.',
      attestation: null,
      deliveryEpisodeVersion: 1,
      at: '2026-08-05T08:07:00.000Z',
    },
  ],
  evidence: [
    {
      documentId: 'DOC-0001',
      fileName: 'passport.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      deliveredByUserId: 'user-avery',
      delivererLabel: 'Avery',
      note: 'First delivery episode.',
      deliveredAt: '2026-08-05T08:03:30.000Z',
    },
  ],
};

const verified = (at: string): WitnessState => ({ kind: 'verified', at: new Date(at) });
const empty = (at: string): WitnessState => ({ kind: 'proven-empty', at: new Date(at) });

function sources(overrides: Partial<MissionContinuitySources> = {}): MissionContinuitySources {
  return {
    messages: [messageOne, recalledMessage, supersedingMessage],
    messageTruth: verified('2026-08-05T09:00:00.000Z'),
    obligations: [obligation],
    obligationTruth: verified('2026-08-05T08:59:00.000Z'),
    ...overrides,
  };
}

describe('Mission Continuity projection', () => {
  it('orders exact source records and keeps supersession, recall, transitions, and evidence distinct', () => {
    const trace = projectMissionContinuity(
      [supersedingMessage, recalledMessage, messageOne],
      [obligation],
    );

    expect(trace.map((entry) => entry.id)).toEqual([
      'message:MSG-0001:recorded',
      'obligation:OBL-0001:created',
      'message:MSG-0003:recorded',
      'obligation:OBL-0001:event:0',
      'obligation:OBL-0001:evidence:DOC-0001',
      'obligation:OBL-0001:event:1',
      'message:MSG-0002:recorded',
      'message:MSG-0003:recall',
      'obligation:OBL-0001:event:2',
    ]);

    const originalDecision = trace.find((entry) => entry.id === 'message:MSG-0001:recorded');
    expect(originalDecision).toBeDefined();
    if (!originalDecision) throw new Error('The original decision must remain in the trace.');
    expect(originalDecision.bearing).toBe('history');
    expect(originalDecision.provenance).toMatchObject({
      kind: 'message',
      supersedesMessageId: null,
      supersededByMessageIds: ['MSG-0002'],
      authorship: { kind: 'person', userId: 'user-avery', label: 'Avery' },
    });

    const replacement = trace.find((entry) => entry.id === 'message:MSG-0002:recorded');
    expect(replacement).toMatchObject({ bearing: 'standing', provenance: { supersedesMessageId: 'MSG-0001' } });
    expect(trace.find((entry) => entry.kind === 'message-recalled')).toMatchObject({
      bearing: 'standing',
      provenance: { kind: 'recall', reasonCode: 'AuthorRecall', actorLabel: 'Cameron' },
    });

    const evidence = trace.find((entry) => entry.kind === 'evidence-delivered');
    expect(evidence).toMatchObject({
      bearing: 'history',
      provenance: {
        kind: 'evidence',
        documentId: 'DOC-0001',
        deliveredByUserId: 'user-avery',
        note: 'First delivery episode.',
      },
    });
    expect(trace.find((entry) => entry.id === 'obligation:OBL-0001:event:2')).toMatchObject({
      bearing: 'standing',
      detail: 'Accepted → Cancelled.',
      provenance: {
        kind: 'obligation-transition',
        eventType: 'Cancelled',
        reason: 'Requirement superseded.',
        attestation: null,
      },
    });
    expect(JSON.stringify(trace).toLowerCase()).not.toContain('settled');
    expect(JSON.stringify(trace).toLowerCase()).not.toContain('caused');
  });

  it('earns complete and proven-empty only from two mutually consistent current witnesses', () => {
    expect(joinMissionContinuityWitness(sources())).toEqual({
      kind: 'verified',
      at: new Date('2026-08-05T08:59:00.000Z'),
    });

    expect(
      joinMissionContinuityWitness(
        sources({
          messages: [],
          messageTruth: empty('2026-08-05T09:00:00.000Z'),
          obligations: [],
          obligationTruth: empty('2026-08-05T08:58:00.000Z'),
        }),
      ),
    ).toEqual({ kind: 'proven-empty', at: new Date('2026-08-05T08:58:00.000Z') });

    expect(
      joinMissionContinuityWitness(
        sources({ obligations: [], obligationTruth: empty('2026-08-05T08:58:00.000Z') }),
      ),
    ).toEqual({ kind: 'verified', at: new Date('2026-08-05T08:58:00.000Z') });

    expect(joinMissionContinuityWitness(sources({ messageTruth: { kind: 'loading' } })).kind).toBe('loading');
    expect(
      joinMissionContinuityWitness(
        sources({ messageTruth: { kind: 'stale', verifiedAt: new Date('2026-08-05T08:30:00.000Z'), message: 'refetch failed' } }),
      ),
    ).toMatchObject({ kind: 'stale', verifiedAt: new Date('2026-08-05T08:30:00.000Z') });
    expect(
      joinMissionContinuityWitness(sources({ messageTruth: { kind: 'denied', reasonClass: 'COMMS_DENIED' } })),
    ).toEqual({ kind: 'denied', reasonClass: 'messages:COMMS_DENIED' });
    expect(
      joinMissionContinuityWitness(sources({ obligationTruth: { kind: 'fetch-failed', message: 'network down' } })),
    ).toEqual({ kind: 'fetch-failed', message: 'obligations: network down' });

    expect(joinMissionContinuityWitness(sources({ messages: [] }))).toEqual({
      kind: 'fetch-failed',
      message: 'The continuity records disagree with their independent witnesses.',
    });
    expect(
      joinMissionContinuityWitness(
        sources({ messages: [], messageTruth: empty('2026-08-05T09:00:00.000Z'), obligations: [] }),
      ),
    ).toEqual({
      kind: 'fetch-failed',
      message: 'The continuity records disagree with their independent witnesses.',
    });
  });

  it('renders a read-only trace with focus affordances while refusing completeness and cached denied records', () => {
    const completeMarkup = renderToStaticMarkup(
      createElement(MissionContinuity, {
        ...sources(),
        onFocusMessage: () => undefined,
        onFocusObligation: () => undefined,
      }),
    );
    expect(completeMarkup).toContain('data-tablework="MissionContinuity"');
    expect(completeMarkup).toContain('data-continuity-complete="true"');
    expect(completeMarkup).toContain('data-focus-record="message:MSG-0001"');
    expect(completeMarkup).toContain('data-focus-record="obligation:OBL-0001"');
    expect(completeMarkup).toContain('Explicitly superseded by MSG-0002.');
    expect(completeMarkup).toContain('This trace orders recorded facts. It infers no causality, acceptance, completion, or settlement.');
    expect(completeMarkup).not.toContain('>Accept<');
    expect(completeMarkup).not.toContain('>Record Done<');

    const staleMarkup = renderToStaticMarkup(
      createElement(MissionContinuity, {
        ...sources({ messageTruth: { kind: 'stale', verifiedAt: new Date('2026-08-05T08:30:00.000Z'), message: 'refetch failed' } }),
        onFocusMessage: () => undefined,
        onFocusObligation: () => undefined,
      }),
    );
    expect(staleMarkup).toContain('data-continuity-complete="false"');
    expect(staleMarkup).toContain('It may be incomplete.');
    expect(staleMarkup).toContain('Use the northern relay.');

    const deniedMarkup = renderToStaticMarkup(
      createElement(MissionContinuity, {
        ...sources({ messageTruth: { kind: 'denied', reasonClass: 'COMMS_DENIED' } }),
        onFocusMessage: () => undefined,
        onFocusObligation: () => undefined,
      }),
    );
    expect(deniedMarkup).toContain('data-continuity-complete="false"');
    expect(deniedMarkup).not.toContain('Use the northern relay.');
    expect(deniedMarkup).toContain('Deliver the revised passport.');
  });
});
