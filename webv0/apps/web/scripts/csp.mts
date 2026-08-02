/**
 * csp.mts — the ONE place the production Content-Security-Policy is written,
 * and the only place the API origin enters it.
 *
 * ⚖️ WHY THIS EXISTS (P0, 2026-08-02). `public/_headers` hardcoded
 * `connect-src 'self' https://api.staging.c3hq.org …`. When production stood up
 * at `app.c3hq.org` it shipped that same file, so **production's web app was
 * forbidden to reach production's API and permitted to reach STAGING's.** Every
 * browser fetch was refused before it left the tab; and because a CSP block is
 * not an HTTP response it is not an `ApiError`, so it fell into the transient
 * branch and the sign-in screen said only "The service could not be reached."
 *
 * ⛔ `curl` could never have caught it — **only a browser enforces CSP**, which
 * is why every check against `api.c3hq.org` passed while the app was broken.
 *
 * This is the second defect of one class in twelve hours (the first: an unset
 * `VITE_ENV_LABEL` rendering a STAGING badge on production). Both are *a value
 * that should be DERIVED from the environment, written down by hand instead*.
 * So the origin is no longer written down anywhere: it is derived from the
 * build's own `VITE_API_BASE_URL`, which is the same value the app uses to make
 * the requests this policy has to permit. **One value, one source — the policy
 * and the client cannot disagree about where the API is.**
 */

/** The API origin the built app will actually call, normalised to an origin. */
export function apiOriginFrom(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`CSP refuses a non-https API origin: ${apiBaseUrl}`);
  }
  return url.origin;
}

/**
 * The full policy. `connect-src` permits exactly this build's API origin — not a
 * list of every environment's, which is how production came to permit staging.
 */
export function buildCsp(apiOrigin: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} https://login.microsoftonline.com`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * The whole Cloudflare Pages `_headers` file.
 *
 * ⚠️ `public/_headers` NO LONGER EXISTS. It was deleted deliberately: a static
 * file next to a generator is a second source of truth, and the failure mode is
 * that a build which skips generation silently ships the stale one. Generating
 * the entire file means a build either emits a correct policy or emits none —
 * and `emitHeaders.mts` refuses to run without an API origin, so "none" cannot
 * happen quietly either.
 */
export function buildHeadersFile(apiOrigin: string): string {
  return `# GENERATED — do not edit. Source: apps/web/scripts/csp.mts (emitted by emitHeaders.mts).
# connect-src is DERIVED from this build's VITE_API_BASE_URL, so each
# environment permits exactly its own API and no other. Editing this file by
# hand is how production came to permit staging's API and forbid its own.
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cache-Control: no-transform
  Content-Security-Policy: ${buildCsp(apiOrigin)}

/assets/*
  Cache-Control: public, max-age=31536000, immutable, no-transform

/index.html
  Cache-Control: no-cache, no-transform

# Track B5 PWA: the service worker must revalidate so a new deploy propagates;
# the manifest likewise. Icons are content-stable and may be cached.
#
# ⚠️ THIS RULE DOES NOT REACH /sw.js AT ALL, AND A PURGE WILL NOT FIX IT.
# MEASURED on both environments 2026-08-02:
#     /sw.js                cf-cache-status: REVALIDATED  max-age=14400
#     /manifest.webmanifest cf-cache-status: DYNAMIC      no-cache (this rule, applied)
# The manifest carries the IDENTICAL rule from this same block and works, so
# _headers is fine. The difference is that Cloudflare edge-caches by FILE
# EXTENSION: `.js` is cached by default, `.webmanifest` is not. /sw.js is served
# from a stored edge object whose own 4h TTL was baked in when it was cached, and
# REVALIDATED hits keep those stored headers — so this rule never governs it.
# ⇒ A manual purge is TEMPORARY: the next request re-caches it by extension.
# The fix is a Cloudflare CACHE RULE for /sw.js (bypass cache / respect origin),
# which is a zone-level action, not a repo change.
# Two earlier explanations were tested and FALSIFIED: "a new domain's first
# deploy during alias propagation" (staging shows it too, and staging is neither
# new nor unpurged) and "a zone-wide Browser Cache TTL override" (/index.html and
# the manifest keep their declared headers). Do not restore either, and do not
# restore a claim that this rule prevents anything for /sw.js.
/sw.js
  Cache-Control: no-cache, no-transform
/manifest.webmanifest
  Cache-Control: no-cache, no-transform
/icons/*
  Cache-Control: public, max-age=604800, no-transform
`;
}
