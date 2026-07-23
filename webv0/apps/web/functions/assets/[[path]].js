/**
 * WEB-CACHE-01 structural fix: /assets/* is fingerprinted build output — a
 * miss must be a REAL 404, never the SPA fallback. Without this, the
 * `/* /index.html 200` rule serves index.html under a stale asset URL and
 * _headers stamps it public+immutable for a year (the edge-poisoning
 * amplifier; _redirects cannot express a 404 rewrite — platform limit).
 *
 * ASSETS.fetch applies the project's redirect+header rules, so a miss comes
 * back as the SPA shell: text/html under /assets/ is the honest discriminator
 * (real assets are js/css/fonts/images, never html). Hits pass through with
 * their _headers intact; the 404 is no-store so no cache ever keeps it.
 *
 * Deploy note: wrangler auto-compiles this functions/ directory when
 * `wrangler pages deploy dist` runs from apps/web/ — the ceremony's 404
 * probe (a real 404 for /assets/index-DOESNOTEXIST.js) is the proof it
 * actually shipped; a silently-dropped function would leave the fallback.
 */
export async function onRequest(context) {
  const res = await context.env.ASSETS.fetch(context.request);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  return res;
}
