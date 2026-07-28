import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, type CurrencyCode } from '@c3web/domain';
import { useMissionDistributions, useMissionPnl, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify } from '../session';
import { StatusBadge, GovernedAction, ComparisonTable, Field, Input, Selector, WorkSurface, percentToBpsAllowingZero } from '../tablework';

/**
 * Distributions (S8) — the payout list under a mission's P&L. A distribution
 * allocates ONE Received income line's landed money: org cut + per-person
 * shares (the allocator guarantees org + shares == pool EXACTLY). Payouts
 * flip Pending → Paid with a bank LABEL (never account numbers) + reference;
 * revoking (reason recorded) is legal only while every payout is pending.
 *
 * Wave 4 (Lane C): the Fluent `makeStyles` block is retired. Its consumer
 * (MissionDetailPage) already converted in Wave 3 and settled the mapping for
 * the four declarations this file shares with it — they are token-for-token,
 * not approximations:
 *
 *   section  → `.record-section`      (margin-top --c3-space-8 = the same 32px)
 *   h2       → `.record-section h2`   (--c3-font-size-lead = the same 20px,
 *                                      semibold, ink-strong, margin 0 0 12px)
 *   h2Row    → `.record-section-head` (flex/baseline/space-between/wrap,
 *                                      gap --c3-space-3 = the same 12px)
 *   fields   → DELETED at both sites. Both were inside a `GovernedAction`'s
 *              `extra`, and `.governed-extra` already IS that stack; its
 *              340px min-width was never load-bearing either, since
 *              `dialog.float-surface` is min(28rem) and its body pads to
 *              ~408px of content.
 *
 * The rest:
 *
 *   card     → `WorkSurface tier="elevated" className="record-card"`. ⚠️
 *              `.record-card` carries the padding/rhythm and NO SURFACE — the
 *              border and background come from WorkSurface. Pairing them is
 *              mandatory; `.record-card` alone renders an invisible panel that
 *              typechecks and gates green.
 *   cardHead → `.form-row` (flex/wrap, gap --c3-space-3 = the same 12px; the
 *              kit centres where Fluent baselined, which reads better with a
 *              dotted StatusBadge and a button in the cluster). The 8px
 *              bottom margin is now `.record-card`'s own grid gap.
 *   subtle   → `.record-quiet` everywhere EXCEPT the one in-cell aside, which
 *              rides the kit's `.cell-note` (K3, marker chapter — closed; no
 *              carried style survives in this file).
 *   head     → `.record-quiet` on the same <p>. Deliberately NOT `EmptyState`:
 *              its two sibling empties on this very screen (`participants-empty`,
 *              `mission-pnl-empty`) are quiet in-place sentences, and a centred
 *              48px block would be the odd one out on the mission hub.
 *   mono     → `.mono-wrap` on the distribution id. ⚠️ NOT `className="mono"`:
 *              `.mono` exists ONLY as `.data-grid td.mono` / `.fact-list
 *              dd.mono`, so it styles the CELL and does nothing at all on a
 *              <span>. The two `<td className="mono">` below are inside
 *              `.data-grid` and are therefore already correct.
 *
 * The card list is wrapped in `.record-rows` (grid, --c3-space-2) — the cards
 * are direct children of a `.record-section`, which carries no rhythm of its
 * own, so without it the stacked cards would touch.
 */

// K1 CLOSED (marker chapter): the share input's Fluent-era 90px rides the
// kit's `width="digits"` stop — an EXACT width, byte-identical to the carried
// inline style it replaces (see forms.tsx, the Input width vocabulary).

// K3 CLOSED (marker chapter; tone ruling 2026-07-28): the payout trailer rides
// the kit's `.cell-note` — the cell-scale half of the tone family (same base
// ink, caption size). DISCLOSED NORMALIZATION: the carried 12.5px lands on the
// 12px cell scale — half a pixel, ruled in ("one family, two scales"); the ink
// (quiet) is unchanged.

interface ShareDraft {
  personId: string;
  personName: string;
  bps: string; // percent text, e.g. "45"
}

export function DistributionsSection({ missionId, canManage }: { missionId: string; canManage: boolean }) {
  const { notify } = useNotify();
  const qc = useQueryClient();
  const dists = useMissionDistributions(missionId);
  const people = usePeople();
  // The same cache key MissionPnlSection uses — React Query dedupes the fetch.
  const pnl = useMissionPnl(missionId);
  const lines = pnl.data?.lines ?? [];

  const receivedIncome = lines.filter((l) => l.direction === 'Income' && l.paymentStatus === 'Received' && l.isActive);
  const liveLineIds = new Set((dists.data?.distributions ?? []).filter((v) => v.distribution.status === 'Live').map((v) => v.distribution.lineId));
  const distributable = receivedIncome.filter((l) => !liveLineIds.has(l.lineId));

  const [lineId, setLineId] = useState('');
  const [orgPct, setOrgPct] = useState('20');
  const [drafts, setDrafts] = useState<ShareDraft[] | null>(null);
  const [payoutForms, setPayoutForms] = useState<Record<string, { label: string; refNo: string }>>({});
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['missionDistributions', missionId] });
    void qc.invalidateQueries({ queryKey: ['missionAudit', missionId] });
  };

  async function openSeed(forLineId: string) {
    setLineId(forLineId);
    try {
      const seed = await api.distributionSeed(missionId);
      // ⚖️ MONEY — `!== null`, never truthiness. A seeded suggestion of 0 bps is
      // a real suggestion; `r0.suggestedBps ? …` would blank the row and report
      // "no term on file" for a term that exists and says zero.
      setDrafts(seed.rows.map((r0) => ({ personId: r0.personId, personName: r0.personName, bps: r0.suggestedBps !== null ? String(r0.suggestedBps / 100) : '' })));
    } catch {
      setDrafts([]);
    }
  }

  const activeDrafts = (drafts ?? []).filter((d) => d.bps.trim() !== '');
  // ⚖️ MONEY — ALL FOUR percent sites below stay on `percentToBpsAllowingZero`,
  // and the `> 0` on the share rows stays HERE. orgBps legitimately accepts 0
  // (all-to-players) while each share row must be > 0; both read the SAME
  // parser and the row rule is a CALL-SITE rule. Swapping the row sites to
  // `positivePercentToBps` would compute the same booleans today, and is still
  // refused: it moves a visible per-row condition into an import, and it would
  // split the validator (below) from the WRITE (`onConfirm`) — which must parse
  // under identical rules or an input can pass the gate and reach the API as
  // something else. A blank row is EXCLUDED (the trim filter above), not zero.
  const orgBps = percentToBpsAllowingZero(orgPct);
  const draftBpsSum = activeDrafts.reduce((n, d) => n + (percentToBpsAllowingZero(d.bps) ?? 0), 0);
  const draftsValid =
    orgBps !== null &&
    activeDrafts.every((d) => percentToBpsAllowingZero(d.bps) !== null && percentToBpsAllowingZero(d.bps)! > 0) &&
    (activeDrafts.length === 0 ? orgBps === 10000 : draftBpsSum === 10000);
  const chosenLine = lines.find((l) => l.lineId === lineId);
  // ⚖️ MONEY — `??`, never `||`. A line that landed exactly 0 minor units has a
  // real received amount of 0; `||` would fall through to the EXPECTED amount
  // and state a pool that never arrived.
  const pool = chosenLine ? (chosenLine.receivedAmountMinor ?? chosenLine.amountMinor) : 0;

  return (
    <section className="record-section" data-testid="mission-distributions">
      <div className="record-section-head">
        <h2>Prize distributions</h2>
        {canManage && distributable.length > 0 && (
          <GovernedAction
            triggerLabel="Distribute…"
            triggerTestId="distribute-toggle"
            title="Allocate received money into a payout list"
            description="Org cut + player shares must equal the landed money EXACTLY — the allocator guarantees it to the cent. Shares are % of the player pool and must sum to 100%. Immediate and recorded; payouts are marked as the money moves."
            extra={
              <>
                <Field label="Received income line" required>
                  <Selector
                    data-testid="distribute-line"
                    value={lineId}
                    display={chosenLine ? `${chosenLine.label} — ${formatMoney(pool, chosenLine.currency as CurrencyCode)}` : undefined}
                    options={distributable.map((l) => ({
                      value: l.lineId,
                      // ⚖️ MONEY — the same `??` law as `pool` above, per option.
                      label: `${l.label} — ${formatMoney(l.receivedAmountMinor ?? l.amountMinor, l.currency as CurrencyCode)}`,
                    }))}
                    onSelect={(value) => value && void openSeed(value)}
                  />
                </Field>
                <Field label="Org share %" required hint="The org's cut of the pool; the rest is the player pool.">
                  <Input type="number" value={orgPct} onChange={(e) => setOrgPct(e.target.value)} data-testid="distribute-org-pct" />
                </Field>
                {drafts !== null && (
                  <>
                    <span className="record-quiet">
                      Player shares (% of the player pool — leave blank to exclude; seeded from PrizeShare terms where they exist):
                    </span>
                    {drafts.map((d, i) => (
                      <div key={d.personId} className="form-row">
                        <span className="record-row-name">{d.personName}</span>
                        <span className="record-row-spacer" />
                        <Input
                          width="digits"
                          type="number"
                          value={d.bps}
                          onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, bps: e.target.value } : x)))}
                          data-testid={`distribute-share-${d.personId}`}
                        />
                        <span className="record-quiet">%</span>
                      </div>
                    ))}
                    <Selector
                      data-testid="distribute-add-person"
                      value=""
                      placeholder="Add person…"
                      options={(people.data?.people ?? [])
                        .filter((p) => p.isActive && !drafts.some((x) => x.personId === p.personId))
                        .map((p) => ({ value: p.personId, label: `${p.fullName} (${p.personId})` }))}
                      onSelect={(value) => {
                        if (value && !drafts.some((x) => x.personId === value)) {
                          const p = people.data?.people.find((x) => x.personId === value);
                          setDrafts([...drafts, { personId: value, personName: p?.fullName ?? value, bps: '' }]);
                        }
                      }}
                    />
                    <span className="record-quiet" data-testid="distribute-share-sum">
                      {activeDrafts.length === 0
                        ? orgBps === 10000
                          ? 'No player rows — the org takes 100%.'
                          : 'No player rows: the org share must be 100%.'
                        : `Player shares total ${(draftBpsSum / 100).toFixed(2)}% (must be exactly 100%).`}
                    </span>
                  </>
                )}
              </>
            }
            confirmLabel="Create distribution"
            confirmDisabled={!chosenLine || !draftsValid}
            onConfirm={async () => {
              try {
                const res = await api.createDistribution({
                  missionId,
                  lineId,
                  // ⚖️ MONEY — the WRITE reads the SAME parser as the validator
                  // above, deliberately. Both `!` are safe only because
                  // `confirmDisabled={!chosenLine || !draftsValid}` proved the
                  // parse on these exact strings.
                  orgShareBps: orgBps!,
                  shares: activeDrafts.map((d) => ({ personId: d.personId, shareBps: percentToBpsAllowingZero(d.bps)! })),
                });
                notify('success', `${res.distribution.distributionId} allocated — org ${formatMoney(res.distribution.orgCutMinor, res.distribution.currency)} + ${res.shares.length} payout row${res.shares.length === 1 ? '' : 's'}.`);
                invalidate();
                setLineId('');
                setDrafts(null);
              } catch (err) {
                notify('error', err instanceof ApiError ? err.message : 'The distribution failed.');
                throw err instanceof Error ? err : new Error('failed');
              }
            }}
          />
        )}
      </div>

      {dists.data && dists.data.distributions.length === 0 && (
        <p className="record-quiet" data-testid="distributions-empty">
          No distributions yet — they become available once income is recorded as Received.
        </p>
      )}

      <div className="record-rows">
        {(dists.data?.distributions ?? []).map(({ distribution: d, shares }) => (
          <WorkSurface key={d.distributionId} tier="elevated" className="record-card" data-testid={`distribution-${d.distributionId}`}>
            <div className="form-row">
              <span className="mono-wrap">{d.distributionId}</span>
              <StatusBadge variant={d.status === 'Live' ? 'ready' : 'neutral'} data-testid={`distribution-status-${d.distributionId}`} title={d.revokedReason ?? undefined}>
                {d.status}
              </StatusBadge>
              <span className="record-quiet">
                {`Pool ${formatMoney(d.poolMinor, d.currency)} · org ${(d.orgShareBps / 100).toFixed(2)}% = ${formatMoney(d.orgCutMinor, d.currency)}`}
              </span>
              {canManage && d.status === 'Live' && shares.every((x) => x.payoutStatus === 'Pending') && (
                <GovernedAction
                  triggerLabel="Revoke…"
                  triggerTestId={`revoke-${d.distributionId}`}
                  triggerAppearance="secondary"
                  title={`Revoke ${d.distributionId}?`}
                  description="Legal only while every payout is pending. The allocation stays in history; the line frees up for a corrected distribution. A reason is required and recorded."
                  extra={
                    <Field label="Reason" required>
                      <Input
                        value={revokeReason[d.distributionId] ?? ''}
                        onChange={(e) => setRevokeReason((c) => ({ ...c, [d.distributionId]: e.target.value }))}
                        data-testid={`revoke-reason-${d.distributionId}`}
                      />
                    </Field>
                  }
                  confirmLabel="Revoke distribution"
                  confirmDisabled={(revokeReason[d.distributionId] ?? '').trim() === ''}
                  onConfirm={async () => {
                    try {
                      await api.revokeDistribution(d.distributionId, (revokeReason[d.distributionId] ?? '').trim(), d.version);
                      notify('success', `${d.distributionId} revoked — the line is free for a corrected allocation.`);
                      invalidate();
                    } catch (err) {
                      notify('error', err instanceof ApiError ? err.message : 'The revoke failed.');
                      throw err instanceof Error ? err : new Error('failed');
                    }
                  }}
                />
              )}
            </div>
            {shares.length > 0 && (
              <ComparisonTable label="Payout list">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Share</th>
                    <th>Amount</th>
                    <th>Payout</th>
                    {canManage && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {shares.map((sh) => (
                    <tr key={sh.personId} data-testid={`payout-${d.distributionId}-${sh.personId}`}>
                      <td>{sh.personName}</td>
                      <td className="mono">{(sh.shareBps / 100).toFixed(2)}%</td>
                      <td className="mono">{formatMoney(sh.amountMinor, d.currency)}</td>
                      <td>
                        <StatusBadge variant={sh.payoutStatus === 'Paid' ? 'ready' : 'pending'} data-testid={`payout-status-${d.distributionId}-${sh.personId}`}>
                          {sh.payoutStatus}
                        </StatusBadge>
                        {sh.payoutStatus === 'Paid' && <span className="cell-note">{` · ${sh.paymentSourceLabel}${sh.refNo ? ` · ${sh.refNo}` : ''} · ${sh.paidOn}`}</span>}
                      </td>
                      {canManage && (
                        <td>
                          {d.status === 'Live' && sh.payoutStatus === 'Pending' && (
                            <GovernedAction
                              triggerLabel="Mark paid…"
                              triggerTestId={`pay-${d.distributionId}-${sh.personId}`}
                              triggerAppearance="secondary"
                              title={`Mark ${sh.personName}'s payout as paid?`}
                              description="Record the payment fact: bank LABEL only (never account numbers) plus the bank reference."
                              extra={
                                <>
                                  <Field label="Payment source (bank LABEL)" required>
                                    <Input
                                      value={payoutForms[`${d.distributionId}/${sh.personId}`]?.label ?? ''}
                                      onChange={(e) => setPayoutForms((c) => ({ ...c, [`${d.distributionId}/${sh.personId}`]: { label: e.target.value, refNo: c[`${d.distributionId}/${sh.personId}`]?.refNo ?? '' } }))}
                                      data-testid={`pay-label-${d.distributionId}-${sh.personId}`}
                                    />
                                  </Field>
                                  <Field label="Bank reference">
                                    <Input
                                      value={payoutForms[`${d.distributionId}/${sh.personId}`]?.refNo ?? ''}
                                      onChange={(e) => setPayoutForms((c) => ({ ...c, [`${d.distributionId}/${sh.personId}`]: { label: c[`${d.distributionId}/${sh.personId}`]?.label ?? '', refNo: e.target.value } }))}
                                    />
                                  </Field>
                                </>
                              }
                              confirmLabel="Mark paid"
                              confirmDisabled={(payoutForms[`${d.distributionId}/${sh.personId}`]?.label ?? '').trim() === ''}
                              onConfirm={async () => {
                                const f = payoutForms[`${d.distributionId}/${sh.personId}`]!;
                                try {
                                  await api.markPayout(d.distributionId, sh.personId, {
                                    expectedVersion: sh.version,
                                    paid: true,
                                    paymentSourceLabel: f.label.trim(),
                                    refNo: f.refNo.trim() === '' ? null : f.refNo.trim(),
                                  });
                                  notify('success', `Payout to ${sh.personName} recorded as paid.`);
                                  invalidate();
                                } catch (err) {
                                  notify('error', err instanceof ApiError ? err.message : 'The payout update failed.');
                                  throw err instanceof Error ? err : new Error('failed');
                                }
                              }}
                            />
                          )}
                          {d.status === 'Live' && sh.payoutStatus === 'Paid' && (
                            <GovernedAction
                              triggerLabel="Unmark…"
                              triggerTestId={`unpay-${d.distributionId}-${sh.personId}`}
                              triggerAppearance="secondary"
                              title="Return this payout to pending?"
                              description="An audited correction — the history keeps both events."
                              confirmLabel="Return to pending"
                              onConfirm={async () => {
                                try {
                                  await api.markPayout(d.distributionId, sh.personId, { expectedVersion: sh.version, paid: false });
                                  notify('success', 'Payout returned to pending (recorded).');
                                  invalidate();
                                } catch (err) {
                                  notify('error', err instanceof ApiError ? err.message : 'The correction failed.');
                                  throw err instanceof Error ? err : new Error('failed');
                                }
                              }}
                            />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </ComparisonTable>
            )}
          </WorkSurface>
        ))}
      </div>
    </section>
  );
}
