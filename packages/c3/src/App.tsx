import { FluentProvider, Toaster } from '@fluentui/react-components';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AppConfig } from './config/AppConfig';
import { AppProvider } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
import { ToasterGuard } from './components/ToasterGuard';
import { c3CSSVars, c3Theme } from './tokens/c3Tokens';
import { queryClient } from './queryClient';
import { C3_TOASTER_ID } from './hooks/useToast';

export const C3App = ({ config }: { config: AppConfig }) => {
  return (
    <FluentProvider theme={c3Theme} style={c3CSSVars}>
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
