import React from 'react';
import ReactDOM from 'react-dom/client';
import { FluentProvider } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { NotificationProvider, SessionProvider } from './session';
import { c3DarkTheme, c3LightTheme } from './theme/c3Theme';
import { ThemeModeProvider, useThemeMode } from './theme/mode';
import './theme/fonts.css';
// Strategy-B (re-skin chapter closed): the LOCKED identity tokens (Afterglow +
// Blue Hour v1.2.0, vendored byte-identical + sha-pinned) are the sole value
// source; c3-app.css carries only the app's OWN primitives (mono type, motion
// clock, shell geometry, derived glass tiers) plus the body/keyframe/reduced
// contracts. The Phase-0 bridge and the S47 token file are retired — every
// component speaks the brand vocabulary directly.
import './theme/brand/c3.tokens.css';
// Tablework v1.3.0 (brand-v1.3.0/6036fa3): the ADDITIVE --c3-tw-* component
// aliases, vendored sha-pinned (identityTokens.test). Import AFTER the core
// (the contract's fixed order); the aliases inherit both themes.
import './theme/brand/tablework.tokens.css';
import './theme/c3-app.css';

// Build marker (real runtime statement so it survives minification and changes
// the emitted chunk hash). This forces a fresh asset URL so Cloudflare serves
// the bundle untransformed under the `no-transform` header — a prior
// immutable-cached copy had been re-minified at the edge and failed to execute.
(window as unknown as { __C3_BUILD?: string }).__C3_BUILD = '2026-07-06-b3c';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

/** Inside ThemeModeProvider so the Fluent theme follows the E mode toggle. */
function Root() {
  const { mode } = useThemeMode();
  return (
    <FluentProvider theme={mode === 'dark' ? c3DarkTheme : c3LightTheme} style={{ background: 'transparent' }}>
      <QueryClientProvider client={queryClient}>
        <NotificationProvider>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </FluentProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <Root />
    </ThemeModeProvider>
  </React.StrictMode>,
);

// Track B5: register the PWA service worker (installability + offline shell).
// Production only — the dev server serves modules the SW must not intercept.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW registration is a progressive enhancement — never block the app */
    });
  });
}
