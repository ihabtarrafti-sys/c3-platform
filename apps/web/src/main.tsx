import React from 'react';
import ReactDOM from 'react-dom/client';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { NotificationProvider, SessionProvider } from './session';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FluentProvider theme={webLightTheme}>
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
