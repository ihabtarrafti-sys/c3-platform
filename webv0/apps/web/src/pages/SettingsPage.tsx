import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CURRENCY_CODES, type DataQualityReportDto } from '@c3web/api-contracts';
import { formatMoney, type CurrencyCode } from '@c3web/domain';
import { useDataQuality, useFxRates, usePerDiemPresets } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  WorkSurface,
  EmptyState,
  ErrorState,
  LoadingState,
  Input,
  Selector,
  positiveAmountToMinor,
} from '../tablework';
import { BackupStatusSection, DelegationSection } from '../components/SettingsGovernanceSections';

/**
 * Settings (Finance S1) — org configuration, on the Tablework frame (pivot W3
 * Lane 2; behaviour, testids and copy verbatim). The first real setting worth
 * housing: the exchange-rate table. The org maintains one rate per currency —
 * its value in USD (the pivot) — and every cross-rate is derived from those, so
 * money booked in AED can always be shown a truthful "≈ USD" (and any pair).
 *
 * ⚖️ TIER B stays Fluent. `SettingsGovernanceSections` (DelegationSection /
 * BackupStatusSection) is a `components/` file — Wave 4, read-only here — so it
 * renders Fluent inside `.tw-root` exactly as ApprovalDetailPage already hosts
 * `CorrectionDialog`. Its testids and behaviour are untouched by this file.
 */

const PIVOT = 'USD';

// K1 CLOSED (marker chapter): both money rows ride the kit's `width="amount"`
// stop — an EXACT 120px, byte-identical to the carried inline style (and the
// reason the vocabulary has no min-width `compact`: 120px sits below every
// minimum stop, so a min would silently widen these money inputs).

const CURRENCY_OPTIONS = CURRENCY_CODES.map((c) => ({ value: c, label: c }));

function RateRow({ currency, current, onSaved }: { currency: string; current: number | undefined; onSaved: () => void }) {
  const { notify } = useNotify();
  const [value, setValue] = useState(current !== undefined ? String(current) : '');
  const [busy, setBusy] = useState(false);
  // ⚖️ MONEY — deliberately NOT a kit-parser site, and NOT `parseDecimalToMinor`
  // either. An FX rate is a RATIO (the domain's `FxRate.usdPerUnit`, e.g. AED →
  // 0.272294), not an amount in minor units: `parseDecimalToMinor` allows at
  // most two decimals and would REFUSE the four-decimal rate the oracle enters
  // (0.2723). None of the kit's four parsers expresses a ratio, so `Number`
  // stays verbatim with its own zero policy — `> 0`, because a zero rate is
  // meaningless AND would make the derived inverse `1 / parsed` infinite.
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
    <div className="form-row">
      <span className="record-row-meta">{currency}</span>
      <span className="record-quiet">1 {currency} =</span>
      <Input
        width="amount"
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="0.00"
        data-testid={`fx-rate-${currency}`}
      />
      {/* Fluent's `contentAfter` drew the pivot code INSIDE the input's border;
          the kit's input is a bare native control, so the same word sits beside
          it. The copy is unchanged. */}
      <span className="record-row-meta">{PIVOT}</span>
      <span className="record-row-meta">
        {valid ? `≈ 1 ${PIVOT} = ${(1 / parsed).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${currency}` : '—'}
      </span>
      <button className="primary-action" type="button" disabled={!valid || busy} onClick={() => void save()} data-testid={`fx-save-${currency}`}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

export function SettingsPage() {
  return (
    <TableworkPage record="Settings" section="Configuration">
      <SettingsBody />
    </TableworkPage>
  );
}

function SettingsBody() {
  const { me } = useSession();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageEntities ?? false;
  // THE WIRE LAW: the capability IS the react-query `enabled` flag. It stays the
  // flag — never a fetch that always fires and is hidden in the render.
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
    // denied ≠ empty: the `settings-denied` testid is the role-gate assertion.
    return (
      <CollectionFrame title="Settings">
        <EmptyState data-testid="settings-denied" message="Settings are available to owners and operations." />
      </CollectionFrame>
    );
  }

  const rateOf = (cur: string): number | undefined => data?.rates.find((r) => r.currency === cur)?.usdPerUnit;

  return (
    <CollectionFrame
      kicker="Configuration"
      title="Settings"
      scope={
        <>
          Exchange rates. Set each currency’s value in {PIVOT} — every cross-rate (any currency to any other) is derived
          from these, so money booked in one currency can always be shown a truthful “≈” in another. Maintain them by hand,
          or pull the current rates from a live source with <em>Refresh from source</em>; either way the numbers stay yours.
        </>
      }
    >
      {isLoading && <LoadingState label="Loading rates…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load rates.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && (
        <WorkSurface tier="elevated" className="record-card" data-testid="fx-rates-panel">
          <header className="surface-heading">
            <div>
              <h2>Exchange rates</h2>
            </div>
            <div className="row-actions">
              <span className="record-row-meta">pivot · {PIVOT}</span>
              <button className="secondary-action" type="button" disabled={refreshing} onClick={() => void refreshRates()} data-testid="fx-refresh">
                {refreshing ? 'Refreshing…' : 'Refresh from source'}
              </button>
            </div>
          </header>
          <div className="form-row">
            <span className="record-row-meta">{PIVOT}</span>
            <span className="record-quiet">The pivot currency. Fixed at 1 — every other rate is expressed against it.</span>
          </div>
          {CURRENCY_CODES.filter((c) => c !== PIVOT).map((c) => (
            <RateRow key={c} currency={c} current={rateOf(c)} onSaved={() => void qc.invalidateQueries({ queryKey: ['fxRates'] })} />
          ))}
        </WorkSurface>
      )}

      <PerDiemPresetsSection />
      <ImportExportSection />
      <DataQualitySection />
      <DelegationSection />
      <BackupStatusSection />
    </CollectionFrame>
  );
}

// ── HARDEN-2: per-diem presets — the S2 rider comes home ─────────────────────
// The org's quick-pick daily rates (their real config: 65 SAR / 100 SAR /
// 25 USD as the defaults) surface as buttons in the per-diem dialog. Edits
// are version-guarded (M-03): a concurrent editor refuses, never merges.

function PerDiemPresetsSection() {
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = usePerDiemPresets();
  const [draft, setDraft] = useState<Array<{ amountMinor: number; currency: CurrencyCode }> | null>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('SAR');
  const [busy, setBusy] = useState(false);

  const presets = draft ?? (data?.presets as Array<{ amountMinor: number; currency: CurrencyCode }> | undefined) ?? [];
  // ⚖️ MONEY — migrated onto the kit, zero policy UNCHANGED. The Fluent site
  // read `parseDecimalToMinor(amount)` then `addMinor !== null && addMinor > 0`;
  // `positiveAmountToMinor` IS that pair (`parseDecimalToMinor` + `!== null &&
  // > 0 ? minor : null`), so the zero policy (reject) and the output (integer
  // minor units, `null` otherwise) are identical. The domain regex admits no
  // negatives, so there is no third case either policy would answer differently.
  // The guard stays `!== null` — never truthiness; 0 is a real amount elsewhere.
  const addMinor = positiveAmountToMinor(amount);
  const addValid = addMinor !== null && !presets.some((p) => p.amountMinor === addMinor && p.currency === currency);

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
      <p className="record-quiet">
        Per-diem presets. The daily rates your missions actually use — they appear as one-click picks in every
        per-diem dialog. Edit the list here; saving is recorded, and a colleague editing at the same time is refused
        rather than silently overwritten.
      </p>
      <WorkSurface tier="elevated" className="record-card" data-testid="perdiem-presets-panel">
        <header className="surface-heading">
          <div>
            <h2>Per-diem presets</h2>
          </div>
          <span className="record-row-meta" data-testid="perdiem-presets-state">
            {data ? (data.version === null && !draft ? 'defaults' : draft ? 'unsaved changes' : `v${data.version}`) : '…'}
          </span>
        </header>
        {isLoading && <LoadingState label="Loading presets…" />}
        {isError && (
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not load the presets.'}
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
          />
        )}
        {data && (
          <>
            <div className="record-rows">
              {presets.map((p, i) => (
                <div key={`${p.amountMinor}-${p.currency}`} className="record-row-item" data-testid={`perdiem-preset-row-${i}`}>
                  <span className="record-row-name">{formatMoney(p.amountMinor, p.currency)}/day</span>
                  <div className="row-actions">
                    <button
                      className="quiet-action"
                      type="button"
                      disabled={presets.length <= 1}
                      onClick={() => setDraft(presets.filter((_, j) => j !== i))}
                      data-testid={`perdiem-preset-remove-${i}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="form-row">
              <Input
                width="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 65"
                data-testid="perdiem-preset-amount"
              />
              <Selector
                width="compact"
                value={currency}
                options={CURRENCY_OPTIONS}
                onSelect={(value) => setCurrency(value as CurrencyCode)}
                data-testid="perdiem-preset-currency"
              />
              <button
                className="secondary-action"
                type="button"
                disabled={!addValid || presets.length >= 8}
                onClick={() => {
                  setDraft([...presets, { amountMinor: addMinor!, currency }]);
                  setAmount('');
                }}
                data-testid="perdiem-preset-add"
              >
                Add
              </button>
              <button className="primary-action" type="button" disabled={!draft || busy} onClick={() => void save()} data-testid="perdiem-presets-save">
                {busy ? 'Saving…' : 'Save presets'}
              </button>
            </div>
          </>
        )}
      </WorkSurface>
    </>
  );
}

// ── S5: import & export — export IS the template; staging is governed ────────

const IMPORT_DOMAIN_LABELS = { people: 'People', credentials: 'Credentials', agreements: 'Agreements' } as const;
type ImportDomainKey = keyof typeof IMPORT_DOMAIN_LABELS;

const IMPORT_DOMAIN_OPTIONS = (['people', 'credentials', 'agreements'] as const).map((d) => ({
  value: d,
  label: IMPORT_DOMAIN_LABELS[d],
}));

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function ImportExportSection() {
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
      <p className="record-quiet">
        Import &amp; export. Each register exports as CSV in exactly the shape import accepts — the export is the
        template. Imports are validated all-or-nothing: one bad cell fails the whole file with a per-row report, and a
        clean file becomes ONE approval an owner must execute before anything lands.
      </p>
      <WorkSurface tier="elevated" className="record-card" data-testid="import-export-panel">
        <header className="surface-heading">
          <div>
            <h2>Export</h2>
          </div>
          <span className="record-row-meta">csv · full register</span>
        </header>
        <div className="row-actions">
          {(['people', 'credentials', 'agreements'] as const).map((d) => (
            <button key={d} className="secondary-action" type="button" onClick={() => void onDownload('export', d)} data-testid={`export-${d}`}>
              {IMPORT_DOMAIN_LABELS[d]}
            </button>
          ))}
          <button className="secondary-action" type="button" onClick={() => void onDownload('export', 'audit')} data-testid="export-audit">
            Audit trail
          </button>
        </div>
        <header className="surface-heading">
          <div>
            <h2>Import</h2>
          </div>
          <span className="record-row-meta">staged → owner executes</span>
        </header>
        <div className="form-row">
          <Selector
            width="compact"
            value={domain}
            options={IMPORT_DOMAIN_OPTIONS}
            onSelect={(value) => setDomain(value as ImportDomainKey)}
            data-testid="import-domain"
          />
          <button className="secondary-action" type="button" onClick={() => void onDownload('template', domain)} data-testid="import-template">
            Blank template
          </button>
          {/* LANE-2 LAW: this stays a bare, UNSTYLED native file input. B1
              deliberately left `input[type='file']` out of the kit's styled list
              (a file control has a UA button inside it), and it is `hidden`
              anyway — the visible affordance is the button beside it. */}
          <input ref={fileRef} type="file" hidden accept=".csv,text/csv" onChange={(e) => void onPick(e.target.files)} data-testid="import-file-input" />
          <button className="primary-action" type="button" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="import-upload">
            {busy ? 'Validating…' : 'Upload CSV…'}
          </button>
        </div>
        {staged && (
          <p className="record-quiet" data-testid="import-staged">
            {`Staged ${staged.approvalId} — ${staged.rowCount} ${staged.domain}. Nothing lands until an owner executes it.`}
          </p>
        )}
        {errors.length > 0 && (
          <div data-testid="import-errors">
            <p className="record-quiet danger">
              {`${errorCount} validation error${errorCount === 1 ? '' : 's'} — nothing was imported${errorCount > errors.length ? ` (showing first ${errors.length})` : ''}:`}
            </p>
            <ul>
              {errors.slice(0, 20).map((e, i) => (
                <li key={i} className="record-quiet" data-testid="import-error-row">
                  {e.row === 0 ? e.column : `Row ${e.row}, ${e.column}`}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </WorkSurface>
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
  const { data, isLoading, isError, error, refetch, isRefetching } = useDataQuality();
  const [open, setOpen] = useState<string | null>(null);

  const report = data?.report;
  const total = report
    ? report.duplicatePeople.length + DQ_CHECKS.reduce((n, c) => n + report[c.key].length, 0)
    : 0;

  return (
    <>
      <p className="record-quiet">
        Data quality. Import enforces the hard rules; these are the soft signals it must not block on — potential
        duplicate people (exact match after trimming and casing; no guessing) and records whose basics are missing or
        whose dates have quietly gone stale. Review and fix in the registers; nothing here changes data.
      </p>
      <WorkSurface tier="elevated" className="record-card" data-testid="dq-panel">
        <header className="surface-heading">
          <div>
            <h2>Data quality</h2>
          </div>
          <div className="row-actions">
            <span className="record-row-meta" data-testid="dq-total">
              {report ? (total === 0 ? 'all clear' : `${total} finding${total === 1 ? '' : 's'}`) : '…'}
            </span>
            <button className="secondary-action" type="button" disabled={isRefetching} onClick={() => void refetch()} data-testid="dq-refresh">
              {isRefetching ? 'Checking…' : 'Re-run checks'}
            </button>
          </div>
        </header>
        {isLoading && <LoadingState label="Running checks…" />}
        {isError && (
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not run the checks.'}
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
          />
        )}
        {report && (
          <div className="record-rows">
            <div>
              <div className="record-row-item" data-testid="dq-duplicates">
                <span className="record-row-name">Potential duplicate people</span>
                <span className="record-row-meta">{report.duplicatePeople.length}</span>
                {report.duplicatePeople.length > 0 && (
                  <button className="quiet-action" type="button" onClick={() => setOpen(open === 'dup' ? null : 'dup')} data-testid="dq-duplicates-toggle">
                    {open === 'dup' ? 'Hide' : 'Show'}
                  </button>
                )}
              </div>
              {open === 'dup' && report.duplicatePeople.length > 0 && (
                <div data-testid="dq-duplicates-list">
                  <ul>
                    {report.duplicatePeople.map((g, i) => (
                      <li key={i} className="record-quiet">
                        “{g.value}” ({DQ_REASON_LABEL[g.reason] ?? g.reason}):{' '}
                        {g.people.map((p) => `${p.personId}${p.isActive ? '' : ' (inactive)'}`).join(', ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {DQ_CHECKS.map((c) => (
              <div key={c.key}>
                <div className="record-row-item" data-testid={`dq-${c.key}`}>
                  <span className="record-row-name">{c.label}</span>
                  <span className="record-row-meta">{report[c.key].length}</span>
                  {report[c.key].length > 0 && (
                    <button className="quiet-action" type="button" onClick={() => setOpen(open === c.key ? null : c.key)} data-testid={`dq-${c.key}-toggle`}>
                      {open === c.key ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
                {open === c.key && report[c.key].length > 0 && (
                  <div data-testid={`dq-${c.key}-list`}>
                    <ul>
                      {report[c.key].map((x, i) => (
                        <li key={i} className="record-quiet">
                          {c.line(x as never)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </WorkSurface>
    </>
  );
}
