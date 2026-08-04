import { describe, expect, it } from 'vitest';
import {
  RECORD_AUTHORSHIP_KINDS,
  aiAssistedRecordAuthorshipSchema,
  personRecordAuthorshipSchema,
  recordAuthorshipSchema,
  systemRecordAuthorshipSchema,
} from '../src/authorship';

describe('D-009 record authorship', () => {
  it('has exactly the person, system, and AI-assisted classes', () => {
    expect(RECORD_AUTHORSHIP_KINDS).toEqual(['person', 'system', 'ai_assisted']);
    expect(RECORD_AUTHORSHIP_KINDS).toHaveLength(3);
    expect(
      RECORD_AUTHORSHIP_KINDS.map((kind) => {
        if (kind === 'person') return recordAuthorshipSchema.parse({ kind, userId: 'user-1', label: 'Mara' }).kind;
        if (kind === 'system') return recordAuthorshipSchema.parse({ kind, rule: 'deadline elapsed' }).kind;
        return recordAuthorshipSchema.parse({ kind, provenance: 'HEARTH-001', humanRatification: 'pending' }).kind;
      }),
    ).toEqual(RECORD_AUTHORSHIP_KINDS);
    expect(recordAuthorshipSchema.safeParse({ kind: 'service', rule: 'deadline elapsed' }).success).toBe(false);
  });

  it('requires the person author identity and explicit nullable label', () => {
    expect(personRecordAuthorshipSchema.parse({ kind: 'person', userId: 'user-1', label: null })).toEqual({
      kind: 'person',
      userId: 'user-1',
      label: null,
    });
    expect(personRecordAuthorshipSchema.safeParse({ kind: 'person', label: 'Mara' }).success).toBe(false);
    expect(personRecordAuthorshipSchema.safeParse({ kind: 'person', userId: 'user-1' }).success).toBe(false);
    expect(personRecordAuthorshipSchema.safeParse({ kind: 'person', userId: 1, label: null }).success).toBe(false);
    expect(personRecordAuthorshipSchema.safeParse({ kind: 'person', userId: 'user-1', label: 'Mara', avatar: 'mara.png' }).success).toBe(false);
  });

  it('requires a non-empty deterministic system rule and refuses person-like or acceptance-like keys', () => {
    expect(systemRecordAuthorshipSchema.parse({ kind: 'system', rule: '  due date elapsed  ' })).toEqual({
      kind: 'system',
      rule: 'due date elapsed',
    });
    expect(systemRecordAuthorshipSchema.safeParse({ kind: 'system', rule: '  ' }).success).toBe(false);
    for (const foreignKey of ['person', 'personId', 'userId', 'label', 'name', 'avatar', 'acceptance', 'acceptedBy', 'ratifiedBy']) {
      expect(systemRecordAuthorshipSchema.safeParse({ kind: 'system', rule: 'due date elapsed', [foreignKey]: 'x' }).success).toBe(false);
    }
  });

  it('pins AI assistance to HEARTH-001 and pending human ratification without impersonation keys', () => {
    expect(
      aiAssistedRecordAuthorshipSchema.parse({
        kind: 'ai_assisted',
        provenance: 'HEARTH-001',
        humanRatification: 'pending',
      }),
    ).toEqual({ kind: 'ai_assisted', provenance: 'HEARTH-001', humanRatification: 'pending' });
    expect(
      aiAssistedRecordAuthorshipSchema.safeParse({
        kind: 'ai_assisted',
        provenance: 'HEARTH-002',
        humanRatification: 'pending',
      }).success,
    ).toBe(false);
    expect(
      aiAssistedRecordAuthorshipSchema.safeParse({
        kind: 'ai_assisted',
        provenance: 'HEARTH-001',
        humanRatification: 'accepted',
      }).success,
    ).toBe(false);
    for (const foreignKey of ['person', 'personId', 'userId', 'label', 'name', 'avatar', 'acceptance', 'acceptedBy', 'ratifiedBy']) {
      expect(
        aiAssistedRecordAuthorshipSchema.safeParse({
          kind: 'ai_assisted',
          provenance: 'HEARTH-001',
          humanRatification: 'pending',
          [foreignKey]: 'x',
        }).success,
      ).toBe(false);
    }
  });
});
