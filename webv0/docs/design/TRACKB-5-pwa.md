# Track B5 — PWA pass (installable)

**Status: BUILT (installable). Web-push deferred — see below.** Fifth Track B
item; pairs with B4. No migration, no backend.

Delivers the "first-class app feel" the owner asked for: C3 installs to a home
screen, opens in its own standalone window with the brand icon, and keeps
working (its shell) when the network drops — the ~90% of the native feel that
needs no store, no signing, no review train.

## What ships

- **manifest.webmanifest** — name, standalone display, brand theme (#0a0c14),
  and a PNG icon set (192 / 512 / 512-maskable / 180 apple-touch),
  rasterized from the brand symbol via playwright-core
  (`scripts/gen-pwa-icons.mjs`; re-run if the symbol changes — no image
  toolchain needed).
- **index.html** — manifest link, `theme-color`, apple-touch-icon, and the
  apple-mobile-web-app meta so iOS installs cleanly; `viewport-fit=cover`.
- **sw.js** — a deliberately conservative service worker: it NEVER touches
  cross-origin requests (the API is a different origin — auth/data always hit
  the network), navigations are network-first (a fresh deploy always wins
  online) falling back to the cached shell only offline, and same-origin
  hashed assets are cache-first. Registered only in a PROD build
  (`import.meta.env.PROD`), so the dev server / E2E stack is untouched.
- **_headers** — `no-cache` on `sw.js` + manifest so a deploy propagates; the
  existing CSP already permits same-origin worker/manifest (falls back to
  `default-src 'self'`).

## Deliberately deferred: WEB PUSH

Push (notifications reaching a closed app) is its own increment, mirroring how
H-02 signing was deferred then done — it needs a VAPID keypair (an owner env
step), a push-subscription table (migration), a subscribe endpoint, send
wiring on the notification-emit path, and the SW push/notificationclick
handlers, plus iOS 16.4+ quirks. Flagged as **B5-followup**; the installable
PWA + the in-app S10 bell already deliver the phone-first approval-inbox value.

## Verification

Build proves the assets land in `dist/` and the tags land in `index.html`; an
E2E asserts the manifest + icons ship (the SW is prod-only, so it is verified
on the live HTTPS staging with the browser: registration, `display-mode:
standalone`, offline shell).
