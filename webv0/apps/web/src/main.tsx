import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { NotificationProvider, SessionProvider } from './session';
import { ThemeModeProvider } from './theme/mode';
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

/**
 * Wave 4 Phase 3 — the Tablework pivot's last Fluent removal.
 *
 * `FluentProvider` used to wrap this tree and no longer does. It contributed
 * exactly three things, each independently accounted for before removal:
 *
 *   1. It emitted every theme slot as a CSS custom property on its own div.
 *      NOTHING reads those — a scan for Fluent-shaped `var(--colorX/fontX/
 *      durationX/curveX/spacingX/borderRadiusX/strokeWidthX/shadowN)` over the
 *      whole of src/ returns zero, on an instrument proven able to find them.
 *      The app speaks `--c3-*` (the locked brand tokens) exclusively.
 *   2. It set font-family and color on that div. `body` already sets the SAME
 *      two values (--c3-font-family-human / --c3-ink-default), so the cascade
 *      is unchanged.
 *   3. It set a background, which this call site was already overriding to
 *      `transparent` so the body's ambient gradient could show through.
 *
 * The mode toggle never rode Fluent: ThemeModeProvider writes
 * `data-c3-theme` on documentElement and the brand token file keys on it, so
 * light/dark is untouched by this removal. It stays exactly where it was —
 * only Root's consumption of `mode` goes, since nothing here needs it now.
 *
 * One div leaves the DOM. Nothing depended on it as a box: `#root` is the
 * height:100% element and `.tw-root` sizes itself against the viewport
 * (min-height: 100dvh), so neither anchored to the intermediate.
 */
function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* SessionProvider OUTSIDE so notices can clear on actor/tenant change
          (UX11) — a notice minted under one identity must never survive into
          another. SessionProvider does not consume notices. */}
      <SessionProvider>
        <NotificationProvider>
          <RouterProvider router={router} />
        </NotificationProvider>
      </SessionProvider>
    </QueryClientProvider>
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
