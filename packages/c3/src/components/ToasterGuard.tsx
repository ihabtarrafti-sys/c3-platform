import React from 'react';

/**
 * ToasterGuard — Error boundary for the Fluent UI v9 <Toaster>.
 *
 * In the SPFx-hosted workbench, Fluent UI v9's Toaster fails to register
 * itself because the ToasterStoreContext (provided by FluentProvider) is
 * not committed at the point where the Toaster's registration effect runs.
 * This is an SPFx workbench / Fluent UI v9.74+ timing issue — it does not
 * occur in the standalone Vite dev server.
 *
 * The Toaster crash is a useLayoutEffect error, which React 18 propagates
 * to the nearest error boundary. This boundary catches it silently and
 * renders null (no toast container — toasts are silently lost). The rest
 * of the C3 app tree is completely unaffected.
 *
 * Sprint 15 impact: none. No S15 validation step dispatches toasts.
 * Write-path panels (AddCredentialPanel, CreateAmendmentPanel,
 * StartJourneyPanel) are Sprint 16+ scope.
 *
 * Sprint 16 action: investigate FluentProvider context timing in SPFx and
 * remove this guard once the root cause is fixed upstream.
 */

interface ToasterGuardState {
  hasError: boolean;
}

export class ToasterGuard extends React.Component<
  React.PropsWithChildren,
  ToasterGuardState
> {
  state: ToasterGuardState = { hasError: false };

  static getDerivedStateFromError(): ToasterGuardState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.warn(
      '[C3/Toaster] Toaster failed to mount in the SPFx-hosted environment. ' +
      'Toast notifications are disabled for this session. ' +
      'Root cause: FluentProvider ToasterStoreContext timing in SPFx workbench. ' +
      `Error: ${error.message}`,
    );
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      // Render nothing — toasts are silently suppressed.
      return null;
    }
    return this.props.children;
  }
}
