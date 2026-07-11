/**
 * settingsOps — HARDEN-2: the tenant settings kernel; first resident =
 * PER-DIEM PRESETS (the S2 rider comes home: 65 SAR / 100 SAR / 25 USD as
 * editable quick-picks for the per-diem dialog).
 *
 * Reads ride the mission-money surface (owner/operations set per-diems, so
 * they read the presets). Writes are DIRECT-AUDITED owner/operations acts,
 * version-guarded from birth (M-03): expectedVersion null asserts "I saw the
 * DEFAULTS (no row)"; any mismatch with reality is a concurrency refusal.
 */
import {
  type Actor,
  ConcurrencyError,
  DEFAULT_PER_DIEM_PRESETS,
  PER_DIEM_PRESETS_KEY,
  type PerDiemPreset,
  type SetPerDiemPresetsInput,
  parsePerDiemPresets,
  setPerDiemPresetsInputSchema,
} from '@c3web/domain';
import { assertManageMissions } from '@c3web/authz';
import type { Persistence } from '../ports';

export interface PerDiemPresetsView {
  readonly presets: readonly PerDiemPreset[];
  /** Null while the tenant is on the code-side DEFAULTS (no row yet). */
  readonly version: number | null;
}

export async function getPerDiemPresets(p: Persistence, actor: Actor): Promise<PerDiemPresetsView> {
  assertManageMissions(actor); // who sets per-diems reads the presets
  const row = await p.reads.forActor(actor).getTenantSetting(PER_DIEM_PRESETS_KEY);
  if (!row) return { presets: DEFAULT_PER_DIEM_PRESETS, version: null };
  return { presets: parsePerDiemPresets(row.value), version: row.version };
}

export async function setPerDiemPresets(p: Persistence, actor: Actor, input: SetPerDiemPresetsInput): Promise<PerDiemPresetsView> {
  assertManageMissions(actor);
  const parsed = setPerDiemPresetsInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getTenantSetting(PER_DIEM_PRESETS_KEY);
    if (current && parsed.expectedVersion === null) throw new ConcurrencyError('Setting', PER_DIEM_PRESETS_KEY);
    if (current && parsed.expectedVersion !== current.version) throw new ConcurrencyError('Setting', PER_DIEM_PRESETS_KEY);
    if (!current && parsed.expectedVersion !== null) throw new ConcurrencyError('Setting', PER_DIEM_PRESETS_KEY);

    const written = current
      ? await tx.updateTenantSetting(PER_DIEM_PRESETS_KEY, current.version, parsed.presets)
      : await tx.insertTenantSetting(PER_DIEM_PRESETS_KEY, parsed.presets);
    if (!written) throw new ConcurrencyError('Setting', PER_DIEM_PRESETS_KEY);

    await tx.appendAuditEvent({
      entityType: 'Setting',
      entityId: PER_DIEM_PRESETS_KEY,
      action: 'PerDiemPresetsSet',
      actor: actor.identity,
      before: current ? { presets: parsePerDiemPresets(current.value) } : { presets: DEFAULT_PER_DIEM_PRESETS, defaults: true },
      after: { presets: parsed.presets },
    });
    return { presets: parsePerDiemPresets(written.value), version: written.version };
  });
}
