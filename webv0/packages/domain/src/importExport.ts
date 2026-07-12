/**
 * importExport.ts — S5, the locked design (C3-CONSOLIDATED-PLAN §0):
 *
 *   - EXPORT IS THE TEMPLATE: each register exports CSV in EXACTLY the shape
 *     import accepts — one format, no drift, and the round-trip law
 *     (toCsv → parseCsv → toCsv byte-identical) is unit-tested here.
 *   - DRY-RUN ALL-OR-NOTHING: every row is validated through the SAME zod
 *     create schemas the API uses; one bad cell fails the whole file with a
 *     per-row error report. Nothing lands until the file is 100% clean.
 *   - GOVERNANCE AT BATCH SCALE: a clean file becomes ONE ImportBatch
 *     approval (ops stages, the owner executes — requester ≠ approver);
 *     execution inserts every row in a single transaction with per-row audit.
 *   - PHASED BY DOMAIN: people first (C3 allocates PER ids), then credentials
 *     and agreements that reference those ids.
 *
 * The id columns (personId/credentialId/agreementId) exist in the export for
 * fidelity and MUST BE EMPTY on import — ids are allocated by C3, never
 * imported (the per-row error says exactly that).
 *
 * The CSV core is a strict RFC 4180 subset we both EMIT and PARSE ourselves:
 * quoted-when-needed, doubled quotes, embedded commas/newlines legal, CRLF or
 * LF accepted, no comments. Owning both sides is what makes the round-trip
 * law a guarantee instead of a hope.
 */

import { z } from 'zod';
import { addPersonInputSchema, type AddPersonInput } from './person';
import { addCredentialInputSchema, type AddCredentialInput } from './credential';
import { addAgreementInputSchema, type AddAgreementInput } from './agreement';

// ── the CSV core ─────────────────────────────────────────────────────────────

function needsQuoting(v: string): boolean {
  return v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r');
}

/**
 * CSV formula-injection defense (M-08). A cell whose first character is `=`,
 * `+`, `-`, `@`, TAB, or CR is interpreted by Excel/Sheets as a formula or DDE
 * payload the moment the file is opened. Prefix such a value with an apostrophe
 * — spreadsheets then render it as literal text and hide the apostrophe.
 *
 * The guard is IDEMPOTENT: a neutralized value now starts with `'`, which is
 * not a trigger, so re-applying it is a no-op. That is what keeps the codec
 * round-trip law (toCsv → parseCsv → toCsv byte-identical) intact — every
 * CSV-emitting path in the app funnels through here, so exports are inert by
 * construction. (parseCsv is left untouched: it is a pure byte reader.)
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
export function neutralizeFormula(v: string): string {
  return FORMULA_TRIGGER.test(v) ? `'${v}` : v;
}

function escapeField(v: string): string {
  const safe = neutralizeFormula(v);
  return needsQuoting(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Emit CSV (LF line endings, header row first, every row padded to headers). */
export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers.map(escapeField).join(',')];
  for (const row of rows) {
    lines.push(headers.map((_, i) => escapeField(row[i] ?? '')).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Strict RFC 4180 parse → array of rows (arrays of string fields). Throws
 * CsvParseError with a 1-based line number on structural problems (a stray
 * quote, an unterminated quoted field).
 */
export class CsvParseError extends Error {
  constructor(
    public readonly line: number,
    message: string,
  ) {
    super(`CSV line ${line}: ${message}`);
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let line = 1;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        // After a closing quote only a separator, newline, or EOF is legal.
        const next = text[i];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          throw new CsvParseError(line, 'unexpected character after closing quote');
        }
        continue;
      }
      if (c === '\n') line += 1;
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      if (field !== '') throw new CsvParseError(line, 'quote inside an unquoted field');
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      // CRLF or lone CR both end the record.
      pushRow();
      line += 1;
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (c === '\n') {
      pushRow();
      line += 1;
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (inQuotes) throw new CsvParseError(line, 'unterminated quoted field');
  // Trailing content without a final newline still counts as a row; a file
  // ending in a newline does NOT produce a phantom empty row.
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

// ── domains, columns, and row codecs ─────────────────────────────────────────

export const IMPORT_DOMAINS = ['people', 'credentials', 'agreements'] as const;
export type ImportDomain = (typeof IMPORT_DOMAINS)[number];

/** Export columns == import columns — the template law. Order is canonical. */
export const PEOPLE_COLUMNS = [
  'personId',
  'fullName',
  'ign',
  'nationality',
  'primaryRole',
  'personnelCode',
  'currentTeam',
  'currentGameTitle',
  'primaryDepartment',
  'entityId',
  'notes',
  'isActive',
] as const;

export const CREDENTIALS_COLUMNS = [
  'credentialId',
  'personId',
  'credentialType',
  'issuer',
  'issuedOn',
  'expiresOn',
  'notes',
  'isActive',
] as const;

export const AGREEMENTS_COLUMNS = [
  'agreementId',
  'personId',
  'entityId',
  'agreementCode',
  'agreementType',
  'linkedAgreementId',
  'startsOn',
  'endsOn',
  'valueUsdCents',
  'notes',
  'status',
] as const;

export function columnsForDomain(domain: ImportDomain): readonly string[] {
  return domain === 'people' ? PEOPLE_COLUMNS : domain === 'credentials' ? CREDENTIALS_COLUMNS : AGREEMENTS_COLUMNS;
}

/** One validation problem, addressed to a human fixing a spreadsheet. */
export interface ImportRowError {
  /** 1-based DATA row number (the header is row 0 conceptually, shown as such). */
  readonly row: number;
  readonly column: string;
  readonly message: string;
}

/** Parsed, validated batch payloads (the approval snapshot). */
export interface PeopleImportRow extends AddPersonInput {
  readonly isActive: boolean;
}
export interface CredentialsImportRow extends AddCredentialInput {
  readonly isActive: boolean;
}
export interface AgreementsImportRow extends AddAgreementInput {
  readonly status: 'Active' | 'Terminated';
}

const isActiveField = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['', 'true', 'false']))
  .transform((v) => v !== 'false');

const statusField = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.enum(['', 'Active', 'Terminated']))
  .transform((v) => (v === '' ? ('Active' as const) : v));

/** '' → undefined so the create schemas' nullish transforms apply. */
const blank = (v: string | undefined): string | undefined => {
  const t = (v ?? '').trim();
  return t === '' ? undefined : t;
};

export interface ParsedImport {
  readonly domain: ImportDomain;
  readonly people?: PeopleImportRow[];
  readonly credentials?: CredentialsImportRow[];
  readonly agreements?: AgreementsImportRow[];
  readonly rowCount: number;
}

/**
 * Validate a whole CSV text for a domain — ALL OR NOTHING. Returns either the
 * fully-parsed batch or the complete per-row error list (never both). The
 * header row must match the canonical columns EXACTLY (same names, same
 * order) — the template is the contract.
 */
export function validateImportCsv(domain: ImportDomain, text: string): { ok: true; batch: ParsedImport } | { ok: false; errors: ImportRowError[] } {
  const columns = columnsForDomain(domain);

  let raw: string[][];
  try {
    raw = parseCsv(text);
  } catch (err) {
    return { ok: false, errors: [{ row: 0, column: '(file)', message: err instanceof Error ? err.message : 'The file is not valid CSV.' }] };
  }
  if (raw.length === 0) return { ok: false, errors: [{ row: 0, column: '(file)', message: 'The file is empty.' }] };

  const header = raw[0]!.map((h) => h.trim());
  if (header.length !== columns.length || header.some((h, i) => h !== columns[i])) {
    return {
      ok: false,
      errors: [
        {
          row: 0,
          column: '(header)',
          message: `The header row must be exactly: ${columns.join(', ')} — download the template from Settings.`,
        },
      ],
    };
  }

  const dataRows = raw.slice(1).filter((r) => !(r.length === 1 && r[0] === '')); // tolerate blank trailing lines
  if (dataRows.length === 0) return { ok: false, errors: [{ row: 0, column: '(file)', message: 'The file has a header but no data rows.' }] };

  const errors: ImportRowError[] = [];
  const cell = (r: string[], name: string): string => r[columns.indexOf(name)] ?? '';

  const addZodIssues = (rowNo: number, issues: z.ZodIssue[]) => {
    for (const issue of issues) {
      errors.push({ row: rowNo, column: String(issue.path[0] ?? '(row)'), message: issue.message });
    }
  };

  const idColumn = columns[0]!; // personId / credentialId / agreementId
  const people: PeopleImportRow[] = [];
  const credentials: CredentialsImportRow[] = [];
  const agreements: AgreementsImportRow[] = [];

  dataRows.forEach((r, idx) => {
    const rowNo = idx + 1;
    if (r.length !== columns.length) {
      errors.push({ row: rowNo, column: '(row)', message: `Expected ${columns.length} columns, found ${r.length}.` });
      return;
    }
    if (cell(r, idColumn).trim() !== '') {
      errors.push({ row: rowNo, column: idColumn, message: `Ids are allocated by C3 — leave ${idColumn} empty on import.` });
    }

    if (domain === 'people') {
      const parsed = addPersonInputSchema.safeParse({
        fullName: cell(r, 'fullName').trim(),
        ign: blank(cell(r, 'ign')),
        nationality: blank(cell(r, 'nationality')),
        primaryRole: blank(cell(r, 'primaryRole')),
        personnelCode: blank(cell(r, 'personnelCode')),
        currentTeam: blank(cell(r, 'currentTeam')),
        currentGameTitle: blank(cell(r, 'currentGameTitle')),
        primaryDepartment: blank(cell(r, 'primaryDepartment')),
        entityId: blank(cell(r, 'entityId')),
        notes: blank(cell(r, 'notes')),
      });
      const active = isActiveField.safeParse(cell(r, 'isActive'));
      if (!parsed.success) addZodIssues(rowNo, parsed.error.issues);
      if (!active.success) errors.push({ row: rowNo, column: 'isActive', message: 'isActive must be true, false, or empty (true).' });
      if (parsed.success && active.success) people.push({ ...parsed.data, isActive: active.data });
      return;
    }

    if (domain === 'credentials') {
      const parsed = addCredentialInputSchema.safeParse({
        personId: cell(r, 'personId').trim(),
        credentialType: cell(r, 'credentialType').trim(),
        issuer: blank(cell(r, 'issuer')),
        issuedOn: cell(r, 'issuedOn').trim(),
        expiresOn: blank(cell(r, 'expiresOn')),
        notes: blank(cell(r, 'notes')),
      });
      const active = isActiveField.safeParse(cell(r, 'isActive'));
      if (!parsed.success) addZodIssues(rowNo, parsed.error.issues);
      if (!active.success) errors.push({ row: rowNo, column: 'isActive', message: 'isActive must be true, false, or empty (true).' });
      if (parsed.success && active.success) credentials.push({ ...parsed.data, isActive: active.data });
      return;
    }

    // agreements
    const value = cell(r, 'valueUsdCents').trim();
    const valueParsed = value === '' ? undefined : Number(value);
    if (value !== '' && (!Number.isInteger(valueParsed) || valueParsed! < 0)) {
      errors.push({ row: rowNo, column: 'valueUsdCents', message: 'valueUsdCents must be a non-negative integer (cents), or empty.' });
    }
    const parsed = addAgreementInputSchema.safeParse({
      personId: blank(cell(r, 'personId')),
      entityId: blank(cell(r, 'entityId')),
      agreementCode: blank(cell(r, 'agreementCode')),
      agreementType: cell(r, 'agreementType').trim(),
      linkedAgreementId: blank(cell(r, 'linkedAgreementId')),
      startsOn: cell(r, 'startsOn').trim(),
      endsOn: cell(r, 'endsOn').trim(),
      valueUsdCents: value === '' ? undefined : valueParsed,
      notes: blank(cell(r, 'notes')),
    });
    const status = statusField.safeParse(cell(r, 'status'));
    if (!parsed.success) addZodIssues(rowNo, parsed.error.issues);
    if (!status.success) errors.push({ row: rowNo, column: 'status', message: 'status must be Active, Terminated, or empty (Active).' });
    if (parsed.success && status.success && (value === '' || Number.isInteger(valueParsed))) {
      agreements.push({ ...parsed.data, status: status.data });
    }
  });

  // In-file duplicate checks (DB-level checks are the staging use-case's job).
  if (domain === 'people') {
    const seen = new Map<string, number>();
    people.forEach((p, i) => {
      if (!p.personnelCode) return;
      const first = seen.get(p.personnelCode);
      if (first !== undefined) errors.push({ row: i + 1, column: 'personnelCode', message: `Duplicate personnelCode "${p.personnelCode}" (also row ${first}).` });
      else seen.set(p.personnelCode, i + 1);
    });
  }
  if (domain === 'agreements') {
    const seen = new Map<string, number>();
    agreements.forEach((a, i) => {
      if (!a.agreementCode) return;
      const first = seen.get(a.agreementCode);
      if (first !== undefined) errors.push({ row: i + 1, column: 'agreementCode', message: `Duplicate agreementCode "${a.agreementCode}" (also row ${first}).` });
      else seen.set(a.agreementCode, i + 1);
    });
  }

  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => a.row - b.row) };
  return {
    ok: true,
    batch: {
      domain,
      rowCount: dataRows.length,
      ...(domain === 'people' ? { people } : domain === 'credentials' ? { credentials } : { agreements }),
    },
  };
}

// ── the ImportBatch approval payload ─────────────────────────────────────────

/** Sentinel for Approval.targetPersonId on import batches (member-ops precedent). */
export const IMPORT_BATCH_TARGET = 'N/A-IMPORT';

/**
 * A batch row = a create-schema input PLUS import-only extras (isActive /
 * status). The create schemas are .strict(), so a plain .and() intersection
 * would refuse the extra keys — instead: split the object, validate each part
 * against its own schema (the create schema stays the single source of
 * truth), merge.
 */
function rowSchema<B extends z.ZodTypeAny, S extends z.ZodRawShape>(base: B, extras: z.ZodObject<S>) {
  const extraKeys = new Set(Object.keys(extras.shape));
  return z.record(z.unknown()).transform((obj, ctx): z.infer<B> & z.infer<z.ZodObject<S>> => {
    const corePart: Record<string, unknown> = {};
    const extraPart: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) (extraKeys.has(k) ? extraPart : corePart)[k] = v;
    const core = base.safeParse(corePart);
    const extra = extras.safeParse(extraPart);
    if (!core.success) for (const issue of core.error.issues) ctx.addIssue(issue);
    if (!extra.success) for (const issue of extra.error.issues) ctx.addIssue(issue);
    if (!core.success || !extra.success) return z.NEVER;
    return { ...(core.data as object), ...(extra.data as object) } as z.infer<B> & z.infer<z.ZodObject<S>>;
  });
}

const peopleRowSchema = rowSchema(addPersonInputSchema, z.object({ isActive: z.boolean() }));
const credentialsRowSchema = rowSchema(addCredentialInputSchema, z.object({ isActive: z.boolean() }));
const agreementsRowSchema = rowSchema(addAgreementInputSchema, z.object({ status: z.enum(['Active', 'Terminated']) }));

export const importBatchInputSchema = z
  .object({
    domain: z.enum(IMPORT_DOMAINS),
    fileName: z.string().min(1).max(255),
    rowCount: z.number().int().positive().max(5000),
    people: z.array(peopleRowSchema).optional(),
    credentials: z.array(credentialsRowSchema).optional(),
    agreements: z.array(agreementsRowSchema).optional(),
  })
  .refine(
    (v) =>
      (v.domain === 'people' && (v.people?.length ?? 0) === v.rowCount) ||
      (v.domain === 'credentials' && (v.credentials?.length ?? 0) === v.rowCount) ||
      (v.domain === 'agreements' && (v.agreements?.length ?? 0) === v.rowCount),
    { message: 'The batch rows do not match the declared domain and count.' },
  );
export type ImportBatchInput = z.infer<typeof importBatchInputSchema>;
