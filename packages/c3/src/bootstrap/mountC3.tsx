import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LocalHost } from '../hosts/LocalHost';
import { SharePointHost } from '../hosts/SharePointHost';
import {
  defaultHostContext,
  HostContextProvider,
} from '../hosts/HostContext';
import { ErrorBoundary } from '../components/ErrorBoundary';

import type { HostRuntime } from './HostRuntime';

import type { C3Runtime } from './C3Runtime';

// ---------------------------------------------------------------------------
// TD-34 (Sprint 33) — first-render truthfulness at the mount root.
//
// Two silent blank-container classes existed here:
//   1. A render-phase throw ABOVE the screen-level ErrorBoundary in AppShell
//      (FluentProvider / TabsterInitializer / providers) made React 18 unmount
//      the ENTIRE tree: root stays attached, zero committed DOM, error only
//      rethrown asynchronously where nobody records it. The ROOT ErrorBoundary
//      below converts that into a VISIBLE fail-closed fallback and reports it
//      to host diagnostics via onRuntimeError.
//   2. mount() returns after root.render() merely SCHEDULES the concurrent
//      commit. FirstCommitSignal's layout effect can only run after the root's
//      first commit, so its callback is the host's proof that application DOM
//      actually committed (onFirstCommit). No signal ⇒ scheduled-but-never-
//      committed ⇒ the host may run its bounded one-shot recovery.
//
// The normal successful path remains a SINGLE mount; the signal fires once.
// ---------------------------------------------------------------------------

const roots = new WeakMap<HTMLElement, Root>();

/** Fires `onFirstCommit` exactly once, after the root's first commit.
 *  Layout effects run only post-commit, so this cannot fire for a render
 *  that never committed. Idempotent under StrictMode double-invocation. */
const FirstCommitSignal = ({
  onFirstCommit,
}: {
  onFirstCommit?: () => void;
}): null => {
  const fired = React.useRef(false);
  React.useLayoutEffect(() => {
    if (fired.current) return;
    fired.current = true;
    onFirstCommit?.();
  }, [onFirstCommit]);
  return null;
};

export const mountC3 = (
  container: HTMLElement,
  runtime?: HostRuntime,
): void => {
  // TD-34 hosted diagnostics: record whether a tabster instance already
  // exists on this window and whether it is a FOREIGN (older) one lacking
  // the internals our Fluent version requires. Foreign = SharePoint's shell
  // won the cold-load race; predicts degraded modal surfaces this session.
  // Bounded and non-sensitive (two booleans).
  try {
    const win = container.ownerDocument?.defaultView as
      | (Window & { __tabsterInstance?: object; __C3_TABSTER_PROBE?: object })
      | null
      | undefined;
    if (win) {
      const existing = win.__tabsterInstance;
      win.__C3_TABSTER_PROBE = {
        preExisting: !!existing,
        foreign: !!existing && !('attrHandlers' in existing),
        at: new Date().toISOString(),
      };
    }
  } catch {
    /* diagnostics must never affect mounting */
  }

  const hostContext = {
  ...defaultHostContext,
  ...(runtime?.context ?? {}),
};

  const existingRoot = roots.get(container);

  if (existingRoot) {
    existingRoot.unmount();
  }

  const root = createRoot(container);
  roots.set(container, root);

  root.render(
    <React.StrictMode>
      <ErrorBoundary
        onError={(error) =>
          runtime?.onRuntimeError?.(error.name, error.message)
        }
      >
        <HostContextProvider value={hostContext}>
          {hostContext.dataSourceMode === 'sharepoint'
            ? <SharePointHost />
            : <LocalHost />}
        </HostContextProvider>
      </ErrorBoundary>
      <FirstCommitSignal onFirstCommit={runtime?.onFirstCommit} />
    </React.StrictMode>,
  );
};

export const unmountC3 = (container: HTMLElement): void => {
  const root = roots.get(container);

  if (!root) return;

  root.unmount();
  roots.delete(container);
};

export const runtime: C3Runtime = {
  mount: mountC3,
  unmount: unmountC3,
};
