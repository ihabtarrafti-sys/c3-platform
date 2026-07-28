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
import { projectApprovalPayload, toApprovalDto, toApprovalSummaryDto } from '../src/dto';

/** A disclosure literal with everything closed by default; open what a case needs. */
const disc = (over: Partial<PayloadDisclosure> = {}): PayloadDisclosure => ({ pii: false, financial: false, members: false, agreements: false, ...over });

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
    // ⚠️ F17 SUPERSEDED the pin that stood here ("termId is identity, it
    // stays"). The ruling: the TRM id is financial-TERM identity — it names
    // which financial term exists, on a register this reader cannot open — so
    // it goes WITH the content it identifies. The AGREEMENT id remains: that
    // is which record, not what it says.
    expect((noFin as { input: Record<string, unknown> }).input.termId).toBeUndefined();
    expect((noFin as { input: Record<string, unknown> }).input.agreementId).toBe('AGR-0001');
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

describe('F02 + F17 — identity fields obey the SAME disclosure decision as the payload', () => {
  /** A minimal Approval whose identity siblings are the probe values. */
  const approvalOf = (payload: unknown, targetId: string | null): Approval =>
    ({
      approvalId: 'APR-0001',
      operationType: (payload as { operationType: string }).operationType,
      targetPersonId: 'PER-0001',
      targetId,
      reason: null,
      status: 'Submitted',
      payload,
      submittedBy: 'ops@alpha.com',
      submittedAt: '2026-07-28T00:00:00.000Z',
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      executedAt: null,
      executionError: null,
      version: 1,
      editCount: 0,
      revisionOf: null,
      supersededBy: null,
      createdAt: '2026-07-28T00:00:00.000Z',
      tenantId: 'alpha',
    }) as unknown as Approval;

  const MEMBER_UUID = '11111111-2222-3333-4444-555555555555';
  const changeRole = { operationType: 'ChangeRole', input: { targetUserId: MEMBER_UUID, email: 'target.member@example.com', toRole: 'finance' } };
  const updateTerm = { operationType: 'UpdateAgreementTerm', input: { agreementId: 'AGR-0001', termId: 'TRM-0001', amountMinor: 500000, currency: 'USD', percentBps: null, label: 'Base salary' } };
  const removeTerm = { operationType: 'RemoveAgreementTerm', input: { agreementId: 'AGR-0001', termId: 'TRM-0001' } };

  it('F02: a member-op targetId does NOT survive to a reader without member standing (detail DTO)', () => {
    const dto = toApprovalDto(approvalOf(changeRole, MEMBER_UUID), disc());
    expect(dto.targetId, 'the projector hides WHO the op names; the sibling must too').toBeNull();
    expect(JSON.stringify(dto)).not.toContain(MEMBER_UUID);
    // and DOES survive for a member-directory reader (never over-omit)
    expect(toApprovalDto(approvalOf(changeRole, MEMBER_UUID), disc({ members: true })).targetId).toBe(MEMBER_UUID);
  });

  it('F02: the register summary makes the same decision', () => {
    // Pre-fix this function took no disclosure; the extra argument is ignored by
    // JS, so THIS EXACT TEXT ran RED against the raw pass-through.
    const summary = (toApprovalSummaryDto as unknown as (a: Approval, d: PayloadDisclosure) => { targetId: string | null })(
      approvalOf(changeRole, MEMBER_UUID),
      disc(),
    );
    expect(summary.targetId, 'the register view must not leak member identity either').toBeNull();
  });

  it('F17: term-op identity (the TRM id) does not survive to a reader without financial standing — payload OR sibling', () => {
    for (const p of [updateTerm, removeTerm]) {
      const projected = JSON.stringify(projectApprovalPayload(p as unknown as Approval['payload'], disc()));
      expect(projected, `${(p as { operationType: string }).operationType}: payload termId is financial-term identity`).not.toContain('TRM-0001');
      // the AGREEMENT id is which-record identity and STAYS (the projector's own law)
      expect(projected).toContain('AGR-0001');
      const dto = toApprovalDto(approvalOf(p, 'TRM-0001'), disc());
      expect(dto.targetId, 'the sibling targetId carries the same TRM id').toBeNull();
    }
    // a financial reader keeps everything (never over-omit)
    const full = JSON.stringify(projectApprovalPayload(updateTerm as unknown as Approval['payload'], disc({ financial: true })));
    expect(full).toContain('TRM-0001');
    expect(toApprovalDto(approvalOf(updateTerm, 'TRM-0001'), disc({ financial: true })).targetId).toBe('TRM-0001');
  });

  it('F02/F17: non-sensitive ops keep their targetId untouched (no over-omission)', () => {
    const renew = { operationType: 'RenewAgreement', input: { agreementId: 'AGR-0001', endsOn: '2027-01-01' } };
    expect(toApprovalDto(approvalOf(renew, 'AGR-0001'), disc()).targetId).toBe('AGR-0001');
  });
});

describe('Block 7 — the agreements axis (owner-authorized; the evidenced minimal)', () => {
  const add = { operationType: 'AddAgreement', input: { personId: 'PER-0001', entityId: null, agreementCode: 'AG-77', agreementType: 'Player Contract', linkedAgreementId: null, startsOn: '2026-08-01', endsOn: '2027-07-31', notes: 'Signed at the summit', valueUsdCents: 250000 } } as unknown as Approval['payload'];
  const renew = { operationType: 'RenewAgreement', input: { agreementId: 'AGR-0001', newEndsOn: '2028-07-31' } } as unknown as Approval['payload'];
  const term = { operationType: 'TerminateAgreement', input: { agreementId: 'AGR-0001', reason: 'Mutual separation' } } as unknown as Approval['payload'];

  it('agreement CONTENT is omitted without register standing; the anchors stay', () => {
    const projected = projectApprovalPayload(add, disc({ pii: true, financial: true }));
    for (const leak of ['Player Contract', 'AG-77', 'Signed at the summit', '2026-08-01', '250000']) {
      expect(JSON.stringify(projected), leak).not.toContain(leak);
    }
    // which-person identity is people-domain and stays
    expect((projected as { input: Record<string, unknown> }).input.personId).toBe('PER-0001');
  });

  it('Renew/Terminate keep only the AGR id (which record, not what it says)', () => {
    const r = projectApprovalPayload(renew, disc());
    expect(JSON.stringify(r)).not.toContain('2028-07-31');
    expect((r as { input: Record<string, unknown> }).input.agreementId).toBe('AGR-0001');
    const t = projectApprovalPayload(term, disc());
    expect(JSON.stringify(t)).not.toContain('Mutual separation');
    expect((t as { input: Record<string, unknown> }).input.agreementId).toBe('AGR-0001');
  });

  it('a register-standing reader is untouched (no over-omission); the financial facet still nests beneath', () => {
    const noFin = projectApprovalPayload(add, disc({ agreements: true }));
    expect((noFin as { input: Record<string, unknown> }).input.agreementType).toBe('Player Contract');
    expect(JSON.stringify(noFin)).not.toContain('250000'); // value still needs financial
    const withFin = projectApprovalPayload(add, disc({ agreements: true, financial: true }));
    expect((withFin as { input: Record<string, unknown> }).input.valueUsdCents).toBe(250000);
    expect(JSON.stringify(projectApprovalPayload(renew, disc({ agreements: true })))).toContain('2028-07-31');
  });

  it('the axis derives from the register predicate, role by role', () => {
    for (const role of C3_ROLES) {
      expect(disclosureOf(role).agreements, role).toBe(['owner', 'operations', 'legal', 'finance', 'management'].includes(role));
    }
  });
});
