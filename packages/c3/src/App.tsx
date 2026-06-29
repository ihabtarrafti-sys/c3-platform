import { FluentProvider, Toaster } from '@fluentui/react-components';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AppConfig } from './config/AppConfig';
import { AppProvider } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
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
        <Toaster toasterId={C3_TOASTER_ID} position="top-end" />
      </QueryClientProvider>
    </FluentProvider>
  );
};

export default C3App;
