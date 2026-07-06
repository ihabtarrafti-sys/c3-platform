import React from 'react';
import ReactDOM from 'react-dom/client';
import { FluentProvider } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { NotificationProvider, SessionProvider } from './session';
import { c3LightTheme } from './theme/c3Theme';
import './theme/c3-tokens.css';

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
