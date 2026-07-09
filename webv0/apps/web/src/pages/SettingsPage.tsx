import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, makeStyles } from '@fluentui/react-components';
import { CURRENCY_CODES } from '@c3web/api-contracts';
import { useFxRates } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';

/**
 * Settings (Finance S1) — org configuration. The first real setting worth
 * housing: the exchange-rate table. The org maintains one rate per currency —
 * its value in USD (the pivot) — and every cross-rate is derived from those, so
 * money booked in AED can always be shown a truthful "≈ USD" (and any pair).
 */

const PIVOT = 'USD';

const useStyles = makeStyles({
  intro: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-mid)', maxWidth: '640px', marginBottom: '18px' },
  panel: {
    maxWidth: '720px',
    border: '1px solid var(--c3-line)',
    borderRadius: 'var(--c3-radius-data)',
    backgroundColor: 'var(--c3-surface-data)',
    boxShadow: 'var(--c3-e1)',
    overflow: 'hidden',
  },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    padding: '14px 20px',
    borderBottom: '1px solid var(--c3-line)',
  },
  title: { fontSize: '14px', fontWeight: 600, color: 'var(--c3-ink)' },
  meta: {
    marginLeft: 'auto',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '10.5px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-muted)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    columnGap: '16px',
    padding: '12px 20px',
    borderBottom: '1px solid var(--c3-line)',
    flexWrap: 'wrap',
  },
  cur: { fontFamily: 'var(--c3-font-mono)', fontSize: '14px', fontWeight: 600, width: '48px', color: 'var(--c3-ink)' },
  eq: { fontSize: '13px', color: 'var(--c3-ink-mid)', whiteSpace: 'nowrap' },
  rateInput: { width: '120px' },
  inverse: { fontFamily: 'var(--c3-font-mono)', fontSize: '12px', color: 'var(--c3-ink-muted)', minWidth: '160px' },
  pivotNote: { fontSize: '13px', color: 'var(--c3-ink-muted)' },
});

function RateRow({ currency, current, onSaved }: { currency: string; current: number | undefined; onSaved: () => void }) {
  const s = useStyles();
  const { notify } = useNotify();
  const [value, setValue] = useState(current !== undefined ? String(current) : '');
  const [busy, setBusy] = useState(false);
  const parsed = Number(value);
  const valid = value.trim() !== '' && !Number.isNaN(parsed) && parsed > 0;

  async function save() {
    setBusy(true);
    try {
      await api.setFxRate(currency, parsed);
      notify('success', `Rate for ${currency} saved: 1 ${currency} = ${parsed} ${PIVOT}.`);
      onSaved();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not save the rate.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.row}>
      <span className={s.cur}>{currency}</span>
      <span className={s.eq}>1 {currency} =</span>
      <Input
        className={s.rateInput}
        type="number"
        value={value}
        onChange={(_, d) => setValue(d.value)}
        placeholder="0.00"
        contentAfter={<span style={{ fontSize: 12, color: 'var(--c3-ink-muted)' }}>{PIVOT}</span>}
        data-testid={`fx-rate-${currency}`}
      />
      <span className={s.inverse}>
        {valid ? `≈ 1 ${PIVOT} = ${(1 / parsed).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${currency}` : '—'}
      </span>
      <Button appearance="primary" size="small" disabled={!valid || busy} onClick={save} data-testid={`fx-save-${currency}`}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}

export function SettingsPage() {
  const s = useStyles();
  const { me } = useSession();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageEntities ?? false;
  const { data, isLoading, isError, error } = useFxRates(canManage);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Settings" />
        <EmptyState data-testid="settings-denied" message="Settings are available to owners and operations." />
      </div>
    );
  }

  const rateOf = (cur: string): number | undefined => data?.rates.find((r) => r.currency === cur)?.usdPerUnit;

  return (
    <div>
      <PageHeader kicker="Configuration" title="Settings" />
      <p className={s.intro}>
        Exchange rates. Set each currency’s value in {PIVOT} — every cross-rate (any currency to any other) is derived
        from these, so money booked in one currency can always be shown a truthful “≈” in another. Rates are yours to
        maintain; nothing is fetched automatically.
      </p>

      {isLoading && <LoadingState label="Loading rates…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load rates.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && (
        <div className={s.panel} data-testid="fx-rates-panel">
          <div className={s.head}>
            <span className={s.title}>Exchange rates</span>
            <span className={s.meta}>pivot · {PIVOT}</span>
          </div>
          <div className={s.row}>
            <span className={s.cur}>{PIVOT}</span>
            <span className={s.pivotNote}>The pivot currency. Fixed at 1 — every other rate is expressed against it.</span>
          </div>
          {CURRENCY_CODES.filter((c) => c !== PIVOT).map((c) => (
            <RateRow key={c} currency={c} current={rateOf(c)} onSaved={() => void qc.invalidateQueries({ queryKey: ['fxRates'] })} />
          ))}
        </div>
      )}
    </div>
  );
}
