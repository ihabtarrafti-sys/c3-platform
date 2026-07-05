/**
 * hostMount — pure, testable helpers for the C3 SPFx host mount lifecycle.
 *
 * TD-34 (Sprint 32): on a COLD hosted load the async `componentDidMount` of
 * C3Host awaits the runtime chunk import; during that window SharePoint may
 * re-render or dispose the web part, and the runtime export may not be
 * retrievable. The original host mounted unconditionally and unguarded, so a
 * detached container, a missing export, or a thrown mount silently left an
 * empty <div> with no error. These pure helpers make the two risky decisions
 * unit-testable in isolation from React/SPFx.
 */
import type { PlatformApplication } from '../runtime/C3RuntimeLoader';

export type RuntimeValidation =
  | { ok: true; app: PlatformApplication }
  | { ok: false; reason: string };

/**
 * Validate the dynamically imported runtime module exposes a usable mount API.
 * Never assumes success just because the chunk was fetched.
 */
export function validateRuntimeModule(mod: unknown): RuntimeValidation {
  const app = (mod as { runtime?: unknown } | null | undefined)?.runtime;
  if (!app || typeof app !== 'object') {
    return { ok: false, reason: 'C3 runtime module did not export a runtime object.' };
  }
  const candidate = app as Partial<PlatformApplication>;
  if (typeof candidate.mount !== 'function') {
    return { ok: false, reason: 'C3 runtime export is missing a mount() function.' };
  }
  if (typeof candidate.unmount !== 'function') {
    return { ok: false, reason: 'C3 runtime export is missing an unmount() function.' };
  }
  return { ok: true, app: app as PlatformApplication };
}

export interface MountDecisionInput {
  /** The host component was disposed (componentWillUnmount) — possibly mid-import. */
  disposed: boolean;
  /** A successful mount already happened — guard against duplicate mounts. */
  alreadyMounted: boolean;
  /** The mount target ref is present AND still connected to the document. */
  targetConnected: boolean;
}

export type MountDecision =
  | { mount: true }
  | { mount: false; reason: 'disposed' | 'duplicate' | 'detached' };

/**
 * Decide whether it is safe to mount the runtime after the (async) import
 * resolved. Order matters: a disposed host must never mount, a duplicate must
 * never re-mount, and a detached container must never be mounted into.
 */
export function decideMount(input: MountDecisionInput): MountDecision {
  if (input.disposed) return { mount: false, reason: 'disposed' };
  if (input.alreadyMounted) return { mount: false, reason: 'duplicate' };
  if (!input.targetConnected) return { mount: false, reason: 'detached' };
  return { mount: true };
}
