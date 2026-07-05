import { FluentProvider, Toaster, useFocusFinders } from '@fluentui/react-components';
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
 * Fluent v9 modal surfaces (OverlayDrawer / Dialog) initialize a Tabster
 * *modalizer* on mount, which requires the Tabster *core* (`attrHandlers`) to
 * already exist. The core is created lazily by the first focus-management
 * consumer, so on a COLD session where a modal is the first such consumer the
 * modalizer runs before the core and throws "Cannot read properties of
 * undefined (reading 'set')" (crashing e.g. People → AddPersonPanel). Warm
 * sessions never hit it because earlier components created the core.
 *
 * This forces core creation once, at the FluentProvider root, before any modal
 * can mount. `useFocusFinders` is a PUBLIC `@fluentui/react-components` hook
 * that calls `useTabster()` → `createTabster(targetDocument)` internally — no
 * private/unsupported Tabster API, no provider replacement. Rendered as the
 * first child of FluentProvider so it runs within the provider's targetDocument
 * context. Paired with per-panel deferred mounting (useDeferredMount) as
 * defence in depth.
 */
const TabsterInitializer = (): null => {
  useFocusFinders();
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
