import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Input, Option, makeStyles } from '@fluentui/react-components';
import { CURRENCY_CODES, type DataQualityReportDto } from '@c3web/api-contracts';
import { formatMoney, parseDecimalToMinor, type CurrencyCode } from '@c3web/domain';
import { useDataQuality, useFxRates, usePerDiemPresets } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { BackupStatusSection, DelegationSection } from '../components/SettingsGovernanceSections';

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
  const { notify } = useNotify();
  const [refreshing, setRefreshing] = useState(false);

  async function refreshRates() {
    setRefreshing(true);
    try {
      const res = await api.refreshFxRates();
      const asOf = new Date(res.asOf).toLocaleString();
      notify(
        'success',
        res.refreshed.length > 0
          ? `Updated ${res.refreshed.join(', ')} from ${res.source} (as of ${asOf}).${res.skipped.length ? ` No live rate for ${res.skipped.join(', ')}.` : ''}`
          : `The source carried no supported rates${res.skipped.length ? ` (missing ${res.skipped.join(', ')})` : ''}.`,
      );
      void qc.invalidateQueries({ queryKey: ['fxRates'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not refresh rates.');
    } finally {
      setRefreshing(false);
    }
  }

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
        from these, so money booked in one currency can always be shown a truthful “≈” in another. Maintain them by hand,
        or pull the current rates from a live source with <em>Refresh from source</em>; either way the numbers stay yours.
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
            <span style={{ flexGrow: 1 }} />
            <Button appearance="secondary" size="small" disabled={refreshing} onClick={() => void refreshRates()} data-testid="fx-refresh">
              {refreshing ? 'Refreshing…' : 'Refresh from source'}
            </Button>
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

      <PerDiemPresetsSection />
      <ImportExportSection />
      <DataQualitySection />
      <DelegationSection />
      <BackupStatusSection />
    </div>
  );
}

// ── HARDEN-2: per-diem presets — the S2 rider comes home ─────────────────────
// The org's quick-pick daily rates (their real config: 65 SAR / 100 SAR /
// 25 USD as the defaults) surface as buttons in the per-diem dialog. Edits
// are version-guarded (M-03): a concurrent editor refuses, never merges.

function PerDiemPresetsSection() {
  const s = useStyles();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = usePerDiemPresets();
  const [draft, setDraft] = useState<Array<{ amountMinor: number; currency: CurrencyCode }> | null>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('SAR');
  const [busy, setBusy] = useState(false);

  const presets = draft ?? (data?.presets as Array<{ amountMinor: number; currency: CurrencyCode }> | undefined) ?? [];
  const addMinor = parseDecimalToMinor(amount);
  const addValid = addMinor !== null && addMinor > 0 && !presets.some((p) => p.amountMinor === addMinor && p.currency === currency);

  async function save() {
    setBusy(true);
    try {
      await api.setPerDiemPresets(presets, data?.version ?? null);
      notify('success', 'Per-diem presets saved and recorded.');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['perDiemPresets'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not save the presets.');
      if (err instanceof ApiError && err.status === 409) {
        setDraft(null);
        void qc.invalidateQueries({ queryKey: ['perDiemPresets'] });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className={s.intro} style={{ marginTop: '32px' }}>
        Per-diem presets. The daily rates your missions actually use — they appear as one-click picks in every
        per-diem dialog. Edit the list here; saving is recorded, and a colleague editing at the same time is refused
        rather than silently overwritten.
      </p>
      <div className={s.panel} data-testid="perdiem-presets-panel">
        <div className={s.head}>
          <span className={s.title}>Per-diem presets</span>
          <span className={s.meta} data-testid="perdiem-presets-state">
            {data ? (data.version === null && !draft ? 'defaults' : draft ? 'unsaved changes' : `v${data.version}`) : '…'}
          </span>
        </div>
        {isLoading && <LoadingState label="Loading presets…" />}
        {isError && (
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not load the presets.'}
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
          />
        )}
        {data && (
          <>
            {presets.map((p, i) => (
              <div key={`${p.amountMinor}-${p.currency}`} className={s.row} data-testid={`perdiem-preset-row-${i}`}>
                <span className={s.eq} style={{ fontWeight: 600 }}>{formatMoney(p.amountMinor, p.currency)}/day</span>
                <Button
                  size="small"
                  appearance="transparent"
                  disabled={presets.length <= 1}
                  onClick={() => setDraft(presets.filter((_, j) => j !== i))}
                  data-testid={`perdiem-preset-remove-${i}`}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className={s.row}>
              <Input
                className={s.rateInput}
                value={amount}
                onChange={(_, d) => setAmount(d.value)}
                placeholder="e.g. 65"
                data-testid="perdiem-preset-amount"
              />
              <Dropdown
                value={currency}
                selectedOptions={[currency]}
                onOptionSelect={(_, d) => d.optionValue && setCurrency(d.optionValue as CurrencyCode)}
                style={{ minWidth: '90px' }}
                data-testid="perdiem-preset-currency"
              >
                {CURRENCY_CODES.map((c) => (
                  <Option key={c} value={c} text={c}>
                    {c}
                  </Option>
                ))}
              </Dropdown>
              <Button
                size="small"
                appearance="secondary"
                disabled={!addValid || presets.length >= 8}
                onClick={() => {
                  setDraft([...presets, { amountMinor: addMinor!, currency }]);
                  setAmount('');
                }}
                data-testid="perdiem-preset-add"
              >
                Add
              </Button>
              <Button size="small" appearance="primary" disabled={!draft || busy} onClick={save} data-testid="perdiem-presets-save">
                {busy ? 'Saving…' : 'Save presets'}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── S5: import & export — export IS the template; staging is governed ────────

const IMPORT_DOMAIN_LABELS = { people: 'People', credentials: 'Credentials', agreements: 'Agreements' } as const;
type ImportDomainKey = keyof typeof IMPORT_DOMAIN_LABELS;

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function ImportExportSection() {
  const s = useStyles();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [domain, setDomain] = useState<ImportDomainKey>('people');
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<{ approvalId: string; rowCount: number; domain: string } | null>(null);
  const [errors, setErrors] = useState<Array<{ row: number; column: string; message: string }>>([]);
  const [errorCount, setErrorCount] = useState(0);

  async function onDownload(kind: 'export' | 'template', which: string) {
    try {
      const { blob, fileName } = kind === 'export' ? await api.downloadExport(which) : await api.downloadTemplate(which);
      saveBlob(blob, fileName);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The download failed.');
    }
  }

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setStaged(null);
    setErrors([]);
    setErrorCount(0);
    try {
      const res = await api.stageImport(domain, file);
      setStaged({ approvalId: res.approval.approvalId, rowCount: res.rowCount, domain: res.domain });
      notify('success', `Staged ${res.approval.approvalId}: ${res.rowCount} ${res.domain}. An owner must review and execute it.`);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IMPORT_INVALID') {
        const details = (err as ApiError & { details?: { rows?: Array<{ row: number; column: string; message: string }>; errorCount?: number } }).details;
        setErrors(details?.rows ?? []);
        setErrorCount(details?.errorCount ?? details?.rows?.length ?? 0);
        notify('error', 'The file has validation errors — nothing was imported.');
      } else {
        notify('error', err instanceof ApiError ? err.message : 'The import failed.');
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <p className={s.intro} style={{ marginTop: '32px' }}>
        Import &amp; export. Each register exports as CSV in exactly the shape import accepts — the export is the
        template. Imports are validated all-or-nothing: one bad cell fails the whole file with a per-row report, and a
        clean file becomes ONE approval an owner must execute before anything lands.
      </p>
      <div className={s.panel} data-testid="import-export-panel">
        <div className={s.head}>
          <span className={s.title}>Export</span>
          <span className={s.meta}>csv · full register</span>
        </div>
        <div className={s.row}>
          {(['people', 'credentials', 'agreements'] as const).map((d) => (
            <Button key={d} size="small" appearance="secondary" onClick={() => void onDownload('export', d)} data-testid={`export-${d}`}>
              {IMPORT_DOMAIN_LABELS[d]}
            </Button>
          ))}
          <Button size="small" appearance="secondary" onClick={() => void onDownload('export', 'audit')} data-testid="export-audit">
            Audit trail
          </Button>
        </div>
        <div className={s.head}>
          <span className={s.title}>Import</span>
          <span className={s.meta}>staged → owner executes</span>
        </div>
        <div className={s.row}>
          <Dropdown
            value={IMPORT_DOMAIN_LABELS[domain]}
            selectedOptions={[domain]}
            onOptionSelect={(_, d) => d.optionValue && setDomain(d.optionValue as ImportDomainKey)}
            data-testid="import-domain"
            style={{ minWidth: '160px' }}
          >
            {(['people', 'credentials', 'agreements'] as const).map((d) => (
              <Option key={d} value={d} text={IMPORT_DOMAIN_LABELS[d]}>
                {IMPORT_DOMAIN_LABELS[d]}
              </Option>
            ))}
          </Dropdown>
          <Button size="small" appearance="secondary" onClick={() => void onDownload('template', domain)} data-testid="import-template">
            Blank template
          </Button>
          <input ref={fileRef} type="file" hidden accept=".csv,text/csv" onChange={(e) => void onPick(e.target.files)} data-testid="import-file-input" />
          <Button size="small" appearance="primary" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="import-upload">
            {busy ? 'Validating…' : 'Upload CSV…'}
          </Button>
        </div>
        {staged && (
          <div className={s.row} data-testid="import-staged">
            <span className={s.eq}>{`Staged ${staged.approvalId} — ${staged.rowCount} ${staged.domain}. Nothing lands until an owner executes it.`}</span>
          </div>
        )}
        {errors.length > 0 && (
          <div style={{ padding: '12px 20px' }} data-testid="import-errors">
            <span className={s.eq} style={{ color: 'var(--c3-attention)' }}>
              {`${errorCount} validation error${errorCount === 1 ? '' : 's'} — nothing was imported${errorCount > errors.length ? ` (showing first ${errors.length})` : ''}:`}
            </span>
            <ul style={{ margin: '8px 0 0', paddingLeft: '18px' }}>
              {errors.slice(0, 20).map((e, i) => (
                <li key={i} className={s.eq} data-testid={`import-error-row`}>
                  {e.row === 0 ? e.column : `Row ${e.row}, ${e.column}`}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

// ── S5 riders: data quality — soft signals a strict import must not block on ─

type DqReport = DataQualityReportDto['report'];

const DQ_CHECKS: Array<{
  key: Exclude<keyof DqReport, 'duplicatePeople'>;
  label: string;
  line: (x: { personId?: string; fullName?: string; credentialId?: string; personId2?: string; credentialType?: string; expiresOn?: string | null; agreementId?: string; agreementType?: string; anchor?: string; endsOn?: string }) => string;
}> = [
  { key: 'peopleMissingNationality', label: 'Active people missing a nationality', line: (x) => `${x.personId} — ${x.fullName}` },
  { key: 'peopleMissingRole', label: 'Active people missing a primary role', line: (x) => `${x.personId} — ${x.fullName}` },
  { key: 'peopleMissingPersonnelCode', label: 'Active people missing a personnel code', line: (x) => `${x.personId} — ${x.fullName}` },
  {
    key: 'activeCredentialsPastExpiry',
    label: 'Active credentials past their expiry date',
    line: (x) => `${x.credentialId} — ${x.credentialType} for ${x.personId} (expired ${x.expiresOn})`,
  },
  {
    key: 'credentialsWithoutExpiry',
    label: 'Active credentials without an expiry date',
    line: (x) => `${x.credentialId} — ${x.credentialType} for ${x.personId}`,
  },
  {
    key: 'activeAgreementsPastEnd',
    label: 'Active agreements past their end date',
    line: (x) => `${x.agreementId} — ${x.agreementType} for ${x.anchor} (ended ${x.endsOn})`,
  },
  {
    key: 'activeAgreementsWithoutCode',
    label: 'Active agreements without a code',
    line: (x) => `${x.agreementId} — ${x.agreementType} for ${x.anchor}`,
  },
];

const DQ_REASON_LABEL: Record<string, string> = { fullName: 'same name', ign: 'same IGN', personnelCode: 'same personnel code' };

function DataQualitySection() {
  const s = useStyles();
  const { data, isLoading, isError, error, refetch, isRefetching } = useDataQuality();
  const [open, setOpen] = useState<string | null>(null);

  const report = data?.report;
  const total = report
    ? report.duplicatePeople.length + DQ_CHECKS.reduce((n, c) => n + report[c.key].length, 0)
    : 0;

  return (
    <>
      <p className={s.intro} style={{ marginTop: '32px' }}>
        Data quality. Import enforces the hard rules; these are the soft signals it must not block on — potential
        duplicate people (exact match after trimming and casing; no guessing) and records whose basics are missing or
        whose dates have quietly gone stale. Review and fix in the registers; nothing here changes data.
      </p>
      <div className={s.panel} data-testid="dq-panel">
        <div className={s.head}>
          <span className={s.title}>Data quality</span>
          <span className={s.meta} data-testid="dq-total">
            {report ? (total === 0 ? 'all clear' : `${total} finding${total === 1 ? '' : 's'}`) : '…'}
          </span>
          <Button size="small" appearance="secondary" style={{ marginLeft: '12px' }} disabled={isRefetching} onClick={() => void refetch()} data-testid="dq-refresh">
            {isRefetching ? 'Checking…' : 'Re-run checks'}
          </Button>
        </div>
        {isLoading && <LoadingState label="Running checks…" />}
        {isError && (
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not run the checks.'}
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
          />
        )}
        {report && (
          <>
            <div className={s.row} data-testid="dq-duplicates">
              <span className={s.eq} style={{ fontWeight: 600 }}>Potential duplicate people</span>
              <span className={s.meta}>{report.duplicatePeople.length}</span>
              {report.duplicatePeople.length > 0 && (
                <Button size="small" appearance="transparent" onClick={() => setOpen(open === 'dup' ? null : 'dup')} data-testid="dq-duplicates-toggle">
                  {open === 'dup' ? 'Hide' : 'Show'}
                </Button>
              )}
            </div>
            {open === 'dup' && report.duplicatePeople.length > 0 && (
              <div style={{ padding: '4px 20px 12px' }} data-testid="dq-duplicates-list">
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  {report.duplicatePeople.map((g, i) => (
                    <li key={i} className={s.eq}>
                      “{g.value}” ({DQ_REASON_LABEL[g.reason] ?? g.reason}):{' '}
                      {g.people.map((p) => `${p.personId}${p.isActive ? '' : ' (inactive)'}`).join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {DQ_CHECKS.map((c) => (
              <div key={c.key}>
                <div className={s.row} data-testid={`dq-${c.key}`}>
                  <span className={s.eq}>{c.label}</span>
                  <span className={s.meta}>{report[c.key].length}</span>
                  {report[c.key].length > 0 && (
                    <Button size="small" appearance="transparent" onClick={() => setOpen(open === c.key ? null : c.key)} data-testid={`dq-${c.key}-toggle`}>
                      {open === c.key ? 'Hide' : 'Show'}
                    </Button>
                  )}
                </div>
                {open === c.key && report[c.key].length > 0 && (
                  <div style={{ padding: '4px 20px 12px' }} data-testid={`dq-${c.key}-list`}>
                    <ul style={{ margin: 0, paddingLeft: '18px' }}>
                      {report[c.key].map((x, i) => (
                        <li key={i} className={s.eq}>
                          {c.line(x as never)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
