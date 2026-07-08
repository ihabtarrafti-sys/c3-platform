import React from 'react';
import ReactDOM from 'react-dom/client';
import { FluentProvider } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { NotificationProvider, SessionProvider } from './session';
import { c3LightTheme } from './theme/c3Theme';
import './theme/fonts.css';
import './theme/c3-tokens.css';

// Build marker (real runtime statement so it survives minification and changes
// the emitted chunk hash). This forces a fresh asset URL so Cloudflare serves
// the bundle untransformed under the `no-transform` header — a prior
// immutable-cached copy had been re-minified at the edge and failed to execute.
(window as unknown as { __C3_BUILD?: string }).__C3_BUILD = '2026-07-06-b3c';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FluentProvider theme={c3LightTheme}>
      <QueryClientProvider client={queryClient}>
        <NotificationProvider>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </FluentProvider>
  </React.StrictMode>,
);
