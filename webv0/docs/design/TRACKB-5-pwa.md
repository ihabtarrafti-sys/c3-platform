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

### Deploy gotcha — one-time SW edge-cache purge

On the first deploy that introduced `/sw.js`, staging surfaced
`The script has an unsupported MIME type ('text/html')` on registration. The
code was correct — the direct `*.pages.dev` deployment served `/sw.js` as
`application/javascript` with `no-cache`. The custom domain served a stale
`text/html` (`cf-cache-status: HIT`, `max-age=14400`).

Cause: `/sw.js` was a brand-new top-level path. During the alias-propagation
window (the `staging.c3hq.org` alias still pointing at the previous deployment,
which had no `/sw.js`), a request hit the `/* → /index.html 200` SPA fallback
and got `index.html` back; Cloudflare's zone Browser-Cache-TTL (4h) cached that
HTML at the edge keyed on `/sw.js`. The alias then flipped to the new
deployment, but the poisoned edge entry lived on.

This is **one-time**: `/sw.js` now exists in every deployment and carries
`no-cache`, so the edge cannot re-cache HTML for it. Fix options:
- **Self-heal**: the stale entry expires in <4h; nothing breaks meanwhile (the
  SW is a progressive enhancement — the app is fully functional without it).
- **Immediate**: purge the one URL at the edge — Cloudflare dashboard → zone
  `c3hq.org` → Caching → Configuration → Purge Cache → Custom Purge → by URL →
  `https://staging.c3hq.org/sw.js` (and `/manifest.webmanifest` for hygiene).

Lesson for future top-level static additions (not under `/assets/*`): expect a
first-deploy edge-cache purge, or give the new file a `no-cache` header so a
propagation-lag fallback isn't cached.

**SW-update propagation:** the zone treats `.js` as a default-cached extension
and forces `max-age=14400` on `/sw.js` at the edge (overriding the `_headers`
`no-cache` — the `.webmanifest` is honoured because it is not a default-cached
extension). So a *changed* `sw.js` propagates within ~4h at the edge, or purge
`https://staging.c3hq.org/sw.js` to make it immediate. This does not affect page
freshness: navigations are network-first, so a stale SW still serves fresh
content online, and hashed `/assets/*` are immutable. Verified live
2026-07-11: registered + activated, `controller = /sw.js`, cache `c3-shell-v1`
holds `/` + manifest + icons (offline shell primed).
