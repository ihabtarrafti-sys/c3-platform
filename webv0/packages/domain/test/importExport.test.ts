/**
 * importExport.test.ts — the S5 codec: the CSV core (round-trip law), the
 * header contract, per-row validation through the real create schemas, the
 * ids-are-allocated-by-C3 rule, and the in-file duplicate checks.
 */
import { describe, expect, it } from 'vitest';
import { toCsv, parseCsv, CsvParseError, neutralizeFormula, denormalizeFormula, validateImportCsv, importBatchInputSchema, PEOPLE_COLUMNS, AGREEMENTS_COLUMNS } from '../src/index';

describe('the CSV core', () => {
  it('round-trip law: toCsv → parseCsv → toCsv is byte-identical, through quotes, commas, and newlines', () => {
    const headers = ['a', 'b', 'c'];
    const rows = [
      ['plain', 'with,comma', 'with "quotes"'],
      ['multi\nline', '', 'trailing '],
      ['"leading quote', 'ok', 'end'],
    ];
    const csv = toCsv(headers, rows);
    const parsed = parseCsv(csv);
    expect(parsed[0]).toEqual(headers);
    expect(parsed.slice(1)).toEqual(rows);
    expect(toCsv(parsed[0]!, parsed.slice(1))).toBe(csv); // byte-identical
  });

  it('formula-injection defense (M-08): the FULL prefix class exports inert; idempotent; import round-trip preserves the value', () => {
    // Round 2: the class must also include leading SPACE, LF, and other controls
    // (a spreadsheet may strip them to reveal a formula), not just =/+/-/@/TAB/CR.
    for (const t of ['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\tfoo', '\rbar', ' =1+1', '\n=evil', '\x01ctrl']) {
      expect(neutralizeFormula(t)).toBe(`'${t}`);
      expect(neutralizeFormula(neutralizeFormula(t))).toBe(`'${t}`); // idempotent
      // R2-N08: the inverse restores the EXACT original on machine re-import.
      expect(denormalizeFormula(neutralizeFormula(t))).toBe(t);
    }
    for (const ok of ['Alice', 'PER-0001', 'note = value', "'already", '', '2026-01-01']) {
      expect(neutralizeFormula(ok)).toBe(ok);
      expect(denormalizeFormula(ok)).toBe(ok); // a legit apostrophe-led value is untouched
    }
    // through the codec: a dangerous cell is emitted with the apostrophe guard…
    const csv = toCsv(['a'], [['=1+1'], ['@evil,x'], ['plain']]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain('"\'@evil,x"'); // neutralized THEN RFC-quoted for the comma
    // …and the round-trip law still holds byte-identically with a triggered value present.
    const parsed = parseCsv(csv);
    expect(toCsv(parsed[0]!, parsed.slice(1))).toBe(csv);
  });

  it('accepts CRLF, rejects structural garbage with a line number', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(() => parseCsv('a,"unterminated\n1,2')).toThrow(CsvParseError);
    expect(() => parseCsv('a,"bad"x\n')).toThrow(/after closing quote/);
    expect(() => parseCsv('a,b"mid\n')).toThrow(/quote inside/);
  });
});

describe('validateImportCsv', () => {
  const peopleCsv = (rows: string[][]) => toCsv(PEOPLE_COLUMNS, rows);

  it('a clean people file parses to the batch; blanks become nulls; isActive defaults true', () => {
    const res = validateImportCsv(
      'people',
      peopleCsv([
        ['', 'Jordan Reyes', 'JREY', 'PH', 'Player', 'R6/PL/007', 'R6', 'Rainbow Six', '', '', 'star', 'true'],
        ['', 'Dana Cole', '', '', '', '', '', '', 'Operations', '', '', ''],
      ]),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.batch.rowCount).toBe(2);
    expect(res.batch.people![0]).toMatchObject({ fullName: 'Jordan Reyes', ign: 'JREY', personnelCode: 'R6/PL/007', isActive: true });
    expect(res.batch.people![1]).toMatchObject({ fullName: 'Dana Cole', ign: null, primaryDepartment: 'Operations', isActive: true });
  });

  it('ALL-OR-NOTHING: one bad row fails the file with addressed errors; a filled id column is refused', () => {
    const res = validateImportCsv(
      'people',
      peopleCsv([
        ['PER-0001', 'Jordan Reyes', '', '', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', '', '', '', 'maybe'],
      ]),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.row === 1 && e.column === 'personId' && /allocated by C3/.test(e.message))).toBe(true);
    expect(res.errors.some((e) => e.row === 2 && e.column === 'fullName')).toBe(true);
    expect(res.errors.some((e) => e.row === 2 && e.column === 'isActive')).toBe(true);
  });

  it('the header row is the contract: wrong headers are refused with the expected list', () => {
    const res = validateImportCsv('people', 'name,stuff\nJordan,1\n');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]!.column).toBe('(header)');
    expect(res.errors[0]!.message).toContain('fullName');
  });

  it('agreements ride the real schemas: the anchor rule and date coherence apply per row; duplicate codes in-file are caught', () => {
    const agr = (rows: string[][]) => toCsv(AGREEMENTS_COLUMNS, rows);
    // no person AND no entity → the anchor refusal from addAgreementInputSchema
    let res = validateImportCsv('agreements', agr([['', '', '', '', 'Floating', '', '2026-01-01', '2027-01-01', '', '', '']]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => /anchor/.test(e.message))).toBe(true);

    // end before start
    res = validateImportCsv('agreements', agr([['', 'PER-0001', '', '', 'Contract', '', '2027-01-01', '2026-01-01', '', '', '']]));
    expect(res.ok).toBe(false);

    // duplicate agreementCode within the file
    res = validateImportCsv(
      'agreements',
      agr([
        ['', 'PER-0001', '', 'GKE-1', 'Contract', '', '2026-01-01', '2027-01-01', '100', '', 'Active'],
        ['', 'PER-0002', '', 'GKE-1', 'Contract', '', '2026-01-01', '2027-01-01', '', '', 'Terminated'],
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.column === 'agreementCode' && /Duplicate/.test(e.message))).toBe(true);

    // a clean historical row keeps its Terminated status and integer cents
    res = validateImportCsv('agreements', agr([['', 'PER-0001', '', '', 'Old Contract', '', '2024-01-01', '2025-01-01', '250000', '', 'Terminated']]));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.batch.agreements![0]).toMatchObject({ status: 'Terminated', valueUsdCents: 250000 });
  });

  it('an empty file and a header-only file are refused', () => {
    expect(validateImportCsv('people', '').ok).toBe(false);
    expect(validateImportCsv('people', toCsv(PEOPLE_COLUMNS, [])).ok).toBe(false);
  });

  it('the approval snapshot law: importBatchInputSchema accepts exactly what validateImportCsv produces', () => {
    // The batch travels as an approval payload and is re-parsed at execution —
    // the payload schema and the validator must never drift apart. (The create
    // schemas are .strict(); rows carry extras, so this is a real trap.)
    const people = validateImportCsv('people', peopleCsv([['', 'Jordan Reyes', '', '', '', '', '', '', '', '', '', 'false']]));
    expect(people.ok).toBe(true);
    if (!people.ok) return;
    const payload = importBatchInputSchema.safeParse({ domain: 'people', fileName: 'x.csv', rowCount: 1, people: people.batch.people });
    expect(payload.success, JSON.stringify(!payload.success ? payload.error.issues : null)).toBe(true);
    if (payload.success) expect(payload.data.people![0]).toMatchObject({ fullName: 'Jordan Reyes', isActive: false });

    const agr = validateImportCsv(
      'agreements',
      toCsv(AGREEMENTS_COLUMNS, [['', 'PER-0001', '', '', 'Contract', '', '2026-01-01', '2027-01-01', '100', '', 'Terminated']]),
    );
    expect(agr.ok).toBe(true);
    if (!agr.ok) return;
    const agrPayload = importBatchInputSchema.safeParse({ domain: 'agreements', fileName: 'y.csv', rowCount: 1, agreements: agr.batch.agreements });
    expect(agrPayload.success, JSON.stringify(!agrPayload.success ? agrPayload.error.issues : null)).toBe(true);
    if (agrPayload.success) expect(agrPayload.data.agreements![0]).toMatchObject({ status: 'Terminated', valueUsdCents: 100 });
  });
});
