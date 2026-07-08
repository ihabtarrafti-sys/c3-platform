/**
 * equipment.test.ts — Sprint 38 K1 evidence: the Kit/Apparel domain contracts.
 * Shared create/update schemas (partial patch + mandatory version, empty patch
 * refused), the new id kinds, the six audit actions, and the capability split
 * — including HR's deliberate promotion (apparel yes, kit no).
 */
import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTIONS,
  OPERATION_TYPES,
  equipmentCreateInputSchema,
  equipmentUpdateInputSchema,
  formatKitId,
  formatApparelId,
  isKitId,
  isApparelId,
  capabilitiesFor,
  C3_ROLES,
} from '../src/index';

describe('registries (Sprint 38)', () => {
  it('registers KIT/APL id kinds and the six audit actions — and NO new operation types', () => {
    expect(formatKitId(7)).toBe('KIT-0007');
    expect(formatApparelId(5)).toBe('APL-0005');
    expect(isKitId('KIT-0007')).toBe(true);
    expect(isApparelId('APL-0005')).toBe(true);
    expect(isApparelId('APP-0005')).toBe(false);
    for (const a of ['KitCreated', 'KitUpdated', 'KitDeactivated', 'ApparelCreated', 'ApparelUpdated', 'ApparelDeactivated']) {
      expect(AUDIT_ACTIONS).toContain(a);
    }
    // Direct-audited CRUD: nothing enters the approval pipeline.
    expect(OPERATION_TYPES.some((op) => /Kit|Apparel/.test(op))).toBe(false);
  });
});

describe('equipmentCreateInputSchema', () => {
  const valid = { name: '  Tournament headset #3 ', category: 'Peripheral' };

  it('parses and normalises; optional fields default null', () => {
    const p = equipmentCreateInputSchema.parse(valid);
    expect(p.name).toBe('Tournament headset #3');
    expect(p.size).toBeNull();
    expect(p.assignedPersonId).toBeNull();
    expect(p.notes).toBeNull();
  });

  it('accepts an assigned person by canonical id; rejects junk', () => {
    expect(equipmentCreateInputSchema.parse({ ...valid, assignedPersonId: 'PER-0001' }).assignedPersonId).toBe('PER-0001');
    expect(() => equipmentCreateInputSchema.parse({ ...valid, assignedPersonId: 'person-1' })).toThrow(/PER id/);
    expect(() => equipmentCreateInputSchema.parse({ name: '', category: 'X' })).toThrow(/Name is required/);
    expect(() => equipmentCreateInputSchema.parse({ category: 'X' })).toThrow(); // missing key = type error
    expect(() => equipmentCreateInputSchema.parse({ ...valid, extra: 'x' })).toThrow();
  });
});

describe('equipmentUpdateInputSchema (the ETag-parity patch)', () => {
  it('requires the expected version and at least one editable field', () => {
    const p = equipmentUpdateInputSchema.parse({ expectedVersion: 2, name: 'Renamed' });
    expect(p.expectedVersion).toBe(2);
    expect(p.name).toBe('Renamed');
    expect(() => equipmentUpdateInputSchema.parse({ expectedVersion: 2 })).toThrow(/at least one field/);
    expect(() => equipmentUpdateInputSchema.parse({ name: 'No version' })).toThrow();
  });

  it('supports unassignment (explicit null) distinct from omission', () => {
    const p = equipmentUpdateInputSchema.parse({ expectedVersion: 1, assignedPersonId: null });
    expect(p.assignedPersonId).toBeNull();
    expect('assignedPersonId' in p).toBe(true);
  });
});

describe('capability split (CP parity)', () => {
  it('owner and operations manage both; HR manages APPAREL ONLY; the rest manage neither', () => {
    for (const role of ['owner', 'operations'] as const) {
      expect(capabilitiesFor(role).canManageKit).toBe(true);
      expect(capabilitiesFor(role).canManageApparel).toBe(true);
    }
    expect(capabilitiesFor('hr')).toMatchObject({ canManageKit: false, canManageApparel: true, isReadOnly: false });
    for (const role of ['legal', 'finance', 'management', 'visitor'] as const) {
      expect(capabilitiesFor(role).canManageKit).toBe(false);
      expect(capabilitiesFor(role).canManageApparel).toBe(false);
    }
    // Totality: every role fully specifies the new fields.
    for (const role of C3_ROLES) {
      expect(typeof capabilitiesFor(role).canManageKit).toBe('boolean');
      expect(typeof capabilitiesFor(role).canManageApparel).toBe('boolean');
    }
  });
});
