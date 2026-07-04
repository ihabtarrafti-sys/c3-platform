/**
 * s31-parity-approval-queries.mjs
 *
 * Sprint 31 — Approval Query Integrity parity harness.
 *
 * Compiles the ACTUAL production source via esbuild (s27…s30 pattern):
 *   packages/c3/src/services/sharepoint/SharePointApprovalsService.ts
 *     — driven through the injected fetch boundary (real paging, ordering,
 *       dedup, fail-closed, integrity, cancellation, ETag header behaviour)
 *   packages/c3/src/services/mock/MockApprovalsService.ts
 *     — observable filtering/ordering/window parity
 *   packages/c3/src/utils/spApprovalMapper.ts
 *     — legacy/derived APR identity
 *
 * Run: node scripts/s31-parity-approval-queries.mjs
 */

import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'packages', 'c3', 'src');
const tmp = mkdtempSync(join(tmpdir(), 's31-parity-'));

function compile(entryRel, outName) {
  const outfile = join(tmp, outName);
  buildSync({
    entryPoints: [join(srcRoot, entryRel)],
    bundle: true, format: 'cjs', platform: 'node', outfile,
    logLevel: 'error', alias: { '@c3': srcRoot },
  });
  return require(outfile);
}

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`); }
}
async function rejects(label, promise, match) {
  try { await promise; check(label, false, 'resolved instead of rejecting'); return null; }
  catch (err) {
    const msg = err?.message ?? String(err);
    check(label, match ? match(err, msg) : true, `rejected but predicate failed: ${err?.name}: ${msg.slice(0, 160)}`);
    return err;
  }
}

const SITE = 'https://geekaygames.sharepoint.com/sites/C3';
const ITEMS_BASE = `${SITE}/_api/web/lists/getbytitle('C3Approvals')/items`;

/** Build a raw SP approval item. */
const row = (id, status, over = {}) => ({
  ID: id, Title: null, OperationType: 'AddCredential', TargetID: null,
  TargetPersonID: 'PER-0001', SubmittedBy: 'ops@geekay.gg',
  SubmittedAt: '2026-07-01T10:00:00Z', ApprovalStatus: status,
  ReviewedBy: null, ReviewedAt: null, ExecutedAt: null, ExecutionError: null,
  DelegatedBy: null, DelegateTo: null, Reason: null, RejectionReason: null,
  Payload: '{"operationType":"AddCredential"}', ...over,
});

/**
 * Fake fetch factory.
 * routes: array of { match: (url) => boolean|object, respond: (url, init) => Response-ish }
 * Also records every request for header/URL assertions.
 */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    if (init.signal?.aborted) {
      const e = new Error('The operation was aborted.'); e.name = 'AbortError'; throw e;
    }
    calls.push({ url: String(url), init });
    const res = await handler(String(url), init, calls);
    if (res instanceof Error) throw res;
    return {
      ok: res.status === undefined || (res.status >= 200 && res.status < 300),
      status: res.status ?? 200,
      statusText: res.statusText ?? 'OK',
      json: async () => {
        if (res.malformedJson) throw new Error('Unexpected token < in JSON');
        return res.body ?? {};
      },
      text: async () => JSON.stringify(res.body ?? {}),
    };
  };
  impl.calls = calls;
  return impl;
}

/** Page responder for one status query with optional nextLink chains. */
function pagesForStatus(pages) {
  // pages: Map<status, Array<items[]>> — each array element is one page.
  return (url) => {
    const m = /ApprovalStatus%20eq%20'([A-Za-z]+)'/.exec(url) ?? /ApprovalStatus eq '([A-Za-z]+)'/.exec(decodeURIComponent(url));
    const pageM = /__page=(\d+)/.exec(url);
    const status = m?.[1];
    if (!status || !pages.has(status)) return { body: { value: [] } };
    const seq = pages.get(status);
    const idx = pageM ? Number(pageM[1]) : 0;
    const body = { value: seq[idx] ?? [] };
    if (idx + 1 < seq.length) {
      body['odata.nextLink'] = `${ITEMS_BASE}?$filter=${encodeURIComponent(`ApprovalStatus eq '${status}'`)}&__page=${idx + 1}`;
    }
    return { body };
  };
}

try {
  const sp = compile('services/sharepoint/SharePointApprovalsService.ts', 'spApprovals.cjs');
  const mock = compile('services/mock/MockApprovalsService.ts', 'mockApprovals.cjs');
  const mapper = compile('utils/spApprovalMapper.ts', 'mapper.cjs');
  const ifc = compile('services/interfaces/IApprovalsService.ts', 'ifc.cjs');

  const realWarn = console.warn, realInfo = console.info;
  console.warn = () => {}; console.info = () => {};

  const svc = (handler) => {
    const f = fakeFetch(handler);
    return { service: sp.createSharePointApprovalsService(SITE, 'owner@geekay.gg', f), fetch: f };
  };

  // ── 1. Multi-page assembly + Id-desc determinism + cross-page dedup ───────
  {
    const pages = new Map([
      ['Submitted', [[row(3, 'Submitted'), row(1, 'Submitted')], [row(7, 'Submitted'), row(3, 'Submitted')]]], // 3 duplicated across pages
      ['InReview',  [[row(5, 'InReview')]]],
      ['Approved',  [[]]],
    ]);
    const { service } = svc(pagesForStatus(pages));
    const result = await service.listPendingApprovals();
    check('1. multi-page assembly + merge across statuses', result.length === 4, `got ${result.length}`);
    check('1b. Id-desc deterministic ordering', JSON.stringify(result.map(a => a.id)) === JSON.stringify([7, 5, 3, 1]));
    check('1c. cross-page dedup by numeric Id', result.filter(a => a.id === 3).length === 1);
  }

  // ── 2. Pending vs actionable status sets ──────────────────────────────────
  {
    const pages = new Map([
      ['Submitted', [[row(1, 'Submitted')]]],
      ['InReview',  [[row(2, 'InReview')]]],
      ['Approved',  [[row(3, 'Approved')]]],
      ['ExecutionFailed', [[row(4, 'ExecutionFailed')]]],
      ['Executed',  [[row(5, 'Executed')]]],
      ['Rejected',  [[row(6, 'Rejected')]]],
    ]);
    const { service, fetch: f } = svc(pagesForStatus(pages));
    const pending = await service.listPendingApprovals();
    check('2. pending = Submitted+InReview+Approved only',
      JSON.stringify(pending.map(a => a.id).sort()) === JSON.stringify([1, 2, 3]));
    const actionable = await service.listActionableApprovals();
    check('2b. actionable adds ExecutionFailed (never windowed)',
      JSON.stringify(actionable.map(a => a.id)) === JSON.stringify([4, 3, 2, 1]));
    check('2c. single-status queries (no OR filters) with Id-desc order',
      f.calls.every(c => !decodeURIComponent(c.url).includes(' or ')) &&
      f.calls.filter(c => c.url.includes('%24orderby=Id%20desc') || c.url.includes('$orderby=Id%20desc')).length === f.calls.length);
  }

  // ── 3. Fail-closed page handling ──────────────────────────────────────────
  {
    // Page 2 fails -> whole call rejects; nothing partial.
    const handler = (url) => {
      if (url.includes('__page=1')) return { status: 500, statusText: 'Server Error', body: {} };
      return pagesForStatus(new Map([['Submitted', [[row(2, 'Submitted')], [row(1, 'Submitted')]]], ['InReview', [[]]], ['Approved', [[]]]]))(url);
    };
    const { service } = svc(handler);
    await rejects('3. partial-page failure is fail-closed', service.listPendingApprovals(),
      (_, msg) => msg.includes('failing closed'));

    // Malformed body -> rejects.
    const { service: s2 } = svc(() => ({ body: { notValue: true } }));
    await rejects('3b. malformed page (missing value array) rejects', s2.listPendingApprovals(),
      (_, msg) => msg.includes('malformed'));

    // Invalid JSON -> rejects.
    const { service: s3 } = svc(() => ({ malformedJson: true }));
    await rejects('3c. unparseable page body rejects', s3.listPendingApprovals());
  }

  // ── 4. nextLink trust validation ──────────────────────────────────────────
  {
    const handler = (url) => {
      if (!url.includes('__page=')) {
        return { body: { value: [row(9, 'Submitted')], 'odata.nextLink': 'https://evil.example.com/_api/steal?__page=1' } };
      }
      return { body: { value: [] } };
    };
    const { service } = svc(handler);
    await rejects('4. cross-origin nextLink is refused', service.listPendingApprovals(),
      (_, msg) => msg.includes('same-origin'));

    const handler2 = (url) => {
      if (!url.includes('__page=')) {
        return { body: { value: [row(9, 'Submitted')], 'odata.nextLink': `${SITE}/notapi/items?__page=1` } };
      }
      return { body: { value: [] } };
    };
    const { service: s2 } = svc(handler2);
    await rejects('4b. non-/_api/ nextLink is refused', s2.listPendingApprovals());
  }

  // ── 5. Query integrity: mapper rejection never yields partial success ─────
  {
    const pages = new Map([
      ['Submitted', [[row(11, 'Submitted'), { ...row(12, 'Submitted'), ApprovalStatus: 'NotAStatus' }]]],
      ['InReview', [[]]], ['Approved', [[]]],
    ]);
    const { service } = svc(pagesForStatus(pages));
    const err = await rejects('5. mapper rejection -> ApprovalQueryIntegrityError',
      service.listPendingApprovals(),
      (e) => e?.name === 'ApprovalQueryIntegrityError');
    check('5b. integrity error carries rejected item IDs',
      Array.isArray(err?.rejectedItemIds) && err.rejectedItemIds.includes(12));
  }

  // ── 6. Cancellation is distinguishable and never an empty success ─────────
  {
    const ctrl = new AbortController();
    ctrl.abort();
    const { service } = svc(pagesForStatus(new Map([['Submitted', [[row(1, 'Submitted')]]], ['InReview', [[]]], ['Approved', [[]]]])));
    await rejects('6. aborted signal rejects with AbortError',
      service.listPendingApprovals({ signal: ctrl.signal }),
      (e) => e?.name === 'AbortError');
  }

  // ── 7. Person filter: server-side, escaped, complete, ordered ─────────────
  {
    const captured = [];
    const handler = (url) => {
      captured.push(decodeURIComponent(url));
      return { body: { value: [row(21, 'Executed', { TargetPersonID: "PER-O'BRIEN" }), row(23, 'Submitted', { TargetPersonID: "PER-O'BRIEN" })] } };
    };
    const { service } = svc(handler);
    const result = await service.listApprovalsByPerson("PER-O'BRIEN");
    check('7. person query is server-filtered on TargetPersonID',
      captured[0].includes("TargetPersonID eq 'PER-O''BRIEN'"));
    check('7b. OData literal escaping doubles quotes', captured[0].includes("O''BRIEN"));
    check('7c. person history Id-desc', JSON.stringify(result.map(a => a.id)) === JSON.stringify([23, 21]));
    check('7d. empty personId returns [] without fetching',
      (await service.listApprovalsByPerson('  ')).length === 0);
  }

  // ── 8. Terminal window semantics ──────────────────────────────────────────
  {
    const pages = new Map([
      ['Executed', [[row(50, 'Executed'), row(40, 'Executed'), row(30, 'Executed')]]],
      ['Rejected', [[row(45, 'Rejected'), row(35, 'Rejected')]]],
    ]);
    const { service } = svc(pagesForStatus(pages));
    const windowed = await service.listRecentTerminalApprovals({ limit: 3 });
    check('8. terminal window honours limit', windowed.length === 3);
    check('8b. terminal window keeps newest by Id across both statuses',
      JSON.stringify(windowed.map(a => a.id)) === JSON.stringify([50, 45, 40]));
  }

  // ── 9. Legacy and derived APR identity ────────────────────────────────────
  {
    const pages = new Map([
      ['Submitted', [[row(88, 'Submitted', { Title: 'APR-0007' }), row(99, 'Submitted', { Title: 'APR-PENDING-xyz-1' })]]],
      ['InReview', [[]]], ['Approved', [[]]],
    ]);
    const { service } = svc(pagesForStatus(pages));
    const result = await service.listPendingApprovals();
    const legacy = result.find(a => a.id === 88);
    const derived = result.find(a => a.id === 99);
    check('9. legacy valid APR Title passes through', legacy?.title === 'APR-0007');
    check('9b. correlation Title derives APR from item Id', derived?.title === 'APR-0099');
    check('9c. mapper deriveApprovalTitle agrees', mapper.deriveApprovalTitle(99, 'APR-PENDING-xyz-1') === 'APR-0099');
  }

  // ── 10. getApproval: fresh row + ETag; null on 404; corruption throws ─────
  {
    const handler = (url) => {
      if (url.includes('items(7)')) return { body: { ...row(7, 'Approved'), 'odata.etag': '"13"' } };
      if (url.includes('items(404)')) return { status: 404, body: {} };
      if (url.includes('items(66)')) return { body: { ...row(66, 'Approved'), ApprovalStatus: null } };
      return { body: { value: [] } };
    };
    const { service, fetch: f } = svc(handler);
    const fresh = await service.getApproval(7);
    check('10. getApproval returns fresh row + etag', fresh?.approval.id === 7 && fresh?.etag === '"13"');
    check('10b. getApproval addresses numeric items(Id) — never a parsed Title',
      f.calls[0].url.includes('items(7)') && !f.calls[0].url.includes('APR-'));
    check('10c. getApproval null on 404', (await service.getApproval(404)) === null);
    await rejects('10d. existing-but-corrupt row throws integrity error',
      service.getApproval(66), (e) => e?.name === 'ApprovalQueryIntegrityError');
  }

  // ── 11. ETag-preconditioned updates ───────────────────────────────────────
  {
    const handler = (url, init) => {
      if (url.endsWith('/_api/contextinfo')) return { body: { FormDigestValue: 'digest-1' } };
      if (url.includes('items(7)') && init.headers?.['X-HTTP-Method'] === 'MERGE') {
        if (init.headers['IF-MATCH'] === '"stale"') return { status: 412, statusText: 'Precondition Failed', body: {} };
        return { status: 204, body: {} };
      }
      return { body: { value: [] } };
    };
    const { service, fetch: f } = svc(handler);
    await service.stampExecution(7, { newStatus: 'Executed', executedAt: '2026-07-04T10:00:00Z' }, '"9"');
    const merge = f.calls.find(c => c.init.headers?.['X-HTTP-Method'] === 'MERGE');
    check('11. stamp uses the supplied fresh ETag as IF-MATCH', merge?.init.headers['IF-MATCH'] === '"9"');

    await service.patchApprovalStatus(7, { newStatus: 'Approved' }, '"9"');
    const merges = f.calls.filter(c => c.init.headers?.['X-HTTP-Method'] === 'MERGE');
    check('11b. patch uses the supplied fresh ETag', merges[1]?.init.headers['IF-MATCH'] === '"9"');

    await service.stampExecution(7, { newStatus: 'Executed', executedAt: '2026-07-04T10:00:00Z' });
    const merges2 = f.calls.filter(c => c.init.headers?.['X-HTTP-Method'] === 'MERGE');
    check('11c. legacy callers without etag keep IF-MATCH * (fallback only)', merges2[2]?.init.headers['IF-MATCH'] === '*');

    await rejects('11d. 412 surfaces as a truthful concurrency failure',
      service.stampExecution(7, { newStatus: 'Executed', executedAt: '2026-07-04T10:00:00Z' }, '"stale"'),
      (_, msg) => msg.includes('412') && msg.includes('changed'));
  }

  // ── 12. Mock parity: observable filtering / ordering / window / getApproval ─
  {
    const m = mock.createMockApprovalsService('owner@geekay.gg');
    // Seed via createApproval (ids 1..6), then walk statuses via patch/stamp.
    for (let i = 0; i < 6; i++) {
      await m.createApproval({ operationType: 'AddCredential', targetPersonId: i < 3 ? 'PER-0001' : 'PER-0002', payload: '{}' });
    }
    // ids: 1..6 all Submitted. Move: 2 -> Rejected, 3 -> Approved -> Executed, 4 -> Approved.
    const reviewer = mock.createMockApprovalsService('reviewer@geekay.gg');
    await reviewer.patchApprovalStatus(2, { newStatus: 'Rejected', rejectionReason: 'no' });
    await reviewer.patchApprovalStatus(3, { newStatus: 'Approved' });
    await reviewer.stampExecution(3, { newStatus: 'Executed', executedAt: '2026-07-04T10:00:00Z' });
    await reviewer.patchApprovalStatus(4, { newStatus: 'Approved' });

    const pending = await m.listPendingApprovals();
    check('12. mock pending band + Id desc',
      JSON.stringify(pending.map(a => a.id)) === JSON.stringify([6, 5, 4, 1]));
    const actionable = await m.listActionableApprovals();
    check('12b. mock actionable equals pending here (no failures seeded)',
      JSON.stringify(actionable.map(a => a.id)) === JSON.stringify([6, 5, 4, 1]));
    const person = await m.listApprovalsByPerson('PER-0001');
    check('12c. mock person filter + order', JSON.stringify(person.map(a => a.id)) === JSON.stringify([3, 2, 1]));
    const terminal = await m.listRecentTerminalApprovals({ limit: 1 });
    check('12d. mock terminal window (newest first, limited)',
      terminal.length === 1 && terminal[0].id === 3);
    const got = await m.getApproval(4);
    check('12e. mock getApproval returns row + synthetic etag', got?.approval.id === 4 && typeof got?.etag === 'string');
    check('12f. mock getApproval null for unknown id', (await m.getApproval(999)) === null);
  }

  // ── 13. Status-set constants match the approved query classes ─────────────
  {
    check('13. PENDING_STATUSES', JSON.stringify(ifc.PENDING_STATUSES) === JSON.stringify(['Submitted', 'InReview', 'Approved']));
    check('13b. ACTIONABLE_STATUSES adds ExecutionFailed', JSON.stringify(ifc.ACTIONABLE_STATUSES) === JSON.stringify(['Submitted', 'InReview', 'Approved', 'ExecutionFailed']));
    check('13c. TERMINAL_STATUSES', JSON.stringify(ifc.TERMINAL_STATUSES) === JSON.stringify(['Executed', 'Rejected']));
  }

  console.warn = realWarn; console.info = realInfo;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
