import * as React from 'react';
import { FluentProvider, Toaster, useModalAttributes } from '@fluentui/react-components';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AppConfig } from './config/AppConfig';
import { AppProvider } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
import { NotificationProvider } from './components/NotificationRegion';
import { ToasterGuard } from './components/ToasterGuard';
import { c3CSSVars, c3Theme } from './tokens/c3Tokens';
import { queryClient } from './queryClient';
import { C3_TOASTER_ID } from './hooks/useToast';

/**
 * TabsterInitializer — TD-33 (Sprint 32).
 *
 * Fluent v9 modal surfaces (OverlayDrawer / Dialog) run `getModalizer(tabster)`
 * on mount, which does `tabster.core.attrHandlers.set("modalizer", …)`. On a
 * COLD session where a modal is the first Tabster consumer, that path executes
 * before the Tabster modalizer machinery is initialized and throws "Cannot read
 * properties of undefined (reading 'set')", crashing the first modal-bearing
 * screen (e.g. People → AddPersonPanel). Warm sessions never hit it because
 * earlier components already initialized the modalizer.
 *
 * `useModalAttributes()` is the PUBLIC `@fluentui/react-components` hook that
 * modals themselves use; it runs `initTabsterModules` (`getModalizer` +
 * `getRestorer`) at mount via `useTabster`. Calling it ONCE at the
 * FluentProvider root pre-registers the modalizer during app init, so
 * `getModalizer` is idempotent thereafter and every real modal open skips the
 * failing registration. No private/unsupported Tabster API, no provider
 * replacement, no node_modules patch. Paired with per-panel deferred mounting
 * (useDeferredMount) as defence in depth.
 */
const TabsterInitializer = (): null => {
  // trapFocus:true ensures the modalizer branch of initialization runs.
  useModalAttributes({ trapFocus: true });
  return null;
};

/**
 * TabsterInitializerBoundary — TD-34 root cause containment (Sprint 33).
 *
 * HOSTED-PROVEN cause of the normal-use cold-load blank: SharePoint's page
 * shell creates its OWN (older) tabster instance on window.__tabsterInstance.
 * tabster 8.x instance acquisition ADOPTS any existing instance without a
 * version check, so when the C3 runtime chunk loses the cold-load race, our
 * `useModalAttributes` receives SP's foreign instance, which has no
 * `attrHandlers` → TypeError "Cannot read properties of undefined (reading
 * 'set')" in a layout effect. Since S32 placed TabsterInitializer at app
 * init, that race-lost crash killed the ENTIRE first render (React 18
 * unmounts the tree → attached root, zero DOM — TD-34's exact signature).
 * Warm loads win the race (cached chunk runs first, our instance is created
 * before SP's) which is why Edit→Cancel "fixed" it.
 *
 * Tabster pre-registration is an OPTIMIZATION (TD-33 defence) and must never
 * be fatal: this boundary silently absorbs its failure so the application
 * always renders. On race-lost sessions Fluent modal surfaces may still fail
 * bounded at the screen-level ErrorBoundary (pre-TD-33 exposure, unchanged);
 * the real interop fix is tracked as follow-up work in the register.
 */
class TabsterInitializerBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  public state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error): void {
    // Non-fatal by design — sanitized log only.
    console.warn(
      `[C3] Tabster pre-registration failed (non-fatal; foreign host tabster instance): ${error.name}: ${error.message}`,
    );
  }
  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export const C3App = ({ config }: { config: AppConfig }) => {
  return (
    <FluentProvider theme={c3Theme} style={c3CSSVars}>
      <TabsterInitializerBoundary>
        <TabsterInitializer />
      </TabsterInitializerBoundary>
      <QueryClientProvider client={queryClient}>
        <AppProvider config={config}>
          {/*
            NotificationProvider is ALWAYS mounted. It is the Toaster-independent
            inline feedback channel that useToast() routes to when the Fluent
            Toaster is disabled (SPFx-hosted). When the Toaster is enabled it
            simply stays idle — Mock/local toast behaviour is unchanged.
            Sprint 33 (RISK-1): fixes silent governed-write feedback hosted.
          */}
          <NotificationProvider>
            <AppShell />
          </NotificationProvider>
        </AppProvider>
        {/*
          Toaster is omitted when the host sets disableToasts=true (e.g. SPFx
          workbench) because Fluent UI v9 Toaster registration fails in that
          environment. ToasterGuard is kept as defence-in-depth for any host
          that mounts the Toaster but encounters a context timing issue.
          Sprint 15 mitigation — root cause to be resolved in Sprint 16.
        */}
        {!config.disableToasts && (
          <ToasterGuard>
            <Toaster toasterId={C3_TOASTER_ID} position="top-end" />
          </ToasterGuard>
        )}
      </QueryClientProvider>
    </FluentProvider>
  );
};

export default C3App;
