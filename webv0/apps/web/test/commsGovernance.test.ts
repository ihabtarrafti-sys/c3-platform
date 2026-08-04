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
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CommsObligationDto } from '@c3web/api-contracts';
import { detectLinks } from '../src/tablework/Thread';
import { ObligationCard } from '../src/tablework/ObligationCard';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string): string => readFileSync(join(srcDir, rel), 'utf8');

describe('Comms governance laws (the pilot UI)', () => {
  it('D1 → THE AUDIENCE TREATY (Phase B, superseded in place): the composer derives its audience as a TRUTH, and an unverified audience disables Send', () => {
    // The D1 text now rides the mission page as the treaty's verified line;
    // Thread carries the MECHANISM (the data-treaty artifact + the disabled
    // Send) — Intel's contract, adopted at the exact disclosure boundary.
    const page = read('pages/MissionCommsPage.tsx');
    expect(page).toContain('Visible to everyone who can see this mission.');
    const thread = read('tablework/Thread.tsx');
    // The kit's component vocabulary keeps its EXACT value (other specs match
    // it exactly); the treaty's state rides its own artifact.
    expect(thread).toContain('data-tablework="VisibilityWarning"');
    expect(thread).toContain('data-treaty=');
    expect(thread).toContain('!audienceTreaty.verified');
    expect(thread).toContain('Send is disabled rather than guessing');
    // Fail-closed does not hide the reason: an unverified audience keeps the
    // treaty and disabled Send visible while every composer input is inert.
    expect(thread).not.toContain('hidden={!actionsFresh}');
    expect(thread).toContain('aria-disabled={!actionsFresh}');
    expect(thread).toContain('if (!actionsFresh) return;');
    const composer = thread.slice(thread.indexOf('{lapsed ? null : ('), thread.indexOf('</form>') + '</form>'.length);
    expect(composer).toMatch(/<textarea[^>]*disabled=\{!actionsFresh\}/);
    expect(composer).toMatch(/type="checkbox"[^>]*disabled=\{!actionsFresh\}/);
    expect(composer).toMatch(/<select[^>]*disabled=\{!actionsFresh\}/);
    expect(composer).toMatch(/type="file"[^>]*disabled=\{posting \|\| !actionsFresh\}/);
    expect(composer).toMatch(/className="mini-action"[^>]*disabled=\{posting \|\| !actionsFresh\}/);
    expect(composer).toMatch(/className="primary-action"[^>]*!actionsFresh[^>]*!audienceTreaty\.verified/);
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

  it('D-010: same-person acceptance is permitted and stated from recorded actors, never inferred from role overlap', () => {
    const card = read('tablework/ObligationCard.tsx');
    const page = read('pages/MissionCommsPage.tsx');
    const truth = read('tablework/TruthValue.tsx');

    expect(card).toContain('deriveCommsSelfAcceptance');
    expect(card).toContain('data-tablework="AcceptanceProvenance"');
    expect(card).toContain('data-acceptance-shape="self"');
    expect(card).toContain('both delivered evidence and accepted it as the named authority');
    expect(card).toContain("selfAcceptance.actorLabel?.trim() || nameOf(selfAcceptance.actorUserId).trim() || 'Member'");
    expect(card).toMatch(/label="Acceptance"[\s\S]*announce/);
    expect(truth).toContain("aria-live={announce ? 'polite' : undefined}");
    expect(truth).toContain("aria-atomic={announce ? 'true' : undefined}");
    expect(page).not.toContain('cannot be their own acceptance authority');
    expect(page).not.toContain('sodViolation');
    expect(page).toContain('C3 will record that same-person act plainly');
  });

  it('D-010: a direct cancellation preserves and visibly weights immutable same-person acceptance as superseded history', () => {
    const obligation: CommsObligationDto = {
      obligationId: 'OBL-0001',
      threadId: 'THR-0001',
      sourceMessageId: null,
      state: 'Cancelled',
      description: 'Ship the signed pack',
      accountableUserId: '11111111-1111-4111-8111-111111111111',
      requesterUserId: '33333333-3333-4333-8333-333333333333',
      beneficiaryKind: 'external',
      beneficiaryUserId: null,
      beneficiaryLabel: 'Publisher',
      acceptanceKind: 'account',
      acceptanceUserId: '22222222-2222-4222-8222-222222222222',
      acceptanceLabel: null,
      dueAt: '2026-08-03T10:00:00.000Z',
      evidenceRequirement: 'Signed pack',
      version: 3,
      createdAt: '2026-08-02T10:00:00.000Z',
      events: [
        {
          eventType: 'EvidenceDelivered',
          fromState: 'Open',
          toState: 'Delivered',
          actorUserId: '22222222-2222-4222-8222-222222222222',
          actorLabel: 'Bea',
          reason: null,
          attestation: null,
          deliveryEpisodeVersion: 1,
          at: '2026-08-02T10:01:00.000Z',
        },
        {
          eventType: 'Accepted',
          fromState: 'Delivered',
          toState: 'Accepted',
          actorUserId: '22222222-2222-4222-8222-222222222222',
          actorLabel: 'Bea',
          reason: null,
          attestation: null,
          deliveryEpisodeVersion: 1,
          at: '2026-08-02T10:02:00.000Z',
        },
        {
          eventType: 'Cancelled',
          fromState: 'Accepted',
          toState: 'Cancelled',
          actorUserId: '33333333-3333-4333-8333-333333333333',
          actorLabel: 'Cy',
          reason: 'No longer required',
          attestation: null,
          deliveryEpisodeVersion: null,
          at: '2026-08-02T10:03:00.000Z',
        },
      ],
      evidence: [
        {
          documentId: 'DOC-0001',
          fileName: 'signed-pack.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          deliveredByUserId: '22222222-2222-4222-8222-222222222222',
          delivererLabel: 'Bea',
          note: null,
          deliveredAt: '2026-08-02T10:01:00.000Z',
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(ObligationCard, {
        obligation,
        myUserId: obligation.requesterUserId,
        operational: false,
        lapsed: false,
        readOnly: false,
        busy: false,
        nameOf: (userId: string) => userId,
        onTransition: async () => true,
        onDeliverEvidence: async () => undefined,
      }),
    );

    expect(markup).toContain('data-acceptance-lifecycle="cancelled"');
    expect(markup).toContain('data-acceptance-emphasis="governance-sensitive"');
    expect(markup).toContain('Before cancellation, Bea both delivered evidence and accepted it as the named authority.');
    expect(markup).not.toContain('Not recorded · awaiting named authority');
    expect(markup).toContain('data-tablework="SettledView"');
    expect(markup).toContain('data-provenance="deterministic-rule"');
    expect(markup).toContain('System-derived status');
    expect(markup).toContain('Rule · Settled only when Delivery, Acceptance, and Done are all recorded.');
    expect(markup).toContain('Not settled — the three facts above are not all recorded yet.');
    expect(markup).toContain('States status only · does not record acceptance.');
    const settledStart = markup.indexOf('data-tablework="SettledView"');
    const settledMarkup = markup.slice(settledStart, markup.indexOf('</section>', settledStart));
    expect(settledStart).toBeGreaterThan(-1);
    expect(settledMarkup).not.toContain('actor-avatar');
    expect(settledMarkup).not.toContain('data-authorship');

    const ordinaryObligation: CommsObligationDto = {
      ...obligation,
      events: obligation.events.map((event) =>
        event.eventType === 'EvidenceDelivered'
          ? {
              ...event,
              actorUserId: obligation.accountableUserId,
              actorLabel: 'Ali',
            }
          : event,
      ),
      evidence: obligation.evidence.map((record) => ({
        ...record,
        deliveredByUserId: obligation.accountableUserId,
        delivererLabel: 'Ali',
      })),
    };
    const ordinaryMarkup = renderToStaticMarkup(
      createElement(ObligationCard, {
        obligation: ordinaryObligation,
        myUserId: ordinaryObligation.requesterUserId,
        operational: false,
        lapsed: false,
        readOnly: false,
        busy: false,
        nameOf: (userId: string) => userId,
        onTransition: async () => true,
        onDeliverEvidence: async () => undefined,
      }),
    );

    expect(ordinaryMarkup).toContain('data-acceptance-shape="ordinary"');
    expect(ordinaryMarkup).not.toContain('data-acceptance-emphasis="governance-sensitive"');
    expect(ordinaryMarkup).toContain('Before cancellation, Bea accepted it as the named authority.');
    expect(ordinaryMarkup).not.toContain('Not recorded · awaiting named authority');

    const externalObligation: CommsObligationDto = {
      ...ordinaryObligation,
      acceptanceKind: 'external',
      acceptanceLabel: 'Publisher liaison',
    };
    const externalMarkup = renderToStaticMarkup(
      createElement(ObligationCard, {
        obligation: externalObligation,
        myUserId: externalObligation.requesterUserId,
        operational: false,
        lapsed: false,
        readOnly: false,
        busy: false,
        nameOf: (userId: string) => userId,
        onTransition: async () => true,
        onDeliverEvidence: async () => undefined,
      }),
    );

    expect(externalMarkup).toContain('data-acceptance-shape="ordinary"');
    expect(externalMarkup).toContain('Before cancellation, Publisher liaison');
    expect(externalMarkup).toContain('acceptance was recorded by Bea.');
    expect(externalMarkup).not.toContain('data-acceptance-shape="self"');
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
