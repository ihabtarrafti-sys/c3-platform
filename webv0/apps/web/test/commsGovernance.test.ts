/**
 * commsGovernance.test.ts — the Comms UI governance laws, pinned at the source.
 *
 * The behavioral proof of the full arc lives in the Playwright comms spec;
 * these tests pin the LAWS into the component sources so a refactor that
 * drops a governance affordance fails here first (the identityTokens
 * pattern):
 *  - D1: the composer carries the owner-ruled cross-tier visibility warning.
 *  - Chips navigate, never execute: no chip carries an action handler; the
 *    ApprovalLinkReference renders identity + Open only.
 *  - The obligation card derives THREE INDEPENDENT truths from the server
 *    view and render-gates Accept/Reject on the caller's OWN userId.
 *  - D2: obligation minting renders only behind canManageMissions.
 *  - Lapse: MODULE_READ_ONLY flips the read-only posture; the composer is
 *    REMOVED (not disabled), reads and own-prefs stay live.
 *  - /me exposes ONLY the caller's own userId — never a directory.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectLinks } from '../src/tablework/Thread';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string): string => readFileSync(join(srcDir, rel), 'utf8');

describe('Comms governance laws (the pilot UI)', () => {
  it('D1: the composer carries the cross-tier visibility warning (owner-ruled, not optional)', () => {
    const thread = read('tablework/Thread.tsx');
    expect(thread).toContain('Visible to everyone who can see this mission.');
    // And Dawn's navigate-never-execute boundary note rides the same surface.
    expect(thread).toContain('Conversation cannot approve, reject, execute, accept evidence, or record Done.');
  });

  it('chips navigate and never execute: no ObjectLink carries an action handler', () => {
    const message = read('tablework/Message.tsx');
    // The chip renderer builds <Link>/anchors/spans only — an onClick anywhere
    // in the chip component would be an execution affordance.
    const chipSection = message.slice(message.indexOf('function ObjectLinkChip'), message.indexOf('function AttachmentRow'));
    expect(chipSection.length).toBeGreaterThan(0);
    expect(chipSection).not.toContain('onClick');
    // The approval reference is identity + Open, nothing else.
    expect(chipSection).toContain('ApprovalLinkReference');
    expect(chipSection).toContain('Open');
  });

  it('the obligation card derives three INDEPENDENT truths from the server view', () => {
    const card = read('tablework/ObligationCard.tsx');
    expect(card).toContain("const deliveryKnown = o.evidence.length > 0");
    expect(card).toContain("const acceptanceKnown = o.state === 'Accepted' || o.state === 'Done'");
    expect(card).toContain("const doneKnown = o.state === 'Done'");
    // Accept/Reject are the NAMED authority's alone (render-gating; the API is the gate).
    expect(card).toContain("o.state === 'Delivered' && myUserId === o.acceptanceUserId");
    // An external acceptance requires the attestation words.
    expect(card).toMatch(/\(action === 'accept' \|\| action === 'reject'\) && externalAcceptance/);
  });

  it('D2: obligation minting renders only behind canManageMissions (and never through lapse)', () => {
    const page = read('pages/MissionCommsPage.tsx');
    expect(page).toContain('canManageMissions');
    // The mint affordance AND the mint float are both fenced on the capability
    // and the lapse posture — an open float unmounts when the license lapses.
    expect(page).toMatch(/\{canManage && !lapsed \? \(\s*<button/);
    expect(page).toMatch(/\{canManage && !lapsed \? \(\s*<MintObligationFloat/);
    expect(page).toMatch(/if \(lapsed\) setMintOpen\(false\);/);
  });

  it('evidence delivery mirrors the domain gate: the accountable owner or ops on behalf', () => {
    const card = read('tablework/ObligationCard.tsx');
    expect(card).toContain("(myUserId === o.accountableUserId || operational)");
  });

  it('lapse: MODULE_READ_ONLY flips the read-only posture and the composer is REMOVED', () => {
    const page = read('pages/MissionCommsPage.tsx');
    expect(page).toContain("err.code === 'MODULE_READ_ONLY'");
    expect(page).toContain('setLapsed(true)');
    const thread = read('tablework/Thread.tsx');
    // The composer branch renders NOTHING when lapsed — absence, not disablement.
    expect(thread).toMatch(/\{lapsed \? null : \(\s*<form className="compose"/);
  });

  it('/me exposes only the caller-scoped userId — never a directory growth', () => {
    const contracts = readFileSync(join(srcDir, '..', '..', '..', 'packages', 'api-contracts', 'src', 'index.ts'), 'utf8');
    const meBlock = contracts.slice(contracts.indexOf('export const meResponseSchema'), contracts.indexOf('export type MeResponse'));
    expect(meBlock).toContain('userId: z.string().uuid()');
    // The one directory that resolves userIds stays the owner/ops members surface.
    expect(meBlock).not.toContain('members');
  });

  it('the composer detects record references as navigate-only chips (cap 10, deduped)', () => {
    const links = detectLinks('APR-1048 relates to MSN-0001 and APR-1048 again; OBL-0002 too');
    expect(links).toEqual([
      { targetType: 'Approval', targetId: 'APR-1048' },
      { targetType: 'Mission', targetId: 'MSN-0001' },
      { targetType: 'Obligation', targetId: 'OBL-0002' },
    ]);
    const many = detectLinks(Array.from({ length: 15 }, (_, i) => `APR-${1000 + i}`).join(' '));
    expect(many.length).toBe(10);
  });
});
