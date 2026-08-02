import { describe, expect, it } from 'vitest';
import {
  createCommsObligationInputSchema,
  deriveCommsSelfAcceptance,
  type CommsObligationEventView,
  type CommsObligationView,
} from '../src/comms';

const ALI = '11111111-1111-4111-8111-111111111111';
const BEA = '22222222-2222-4222-8222-222222222222';
const CY = '33333333-3333-4333-8333-333333333333';

function event(
  eventType: string,
  actorUserId: string,
  fromState: CommsObligationEventView['fromState'],
  toState: CommsObligationEventView['toState'],
  minute: number,
  deliveryEpisodeVersion: number | null = eventType === 'EvidenceDelivered' || eventType === 'Accepted' ? 1 : null,
  actorLabel: string | null | undefined = undefined,
): CommsObligationEventView {
  return {
    eventType,
    fromState,
    toState,
    actorUserId,
    actorLabel: actorLabel === undefined ? (actorUserId === ALI ? 'Ali' : actorUserId === BEA ? 'Bea' : 'Cy') : actorLabel,
    reason: null,
    attestation: null,
    deliveryEpisodeVersion,
    at: `2026-08-02T10:${String(minute).padStart(2, '0')}:00.000Z`,
  };
}

function obligation(
  events: CommsObligationEventView[],
  over: Partial<CommsObligationView> = {},
): CommsObligationView {
  return {
    obligationId: 'OBL-0001',
    threadId: 'THR-0001',
    sourceMessageId: null,
    state: 'Accepted',
    description: 'Ship the signed pack',
    accountableUserId: ALI,
    requesterUserId: CY,
    beneficiaryKind: 'external',
    beneficiaryUserId: null,
    beneficiaryLabel: 'Publisher',
    acceptanceKind: 'account',
    acceptanceUserId: BEA,
    acceptanceLabel: null,
    dueAt: '2026-08-03T10:00:00.000Z',
    evidenceRequirement: 'Signed pack',
    version: 2,
    createdAt: '2026-08-02T10:00:00.000Z',
    events,
    evidence: [],
    ...over,
  };
}

describe('Comms Obligation self-acceptance', () => {
  it('permits one internal member to hold accountable and acceptance authority', () => {
    const parsed = createCommsObligationInputSchema.parse({
      description: 'Ship the signed pack',
      accountableUserId: ALI,
      beneficiary: { kind: 'external', label: 'Publisher' },
      acceptance: { kind: 'account', userId: ALI },
      dueAt: '2026-08-03T10:00:00.000Z',
      evidenceRequirement: 'Signed pack',
      clientMutationId: '44444444-4444-4444-8444-444444444444',
      sourceMessageId: null,
    });

    expect(parsed.acceptance).toEqual({ kind: 'account', userId: ALI });
    expect(
      createCommsObligationInputSchema.parse({
        ...parsed,
        acceptance: { kind: 'account', userId: BEA },
        clientMutationId: '55555555-5555-4555-8555-555555555555',
      }).acceptance,
    ).toEqual({ kind: 'account', userId: BEA });
    expect(
      createCommsObligationInputSchema.parse({
        ...parsed,
        acceptance: { kind: 'external', label: 'Publisher liaison', proxyUserId: ALI },
        clientMutationId: '66666666-6666-4666-8666-666666666666',
      }).acceptance,
    ).toEqual({ kind: 'external', label: 'Publisher liaison', proxyUserId: ALI });
  });

  it('derives the current handoff from actual actors, not assigned-role overlap', () => {
    const sameAssignmentButOrdinary = deriveCommsSelfAcceptance(
      obligation(
        [
          event('Created', CY, null, 'Open', 0),
          event('EvidenceDelivered', BEA, 'Open', 'Delivered', 1),
          event('Accepted', ALI, 'Delivered', 'Accepted', 2),
        ],
        { accountableUserId: ALI, acceptanceUserId: ALI },
      ),
    );
    expect(sameAssignmentButOrdinary).toBeNull();

    const differentAssignmentsButSameActor = deriveCommsSelfAcceptance(
      obligation(
        [
          event('Created', CY, null, 'Open', 0),
          event('EvidenceDelivered', BEA, 'Open', 'Delivered', 1),
          event('Accepted', BEA, 'Delivered', 'Accepted', 2),
        ],
        { accountableUserId: ALI, acceptanceUserId: BEA },
      ),
    );
    expect(differentAssignmentsButSameActor).toMatchObject({
      actorUserId: BEA,
      actorLabel: 'Bea',
      acceptedAt: '2026-08-02T10:02:00.000Z',
    });

    const retainedAtDone = deriveCommsSelfAcceptance(
      obligation(
        [
          event('Created', CY, null, 'Open', 0),
          event('EvidenceDelivered', BEA, 'Open', 'Delivered', 1),
          event('Accepted', BEA, 'Delivered', 'Accepted', 2),
          event('Done', ALI, 'Accepted', 'Done', 3),
        ],
        { state: 'Done', version: 3, acceptanceUserId: BEA },
      ),
    );
    expect(retainedAtDone).toMatchObject({ actorUserId: BEA, acceptedAt: '2026-08-02T10:02:00.000Z' });
  });

  it('recognises any delivery in the current episode and resets at rejection', () => {
    const multipleDeliverers = deriveCommsSelfAcceptance(
      obligation([
        event('Created', CY, null, 'Open', 0),
        event('EvidenceDelivered', ALI, 'Open', 'Delivered', 1),
        event('EvidenceDelivered', BEA, 'Delivered', 'Delivered', 2),
        event('Accepted', ALI, 'Delivered', 'Accepted', 3),
      ], { acceptanceUserId: ALI }),
    );
    expect(multipleDeliverers).toMatchObject({ actorUserId: ALI, actorLabel: 'Ali' });

    const redelivery = deriveCommsSelfAcceptance(
      obligation(
        [
          event('Created', CY, null, 'Open', 0),
          event('EvidenceDelivered', ALI, 'Open', 'Delivered', 1, 1),
          event('Rejected', BEA, 'Delivered', 'Open', 2),
          event('EvidenceDelivered', BEA, 'Open', 'Delivered', 3, 3),
          event('Accepted', BEA, 'Delivered', 'Accepted', 4, 3),
        ],
        { version: 4 },
      ),
    );
    expect(redelivery).toMatchObject({ actorUserId: BEA, actorLabel: 'Bea' });
  });

  it('starts a new episode after reopen and fails closed without a paired delivery', () => {
    const afterReopen = deriveCommsSelfAcceptance(
      obligation(
        [
          event('Created', CY, null, 'Open', 0),
          event('EvidenceDelivered', ALI, 'Open', 'Delivered', 1, 1),
          event('Accepted', ALI, 'Delivered', 'Accepted', 2, 1),
          event('Reopened', CY, 'Accepted', 'Open', 3),
          event('EvidenceDelivered', BEA, 'Open', 'Delivered', 4, 4),
          event('Accepted', ALI, 'Delivered', 'Accepted', 5, 4),
        ],
        { version: 5 },
      ),
    );
    expect(afterReopen).toBeNull();

    expect(deriveCommsSelfAcceptance(obligation([event('Accepted', BEA, 'Delivered', 'Accepted', 1)]))).toBeNull();
    expect(
      deriveCommsSelfAcceptance(
        obligation(
          [event('EvidenceDelivered', BEA, 'Open', 'Delivered', 1), event('Accepted', ALI, 'Delivered', 'Accepted', 2)],
          { acceptanceUserId: BEA },
        ),
      ),
    ).toBeNull();
    expect(
      deriveCommsSelfAcceptance(
        obligation([
          event('EvidenceDelivered', BEA, 'Open', 'Open', 1),
          event('Accepted', BEA, 'Delivered', 'Accepted', 2),
        ]),
      ),
    ).toBeNull();
    expect(
      deriveCommsSelfAcceptance(
        obligation([
          event('EvidenceDelivered', BEA, 'Open', 'Delivered', 1),
          event('Accepted', BEA, 'Open', 'Accepted', 2),
        ]),
      ),
    ).toBeNull();
    expect(
      deriveCommsSelfAcceptance(
        obligation([event('EvidenceDelivered', BEA, 'Open', 'Delivered', 1), event('Accepted', BEA, 'Delivered', 'Accepted', 2)], {
          state: 'Open',
        }),
      ),
    ).toBeNull();
  });

  it('never labels an external proxy as self-acceptance', () => {
    const selfAcceptance = deriveCommsSelfAcceptance(
      obligation(
        [
          event('Created', CY, null, 'Open', 0),
          event('EvidenceDelivered', BEA, 'Open', 'Delivered', 1),
          event('Accepted', BEA, 'Delivered', 'Accepted', 2),
        ],
        { acceptanceKind: 'external', acceptanceUserId: BEA, acceptanceLabel: 'Publisher liaison' },
      ),
    );

    expect(selfAcceptance).toBeNull();
  });

  it.each([null, '', '   '])('retains actor identity when the stored label is %j', (actorLabel) => {
    const selfAcceptance = deriveCommsSelfAcceptance(
      obligation([
        event('EvidenceDelivered', BEA, 'Open', 'Delivered', 1, 1, actorLabel),
        event('Accepted', BEA, 'Delivered', 'Accepted', 2, 1, actorLabel),
      ]),
    );

    expect(selfAcceptance).toMatchObject({ actorUserId: BEA, actorLabel });
  });

  it('uses the causal delivery episode when timestamps reverse or tie and UUID order puts acceptance first', () => {
    for (const [acceptedMinute, deliveryMinute] of [
      [1, 2], // transaction-start timestamp reversal
      [1, 1], // timestamp tie; random UUID is the old tie-breaker
    ]) {
      const selfAcceptance = deriveCommsSelfAcceptance(
        obligation([
          // PostgreSQL now() is the transaction-start timestamp: an accept
          // transaction may legally carry an earlier `at` than the delivery it
          // later observes. The immutable episode version, not array order, is
          // the causal link.
          event('Accepted', BEA, 'Delivered', 'Accepted', acceptedMinute, 1),
          event('EvidenceDelivered', BEA, 'Open', 'Delivered', deliveryMinute, 1),
        ]),
      );

      expect(selfAcceptance).toMatchObject({ actorUserId: BEA, actorLabel: 'Bea' });
    }
  });
});
