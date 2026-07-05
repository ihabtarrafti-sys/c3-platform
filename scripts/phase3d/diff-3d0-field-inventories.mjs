/**
 * diff-3d0-field-inventories.mjs — Sprint 32 Phase 3D field-inventory diff tool.
 *
 * Compares the `snapshotA.fields` arrays of two saved 3D-0 evidence JSON files
 * (window.__C3_PHASE3D0_EVIDENCE) and prints, per field: added / removed /
 * changed, with the exact property-level differences — so field-inventory
 * fingerprint drift can be classified precisely (business change vs
 * SharePoint-managed metadata such as SchemaXml attribute churn).
 *
 * Usage: node scripts/phase3d/diff-3d0-field-inventories.mjs <prior.json> <fresh.json>
 * Read-only; touches nothing but the two local files.
 */
import { readFileSync } from 'node:fs';

const PROPS = ['Id', 'InternalName', 'Title', 'TypeAsString', 'Required', 'Indexed', 'EnforceUniqueValues', 'Hidden', 'ReadOnlyField', 'Sealed', 'FromBaseType', 'CanBeDeleted', 'LookupList', 'LookupField', 'DefaultValue', 'SchemaXml'];
const BUSINESS_PROPS = new Set(['Id', 'InternalName', 'Title', 'TypeAsString', 'Required', 'Indexed', 'EnforceUniqueValues', 'Hidden', 'ReadOnlyField', 'Sealed', 'FromBaseType', 'CanBeDeleted', 'LookupList', 'LookupField', 'DefaultValue']);

const [, , priorPath, freshPath] = process.argv;
if (!priorPath || !freshPath) { console.error('Usage: node diff-3d0-field-inventories.mjs <prior.json> <fresh.json>'); process.exit(2); }
const load = (p) => {
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const fields = j?.snapshotA?.fields ?? j?.fields;
  if (!Array.isArray(fields)) { console.error(`${p}: no snapshotA.fields array found`); process.exit(2); }
  return new Map(fields.map(f => [f.InternalName, f]));
};
const prior = load(priorPath), fresh = load(freshPath);

const added = [...fresh.keys()].filter(k => !prior.has(k));
const removed = [...prior.keys()].filter(k => !fresh.has(k));
const changed = [];
for (const [name, p] of prior) {
  const f = fresh.get(name);
  if (!f) continue;
  const diffs = PROPS.filter(k => String(p[k] ?? '∅') !== String(f[k] ?? '∅'))
    .map(k => ({ prop: k, prior: p[k] ?? null, fresh: f[k] ?? null, business: BUSINESS_PROPS.has(k) }));
  if (diffs.length) changed.push({ field: name, diffs });
}

console.log('Added fields:', JSON.stringify(added));
console.log('Removed fields:', JSON.stringify(removed));
for (const c of changed) {
  console.log(`\nCHANGED: ${c.field}`);
  for (const d of c.diffs) {
    console.log(`  [${d.business ? 'BUSINESS-RELEVANT' : 'SchemaXml/metadata'}] ${d.prop}:`);
    console.log(`    prior: ${JSON.stringify(d.prior)}`);
    console.log(`    fresh: ${JSON.stringify(d.fresh)}`);
  }
}
const businessDrift = added.length || removed.length || changed.some(c => c.diffs.some(d => d.business));
console.log(`\nSummary: ${added.length} added · ${removed.length} removed · ${changed.length} changed`);
console.log(businessDrift
  ? 'CLASSIFICATION: BUSINESS-RELEVANT drift present — STOP; owner review required.'
  : changed.length
    ? 'CLASSIFICATION: differences confined to SchemaXml/managed metadata — safe-to-rebind candidate (confirm the 3D-0 rev3 probe classification agrees).'
    : 'CLASSIFICATION: inventories identical.');
process.exit(businessDrift ? 1 : 0);
