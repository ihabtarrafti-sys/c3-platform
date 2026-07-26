/**
 * approvalProjection.test.ts — HARDEN-3 H-02 (approval-view half) + H-03/H-03.1.
 * projectApprovalPayload projects the approval payload BY the reader's standing:
 * AddPerson PII omitted without PII standing; beneficiary routing without
 * financial standing; and (H-03.1) member-operation identity without
 * member-directory standing. The immutable stored payload is untouched — this is
 * the WIRE view only.
 */
import { describe, expect, it } from 'vitest';
import type { Approval } from '@c3web/domain';
import { C3_ROLES } from '@c3web/domain';
import { disclosureOf, canReadMembers, type PayloadDisclosure } from '@c3web/authz';
import { projectApprovalPayload } from '../src/dto';

/** A disclosure literal with everything closed by default; open what a case needs. */
const disc = (over: Partial<PayloadDisclosure> = {}): PayloadDisclosure => ({ pii: false, financial: false, members: false, ...over });

const addPersonPayload = {
  operationType: 'AddPerson',
  input: {
    fullName: 'Priya Vasquez',
    ign: null,
    nationality: null,
    primaryRole: null,
    personnelCode: null,
    currentTeam: null,
    currentGameTitle: null,
    primaryDepartment: null,
    entityId: null,
    notes: 'Self-submitted via guest intake.',
    dateOfBirth: '1998-05-01',
    email: 'priya@x.com',
    phone: '+971500000000',
    addressLine1: '12 Marina Walk',
    addressLine2: null,
    addressCity: 'Dubai',
    addressCountry: 'AE',
  },
} as unknown as Approval['payload'];

const PII = ['dateOfBirth', 'email', 'phone', 'addressLine1', 'addressLine2', 'addressCity', 'addressCountry'];

describe('projectApprovalPayload — AddPerson PII (H-02)', () => {
  it('omits every PII field for a reader without PII standing; keeps operational fields', () => {
    const projected = projectApprovalPayload(addPersonPayload, disc({ financial: true }));
    const input = (projected as { input: Record<string, unknown> }).input;
    for (const f of PII) expect(input).not.toHaveProperty(f);
    expect(input.fullName).toBe('Priya Vasquez');
    for (const leak of ['priya@x.com', '1998-05-01', '971500000000', 'Marina Walk']) {
      expect(JSON.stringify(projected)).not.toContain(leak);
    }
  });

  it('keeps PII for a reader WITH PII standing', () => {
    const projected = projectApprovalPayload(addPersonPayload, disc({ pii: true, financial: true }));
    const input = (projected as { input: Record<string, unknown> }).input;
    expect(input.email).toBe('priya@x.com');
    expect(input.dateOfBirth).toBe('1998-05-01');
  });
});

describe('projectApprovalPayload — H-03 exhaustive + fail-closed', () => {
  it('FAIL-CLOSED: an unhandled op type never leaks its input — only operationType', () => {
    const rogue = { operationType: 'FutureUnmappedOp', input: { secret: 'leak-me' } } as unknown as Approval['payload'];
    const projected = projectApprovalPayload(rogue, disc({ pii: true, financial: true, members: true }));
    expect(projected).toEqual({ operationType: 'FutureUnmappedOp' });
    expect(JSON.stringify(projected)).not.toContain('leak-me');
  });

  it('beneficiary bank routing is omitted without financial standing, present with it', () => {
    const ben = {
      operationType: 'AddBeneficiary',
      input: { personId: 'PER-0001', label: 'Main', bankName: 'Emirates NBD', bankCountry: 'AE', currency: 'AED' },
    } as unknown as Approval['payload'];
    const noFin = projectApprovalPayload(ben, disc({ pii: true }));
    expect(JSON.stringify(noFin)).not.toContain('Emirates NBD');
    expect(JSON.stringify(noFin)).not.toContain('bankCountry');
    expect((noFin as { input: Record<string, unknown> }).input.label).toBe('Main'); // non-routing kept
    const withFin = projectApprovalPayload(ben, disc({ pii: true, financial: true }));
    expect((withFin as { input: Record<string, unknown> }).input.bankName).toBe('Emirates NBD');
  });

  // ── PRISM F01 / F09 / F10 ────────────────────────────────────────────────
  // One defect shape in three places: a strip written for ONE variant, doing
  // NOTHING for the others while still returning a projected-looking object.
  // The test above proves the beneficiary strip works — using AddBeneficiary,
  // the FLAT shape where it does. UpdateBeneficiary nests the same fields and
  // was never covered, which is how F01 shipped.

  it('F01: UpdateBeneficiary nests bank routing under `patch` — it must NOT survive without financial standing', () => {
    const upd = {
      operationType: 'UpdateBeneficiary',
      input: {
        beneficiaryId: 'BEN-0001',
        patch: { label: 'Renamed', bankName: 'Emirates NBD', bankCountry: 'AE' },
      },
    } as unknown as Approval['payload'];
    const noFin = projectApprovalPayload(upd, disc({ pii: true }));
    // RED against the pre-fix projector: the destructure targets TOP-LEVEL
    // bankName/bankCountry, which do not exist here, so `...input` carried the
    // whole `patch` through intact.
    expect(JSON.stringify(noFin)).not.toContain('Emirates NBD');
    expect(JSON.stringify(noFin)).not.toContain('bankCountry');
    // The non-routing part of the patch still reaches the reader.
    const patch = (noFin as { input: { patch?: Record<string, unknown> } }).input.patch;
    expect(patch?.label).toBe('Renamed');
    // With standing, nothing is withheld.
    const withFin = projectApprovalPayload(upd, disc({ pii: true, financial: true }));
    expect(JSON.stringify(withFin)).toContain('Emirates NBD');
  });

  it('F09: agreement-term kind and label are financial CONTENT — they must NOT survive without standing', () => {
    const term = {
      operationType: 'AddAgreementTerm',
      input: { agreementId: 'AGR-0001', kind: 'Salary', label: 'Base monthly salary', amountMinor: 1500000, currency: 'AED' },
    } as unknown as Approval['payload'];
    const noFin = projectApprovalPayload(term, disc({ pii: true }));
    expect(JSON.stringify(noFin)).not.toContain('Salary');
    expect(JSON.stringify(noFin)).not.toContain('Base monthly salary');
    // The agreement it belongs to is identity, not content — it stays.
    expect((noFin as { input: Record<string, unknown> }).input.agreementId).toBe('AGR-0001');
    const withFin = projectApprovalPayload(term, disc({ pii: true, financial: true }));
    expect((withFin as { input: Record<string, unknown> }).input.kind).toBe('Salary');
  });

  it('F09: the OTHER variant of the shared case — UpdateAgreementTerm strips its label too', () => {
    // F01 existed because a shared `case` block was tested for ONE variant only.
    // AddAgreementTerm and UpdateAgreementTerm still share a block, so BOTH are
    // asserted. Verified flat (Update carries `termId`, not a nested patch) — this
    // pins that, so a future nesting change fails here instead of leaking.
    const upd = {
      operationType: 'UpdateAgreementTerm',
      input: { agreementId: 'AGR-0001', termId: 'TRM-0001', label: 'Revised retainer', amountMinor: 900000, currency: 'AED' },
    } as unknown as Approval['payload'];
    const noFin = projectApprovalPayload(upd, disc({ pii: true }));
    expect(JSON.stringify(noFin)).not.toContain('Revised retainer');
    expect(JSON.stringify(noFin)).not.toContain('900000');
    // termId is identity, not content — it stays (Neural: lower class than F09).
    expect((noFin as { input: Record<string, unknown> }).input.termId).toBe('TRM-0001');
  });

  it('F10: ImportBatch carries people/credentials rows too — the strip covered only `agreements`', () => {
    const people = {
      operationType: 'ImportBatch',
      input: {
        domain: 'people',
        fileName: 'roster.csv',
        rowCount: 1,
        people: [{ fullName: 'Jordan Reyes', personalEmail: 'jordan@example.com' }],
      },
    } as unknown as Approval['payload'];
    const noFin = projectApprovalPayload(people, disc({ pii: true }));
    // RED: only `agreements` was destructured, so a people import passed EVERY
    // row through — a whole roster, to a reader without financial standing.
    expect(JSON.stringify(noFin)).not.toContain('Jordan Reyes');
    expect(JSON.stringify(noFin)).not.toContain('jordan@example.com');
    // The batch's own identity survives — domain, file, count are not row content.
    expect((noFin as { input: Record<string, unknown> }).input).toMatchObject({ domain: 'people', fileName: 'roster.csv', rowCount: 1 });

    const creds = {
      operationType: 'ImportBatch',
      input: {
        domain: 'credentials',
        fileName: 'visas.csv',
        rowCount: 1,
        credentials: [{ personId: 'PER-0001', credentialType: 'Visa', documentNumber: 'X1234567' }],
      },
    } as unknown as Approval['payload'];
    expect(JSON.stringify(projectApprovalPayload(creds, disc({ pii: true })))).not.toContain('X1234567');
  });

  it('a non-sensitive op type passes through in full (no over-omission)', () => {
    const dep = { operationType: 'DeactivatePerson', input: { personId: 'PER-0001', reason: 'left the org' } } as unknown as Approval['payload'];
    const projected = projectApprovalPayload(dep, disc());
    expect((projected as { input: Record<string, unknown> }).input).toMatchObject({ personId: 'PER-0001', reason: 'left the org' });
  });
});

describe('projectApprovalPayload — H-03.1 member-directory disclosure (op × role × delegation)', () => {
  const provision = {
    operationType: 'ProvisionMember',
    input: {
      email: 'newhire@example.com',
      displayName: 'New Hire',
      role: 'operations',
      identity: { provider: 'entra', issuerTenantId: 'issuer-xyz', subject: 'subject-abc' },
    },
  } as unknown as Approval['payload'];
  const IDENTIFIERS = ['newhire@example.com', 'New Hire', 'issuer-xyz', 'subject-abc'];

  // op-type × role matrix over EVERY role: a member operation's identity reaches
  // ONLY readers with member-directory standing; everyone else gets op type +
  // granted role (context without who).
  for (const role of C3_ROLES) {
    it(`ProvisionMember: role '${role}' ${canReadMembers(role) ? 'sees' : 'is denied'} member identity`, () => {
      const projected = projectApprovalPayload(provision, disclosureOf(role));
      const json = JSON.stringify(projected);
      if (canReadMembers(role)) {
        expect(json).toContain('newhire@example.com');
        expect(json).toContain('subject-abc');
      } else {
        for (const s of IDENTIFIERS) expect(json).not.toContain(s);
        expect(projected).toMatchObject({ operationType: 'ProvisionMember', input: { role: 'operations' } });
      }
    });
  }

  it('ChangeRole / DeactivateMember / ReactivateMember hide the target member id from non-member readers', () => {
    const nonMember = C3_ROLES.find((r) => !canReadMembers(r))!;
    const d = disclosureOf(nonMember);
    const uid = '11111111-2222-3333-4444-555555555555';
    const email = 'target.member@example.com';
    const change = { operationType: 'ChangeRole', input: { targetUserId: uid, email, toRole: 'finance' } } as unknown as Approval['payload'];
    const deact = { operationType: 'DeactivateMember', input: { targetUserId: uid, email } } as unknown as Approval['payload'];
    const react = { operationType: 'ReactivateMember', input: { targetUserId: uid, email } } as unknown as Approval['payload'];
    for (const p of [change, deact, react]) {
      const json = JSON.stringify(projectApprovalPayload(p, d));
      expect(json).not.toContain(uid); // target member id hidden
      expect(json).not.toContain(email); // target member email hidden
    }
    // ChangeRole still shows the target role (non-identifying context).
    expect(projectApprovalPayload(change, d)).toMatchObject({ operationType: 'ChangeRole', input: { toRole: 'finance' } });
    // A member-directory reader DOES see the target id + email.
    const member = C3_ROLES.find((r) => canReadMembers(r))!;
    expect(JSON.stringify(projectApprovalPayload(change, disclosureOf(member)))).toContain(uid);
  });

  it('delegation does not widen disclosure: a delegate whose role cannot read Members still gets omission', () => {
    // disclosureOf is ROLE-only by design — a delegated reader's disclosure is
    // disclosureOf(their own role). So even though a delegate CAN reach the
    // approval detail, a delegate whose base role lacks member-directory standing
    // gets the same omission as any other non-member reader. (This is the round-2
    // edge: read access via delegation must not imply member-directory sight.)
    const nonMember = C3_ROLES.find((r) => !canReadMembers(r))!;
    const projected = projectApprovalPayload(provision, disclosureOf(nonMember));
    for (const s of IDENTIFIERS) expect(JSON.stringify(projected)).not.toContain(s);
  });
});
