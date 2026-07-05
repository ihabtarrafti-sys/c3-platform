/**
 * s33-parity-hosted-feedback.mjs — RISK-1 hosted governed-write feedback.
 *
 * When the Fluent Toaster is disabled in the SPFx-hosted host, governed-write
 * outcomes (success AND failure) were silent. This gate proves the fix is intact:
 *   - useToast routes to the inline NotificationRegion when disableToasts, and
 *     preserves the Fluent Toaster path otherwise (Mock DSM parity);
 *   - NotificationRegion is Toaster-independent (no Fluent Toast dependency),
 *     accessible (aria-live + alert/status roles), and provider-wrapped;
 *   - App.tsx always mounts NotificationProvider around the app shell;
 *   - no locked boundary is disturbed (no ADR/fetch/ID/ETag/governance change).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');

let passed = 0; const failures = [];
const check = (name, cond) => { if (cond) { passed++; } else { failures.push(name); console.error(`✖ ${name}`); } };

const toast = read('packages/c3/src/hooks/useToast.tsx');
const region = read('packages/c3/src/components/NotificationRegion.tsx');
const app = read('packages/c3/src/App.tsx');

// ── useToast routing ─────────────────────────────────────────────────────────
check('useToast: reads config.disableToasts', /config\.disableToasts\s*===\s*true/.test(toast) && toast.includes('useInline'));
check('useToast: routes success to inline notify when disabled', /success[\s\S]{0,200}if \(useInline\)[\s\S]{0,80}notify\(\{ intent: 'success'/.test(toast));
check('useToast: routes error to inline notify when disabled', /error[\s\S]{0,200}if \(useInline\)[\s\S]{0,80}notify\(\{ intent: 'error'/.test(toast));
check('useToast: preserves Fluent Toaster path when enabled (dispatchToast retained)', (toast.match(/dispatchToast\(/g) || []).length >= 2 && toast.includes('useToastController(C3_TOASTER_ID)'));
check('useToast: unchanged public surface { success, error }', /return \{ success, error \}/.test(toast));
check('useToast: imports the inline channel + app config', toast.includes("from '@c3/components/NotificationRegion'") && toast.includes("from '@c3/hooks/useApp'"));

// ── NotificationRegion: Toaster-independent + accessible ──────────────────────
check('region: exports NotificationProvider + useNotifications', region.includes('export const NotificationProvider') && region.includes('export const useNotifications'));
check('region: is Toaster-independent (no Fluent import or Toaster usage)', !/from '@fluentui/.test(region) && !/useToastController\(|dispatchToast\(/.test(region));
check('region: accessible (aria-live + alert/status roles)', region.includes('aria-live') && region.includes("role={n.intent === 'error' ? 'alert' : 'status'}"));
check('region: errors persist longer than successes', /ERROR_TTL_MS\s*=\s*8000/.test(region) && /SUCCESS_TTL_MS\s*=\s*4000/.test(region));
check('region: auto-dismiss + manual dismiss', region.includes('setTimeout(') && region.includes('onDismiss') && region.includes('Dismiss notification'));
check('region: bounded queue (does not grow unbounded)', region.includes('slice(-MAX_VISIBLE)'));
check('region: useNotifications fails safe outside provider', /ctx \?\? \{ notify: \(\) =>/.test(region));

// ── App wiring ───────────────────────────────────────────────────────────────
check('app: NotificationProvider always wraps the app shell', /<NotificationProvider>[\s\S]{0,80}<AppShell \/>[\s\S]{0,40}<\/NotificationProvider>/.test(app));
check('app: Fluent Toaster still gated on !disableToasts (Mock/local unchanged)', app.includes('{!config.disableToasts && (') && app.includes('<Toaster toasterId={C3_TOASTER_ID}'));

// ── locked-boundary safety (this fix introduces no write/governance surface) ──
check('boundary: feedback fix adds no SP write/governance/ETag/ID surface',
  !/_api\/|X-HTTP-Method|IF-MATCH|createApproval|stampExecution|roleassignment|String\(.*\.Id\)/i.test(region + toast));

const total = passed + failures.length;
if (failures.length) { console.error(`s33-parity-hosted-feedback: ${passed}/${total} — FAILURES: ${failures.length}`); process.exit(1); }
console.log(`s33-parity-hosted-feedback: ${passed}/${total} PASS`);
