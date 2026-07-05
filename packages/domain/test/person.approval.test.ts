import { describe, it, expect } from 'vitest';
import { addPersonInputSchema } from '../src/person';
import { addPersonPayloadSchema, parseApprovalPayload } from '../src/approval';

describe('AddPerson input validation', () => {
  it('requires a non-empty full name', () => {
    expect(addPersonInputSchema.safeParse({ fullName: '' }).success).toBe(false);
    expect(addPersonInputSchema.safeParse({ fullName: '   ' }).success).toBe(false);
  });

  it('trims and normalises optional fields; empties become null', () => {
    const parsed = addPersonInputSchema.parse({
      fullName: '  Jordan Reyes  ',
      ign: '',
      nationality: '  PL ',
      notes: undefined,
    });
    expect(parsed.fullName).toBe('Jordan Reyes');
    expect(parsed.ign).toBeNull();
    expect(parsed.nationality).toBe('PL');
    expect(parsed.notes).toBeNull();
    expect(parsed.primaryDepartment).toBeNull();
  });

  it('strips unknown keys (no SharePoint field smuggling)', () => {
    const res = addPersonInputSchema.safeParse({ fullName: 'X', Id: 5, Title: 'PER-9999' });
    expect(res.success).toBe(false); // strict schema rejects unknown keys outright
  });

  it('enforces max lengths', () => {
    expect(addPersonInputSchema.safeParse({ fullName: 'a'.repeat(201) }).success).toBe(false);
  });
});

describe('AddPerson approval payload (immutable intent snapshot)', () => {
  it('parses a well-formed payload', () => {
    const payload = parseApprovalPayload({ operationType: 'AddPerson', input: { fullName: 'Sam Okoye' } });
    expect(payload.operationType).toBe('AddPerson');
    expect(payload.input.fullName).toBe('Sam Okoye');
  });

  it('rejects an unknown operation type', () => {
    expect(() => parseApprovalPayload({ operationType: 'DropTable', input: { fullName: 'x' } })).toThrow();
  });

  it('rejects a payload missing its input', () => {
    expect(addPersonPayloadSchema.safeParse({ operationType: 'AddPerson' }).success).toBe(false);
  });
});
