import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { makeStyles } from '@fluentui/react-components';
import { formatMoney, type CurrencyCode } from '@c3web/domain';
import { useMissionDistributions, useMissionPnl, usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify } from '../session';
import { StatusBadge, GovernedAction, ComparisonTable, Field, Input, Selector } from '../tablework';

/**
 * Distributions (S8) — the payout list under a mission's P&L. A distribution
 * allocates ONE Received income line's landed money: org cut + per-person
 * shares (the allocator guarantees org + shares == pool EXACTLY). Payouts
 * flip Pending → Paid with a bank LABEL (never account numbers) + reference;
 * revoking (reason recorded) is legal only while every payout is pending.
 */

const useStyles = makeStyles({
  section: { marginTop: '32px' },
  h2: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, color: 'var(--c3-ink-strong)', margin: '0 0 12px' },
  h2Row: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', columnGap: '12px', flexWrap: 'wrap' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '8px', minWidth: '340px' },
  shareRow: { display: 'flex', alignItems: 'center', columnGap: '8px' },
  shareName: { flexGrow: 1, fontSize: '13px' },
  bpsInput: { width: '90px' },
  subtle: { fontSize: '12.5px', color: 'var(--c3-ink-quiet)' },
  head: { fontSize: '13px', color: 'var(--c3-ink-muted)', margin: '0 0 8px' },
  card: { border: '1px solid var(--c3-border-subtle)', borderRadius: 'var(--c3-radius-data)', padding: '12px 16px', marginBottom: '12px', backgroundColor: 'var(--c3-surface-base)' },
  cardHead: { display: 'flex', alignItems: 'baseline', columnGap: '12px', flexWrap: 'wrap', marginBottom: '8px' },
  mono: { fontFamily: 'var(--c3-font-mono)' },
});

interface ShareDraft {
  personId: string;
  personName: string;
  bps: string; // percent text, e.g. "45"
}

export function DistributionsSection({ missionId, canManage }: { missionId: string; canManage: boolean }) {
  const s = useStyles();
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
      setDrafts(seed.rows.map((r0) => ({ personId: r0.personId, personName: r0.personName, bps: r0.suggestedBps !== null ? String(r0.suggestedBps / 100) : '' })));
    } catch {
      setDrafts([]);
    }
  }

  // M-02: exact digit-split percent → bps; sub-bps precision refuses, never rounds.
  const pctToBps = (v: string): number | null => {
    const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(v.trim());
    if (!m) return null;
    const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
    return bps <= 10000 ? bps : null;
  };

  const activeDrafts = (drafts ?? []).filter((d) => d.bps.trim() !== '');
  const orgBps = pctToBps(orgPct);
  const draftBpsSum = activeDrafts.reduce((n, d) => n + (pctToBps(d.bps) ?? 0), 0);
  const draftsValid =
    orgBps !== null &&
    activeDrafts.every((d) => pctToBps(d.bps) !== null && pctToBps(d.bps)! > 0) &&
    (activeDrafts.length === 0 ? orgBps === 10000 : draftBpsSum === 10000);
  const chosenLine = lines.find((l) => l.lineId === lineId);
  const pool = chosenLine ? (chosenLine.receivedAmountMinor ?? chosenLine.amountMinor) : 0;

  return (
    <section className={s.section} data-testid="mission-distributions">
      <div className={s.h2Row}>
        <h2 className={s.h2}>Prize distributions</h2>
        {canManage && distributable.length > 0 && (
          <GovernedAction
            triggerLabel="Distribute…"
            triggerTestId="distribute-toggle"
            title="Allocate received money into a payout list"
            description="Org cut + player shares must equal the landed money EXACTLY — the allocator guarantees it to the cent. Shares are % of the player pool and must sum to 100%. Immediate and recorded; payouts are marked as the money moves."
            extra={
              <div className={s.fields}>
                <Field label="Received income line" required>
                  <Selector
                    data-testid="distribute-line"
                    value={lineId}
                    display={chosenLine ? `${chosenLine.label} — ${formatMoney(pool, chosenLine.currency as CurrencyCode)}` : undefined}
                    options={distributable.map((l) => ({
                      value: l.lineId,
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
                    <span className={s.subtle}>
                      Player shares (% of the player pool — leave blank to exclude; seeded from PrizeShare terms where they exist):
                    </span>
                    {drafts.map((d, i) => (
                      <div key={d.personId} className={s.shareRow}>
                        <span className={s.shareName}>{d.personName}</span>
                        <Input
                          className={s.bpsInput}
                          type="number"
                          value={d.bps}
                          onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, bps: e.target.value } : x)))}
                          data-testid={`distribute-share-${d.personId}`}
                        />
                        <span className={s.subtle}>%</span>
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
                    <span className={s.subtle} data-testid="distribute-share-sum">
                      {activeDrafts.length === 0
                        ? orgBps === 10000
                          ? 'No player rows — the org takes 100%.'
                          : 'No player rows: the org share must be 100%.'
                        : `Player shares total ${(draftBpsSum / 100).toFixed(2)}% (must be exactly 100%).`}
                    </span>
                  </>
                )}
              </div>
            }
            confirmLabel="Create distribution"
            confirmDisabled={!chosenLine || !draftsValid}
            onConfirm={async () => {
              try {
                const res = await api.createDistribution({
                  missionId,
                  lineId,
                  orgShareBps: orgBps!,
                  shares: activeDrafts.map((d) => ({ personId: d.personId, shareBps: pctToBps(d.bps)! })),
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
        <p className={s.head} data-testid="distributions-empty">
          No distributions yet — they become available once income is recorded as Received.
        </p>
      )}

      {(dists.data?.distributions ?? []).map(({ distribution: d, shares }) => (
        <div key={d.distributionId} className={s.card} data-testid={`distribution-${d.distributionId}`}>
          <div className={s.cardHead}>
            <span className={s.mono}>{d.distributionId}</span>
            <StatusBadge variant={d.status === 'Live' ? 'ready' : 'neutral'} data-testid={`distribution-status-${d.distributionId}`} title={d.revokedReason ?? undefined}>
              {d.status}
            </StatusBadge>
            <span className={s.subtle}>
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
                      {sh.payoutStatus === 'Paid' && <span className={s.subtle}>{` · ${sh.paymentSourceLabel}${sh.refNo ? ` · ${sh.refNo}` : ''} · ${sh.paidOn}`}</span>}
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
                              <div className={s.fields}>
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
                              </div>
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
        </div>
      ))}
    </section>
  );
}
