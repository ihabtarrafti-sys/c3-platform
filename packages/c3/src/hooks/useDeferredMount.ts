import { useRef } from 'react';

/**
 * useDeferredMount — defer mounting a Fluent overlay until it is first opened.
 *
 * TD-33 (Sprint 32): Fluent UI v9 `OverlayDrawer` / `Dialog` initialize a
 * Tabster *modalizer* when they MOUNT — even with `open={false}`. On a COLD
 * screen render (a fresh page load where the Tabster core has not yet created
 * its `attrHandlers` map) that modalizer init throws
 * "Cannot read properties of undefined (reading 'set')", which the app error
 * boundary catches as "Something went wrong". The C3 panels were rendered
 * always-mounted (`<OverlayDrawer open={state}>`), so the first workspace that
 * renders such a panel (e.g. People → AddPersonPanel) crashed on a cold visit.
 *
 * This hook latches to `true` the first time `open` becomes truthy and stays
 * true thereafter. Panels call it and render `null` until it returns true, so:
 *   - the closed overlay is NEVER in a cold initial render → no premature
 *     modalizer init → no crash;
 *   - once the user opens it, the overlay stays mounted (open toggles), so the
 *     close transition and focus restoration behave exactly as before.
 *
 * Pure lifecycle correction: no Tabster/Fluent internals are touched, no
 * provider change, no governed-write behavior change.
 */
export function useDeferredMount(open: boolean): boolean {
  const hasOpened = useRef(false);
  if (open) hasOpened.current = true;
  return hasOpened.current;
}
