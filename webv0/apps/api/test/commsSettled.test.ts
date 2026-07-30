/**
 * commsSettled.test.ts — C5: SETTLED IS DERIVED, and stays that way.
 *
 * The owner ruled (2026-07-30, ruling 4) for Intel's derived Settled over my
 * "granted by standing", and the reason is the one worth pinning: a STORED
 * settlement is a claim that can drift from the facts that justify it, while a
 * DERIVED one has no independent existence to drift with.
 *
 * So this file does not test a feature — it pins ABSENCES. Every assertion
 * here exists so that a future phase wanting a stored Settled must break a
 * NAMED test: a decision, never a drift.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isObligationSettled, COMMS_OBLIGATION_STATES } from '@c3web/domain';

const here = dirname(fileURLToPath(import.meta.url));
const webv0 = join(here, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(webv0, rel), 'utf8');

describe('C5 — the derivation itself', () => {
  const base = { evidence: [] as unknown[] };

  it('settled ⇔ evidence delivered ∧ acceptance recorded ∧ the Done act — every state exercised, no sampling', () => {
    // WITHOUT evidence, no state settles — including Done, which is the whole
    // point: a Done act alone is a CLAIM, not a settlement.
    for (const state of COMMS_OBLIGATION_STATES) {
      expect(isObligationSettled({ state, ...base }), `no evidence, state=${state}`).toBe(false);
    }
    // WITH evidence, ONLY Done settles (Accepted has acceptance but no Done act).
    for (const state of COMMS_OBLIGATION_STATES) {
      expect(isObligationSettled({ state, evidence: [{}] }), `with evidence, state=${state}`).toBe(state === 'Done');
    }
  });

  it('the derivation has EXACTLY ONE definition site (a second would be a second truth)', () => {
    const domain = read('packages/domain/src/comms.ts');
    expect(domain.match(/export function isObligationSettled/g)?.length).toBe(1);
    // The card DERIVES, it does not re-implement.
    const card = read('apps/web/src/tablework/ObligationCard.tsx');
    // The card assigns `settled` EXACTLY once and from the domain function —
    // no hand-rolled boolean chain living a second life here.
    expect(card.match(/const settled =/g)?.length).toBe(1);
    expect(card).toContain('const settled = isObligationSettled(o)');
  });
});

describe('C5 — the absences the ruling requires (break these deliberately, never by drift)', () => {
  it('NO migration gives a COMMS OBLIGATION a settled column or state', () => {
    // ⚠️ SCOPE, learned by getting it wrong on the first run: `Settled` is a
    // legitimate MISSION FINANCE STAGE (0023: Planning → … → Settled) and
    // appears throughout the settlement race guards. A bare /settled/ sweep
    // convicted three innocent migrations. **A pin must be scoped to its
    // subject, or it convicts the neighbours** — the inverse of the
    // display-grep lesson, and the same root: the search was not the claim.
    const dir = join(webv0, 'packages/persistence/migrations');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const ddl = readFileSync(join(dir, file), 'utf8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('--'))
        .join('\n');
      // A settled column on the comms obligation table…
      if (/comms_obligation[\s\S]{0,2000}?\bsettled(_at)?\b/i.test(ddl)) offenders.push(file);
      // …or 'Settled' added to the obligation's own state vocabulary.
      if (/comms_obligation/i.test(ddl) && /state[^;]{0,300}'Settled'/i.test(ddl)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('NO route and NO usecase writes a settlement', () => {
    const app = read('apps/api/src/app.ts');
    // The obligation transition vocabulary is CLOSED at five acts; `settle` is
    // not among them and must never be added as a sixth.
    expect(app).not.toMatch(/['"`]\/api\/v1\/comms\/obligations\/:obligationId\/settle['"`]/);
    const ops = read('packages/application/src/usecases/commsObligationOps.ts');
    expect(ops).not.toMatch(/\bsettle\s*:/); // no transition-table entry
    expect(ops).not.toMatch(/settledAt|setSettled|markSettled/);
  });

  it('the obligation state machine stays FIVE states — Settled is not one of them', () => {
    expect([...COMMS_OBLIGATION_STATES]).toEqual(['Open', 'Delivered', 'Accepted', 'Done', 'Cancelled']);
  });

  it('the derived station does NOT wear the three-facts vocabulary (it is not a fourth fact)', () => {
    // The battery caught this: `data-truth-state` counts the THREE INDEPENDENT
    // FACTS, and a spec asserts exactly three. Settled is a DERIVATION of them,
    // so it carries its own artifact — using theirs would make a derivation
    // look like a peer.
    const card = read('apps/web/src/tablework/ObligationCard.tsx');
    const block = card.slice(card.indexOf('data-tablework="SettledView"'), card.indexOf('data-tablework="SettledView"') + 400);
    expect(block).toContain('data-settled=');
    expect(block).not.toContain('data-truth-state');
  });

  it('the UI offers NO settle affordance beside the derived station', () => {
    const card = read('apps/web/src/tablework/ObligationCard.tsx');
    const settledBlock = card.slice(card.indexOf('data-tablework="SettledView"'), card.indexOf('data-tablework="SettledView"') + 600);
    expect(settledBlock.length).toBeGreaterThan(0);
    expect(settledBlock).not.toContain('<button');
    expect(settledBlock).not.toContain('onClick');
  });
});
