/**
 * tabsterSandbox.ts — Sprint 33 Correction Set B (TD-33 interop stabilization).
 *
 * PROVEN DEFECT (hosted 1.0.0.5 + tabster 8.8 source): SharePoint's page shell
 * owns an OLDER tabster instance on `window.__tabsterInstance`. tabster 8.x
 * `createTabster(win)` adopts ANY existing instance version-blind, and its
 * `getModalizer`/`getRestorer` then run
 *
 *     core.modalizer = api;                 // (a) assigns BEFORE registering
 *     core.attrHandlers.set("modalizer",…)  // (b) THROWS — old core has no
 *                                           //     attrHandlers subsystem
 *
 * so the FIRST Fluent modal/overlay initialization on a foreign-instance
 * session throws in a layout effect (screen ErrorBoundary), while (a) makes
 * every RETRY skip the throwing branch — explaining the observed
 * first-open-crashes / second-open-works behaviour. Even the "working" retry
 * state is degraded: the v8 attribute handlers are never registered in the
 * old core's dispatch pipeline, so focus containment is not actually active.
 *
 * CORRECTION: give C3's FluentProvider a `targetDocument` FACADE whose
 * `defaultView` virtualizes ONLY the tabster global slots. Fluent's
 * `useTabster` then finds no existing instance and creates a PRIVATE,
 * fully-compatible tabster core for C3:
 *
 *   - SharePoint's global instance is never adopted, never touched, never
 *     mutated (this also REMOVES the accidental (a)-mutation that 1.0.0.5
 *     and earlier performed on SP's core);
 *   - every other window/document operation passes through to the real
 *     objects (natives bound to their real receivers), so listeners, timers,
 *     portals, styles and DOM observation all act on the real page;
 *   - when the C3 root unmounts, the private core disposes into the private
 *     slots — nothing leaks onto the real window.
 *
 * The facade is deliberately minimal: three virtualized properties, bound
 * pass-through for everything else. If Proxy construction fails for any
 * reason the caller falls back to the real document and the existing
 * TabsterInitializerBoundary remains the bounded fail-safe.
 */

/** The window-global slots tabster (any version) uses for instance discovery. */
const TABSTER_SLOTS = new Set<PropertyKey>([
  '__tabsterInstance',
  '__tabsterInstanceContext',
  '__tabsterShadowDOMAPI',
]);

interface SandboxHandle {
  document: Document;
  /** Bounded diagnostics: true when the facade is in use. */
  active: boolean;
}

/**
 * Build a pass-through proxy that (1) virtualizes the given slots into a
 * private store and (2) binds function properties to the real target so
 * native methods keep their required receivers. Bound functions are cached
 * per property so identity stays stable across reads.
 */
function buildFacade<T extends object>(
  real: T,
  privateSlots: Map<PropertyKey, unknown>,
  virtualized: Set<PropertyKey>,
  overrides: Map<PropertyKey, unknown>,
): T {
  const boundCache = new Map<PropertyKey, unknown>();
  return new Proxy(real, {
    get(target, key, _receiver) {
      if (overrides.has(key)) return overrides.get(key);
      if (virtualized.has(key)) return privateSlots.get(key);
      const value = Reflect.get(target, key);
      // Bind ONLY receiver-dependent methods (natives like addEventListener /
      // setTimeout / getComputedStyle have no .prototype). Constructors and
      // classes (HTMLElement, MutationObserver, Event, …) MUST pass through
      // unbound: a bound function has no .prototype, which breaks
      // `win.HTMLElement.prototype` consumers (e.g. keyborg native-focus
      // detection) and instanceof-adjacent code.
      if (
        typeof value === 'function' &&
        (value as { prototype?: unknown }).prototype === undefined
      ) {
        let bound = boundCache.get(key);
        if (bound === undefined) {
          bound = (value as (...args: unknown[]) => unknown).bind(target);
          boundCache.set(key, bound);
        }
        return bound;
      }
      return value;
    },
    set(target, key, value) {
      if (virtualized.has(key)) {
        privateSlots.set(key, value);
        return true;
      }
      return Reflect.set(target, key, value);
    },
    has(target, key) {
      if (virtualized.has(key)) return privateSlots.has(key);
      return Reflect.has(target, key);
    },
    deleteProperty(target, key) {
      if (virtualized.has(key)) {
        privateSlots.delete(key);
        return true;
      }
      return Reflect.deleteProperty(target, key);
    },
  });
}

/**
 * Create the sandboxed document for C3's FluentProvider. Returns null when
 * the facade cannot be constructed — callers must fall back to the real
 * document (bounded degradation guarded by TabsterInitializerBoundary).
 */
export function createTabsterSandbox(realDocument: Document): SandboxHandle | null {
  try {
    const realWindow = realDocument.defaultView;
    if (!realWindow || typeof Proxy !== 'function') return null;

    const privateSlots = new Map<PropertyKey, unknown>();

    const windowFacade = buildFacade(
      realWindow as unknown as object,
      privateSlots,
      TABSTER_SLOTS,
      new Map(),
    ) as unknown as Window & typeof globalThis;

    const documentFacade = buildFacade(
      realDocument,
      privateSlots,
      new Set<PropertyKey>(), // no virtualized props on document itself
      new Map<PropertyKey, unknown>([['defaultView', windowFacade]]),
    );

    return { document: documentFacade, active: true };
  } catch {
    return null;
  }
}
