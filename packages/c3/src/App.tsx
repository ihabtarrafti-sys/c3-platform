import { FluentProvider, Toaster, useModalAttributes } from '@fluentui/react-components';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AppConfig } from './config/AppConfig';
import { AppProvider } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
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

export const C3App = ({ config }: { config: AppConfig }) => {
  return (
    <FluentProvider theme={c3Theme} style={c3CSSVars}>
      <TabsterInitializer />
      <QueryClientProvider client={queryClient}>
        <AppProvider config={config}>
          <AppShell />
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
