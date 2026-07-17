import type { ReactNode } from 'react';
import { ENV_LABEL, SHOW_ENV } from '../theme/env';
import '../theme/front-door.css';

/**
 * Pre-authentication surface — signature screen 01, "the front door"
 * (The Long Table · Afterglow + Blue Hour, re-skin chapter). The Gather room
 * composition carries the warmth; the opaque routing panel carries the
 * product. There is no navigation and no domain action here, and no glass:
 * authentication content needs an opaque, stable reading surface.
 *
 * The Gather artwork is the approved brand asset, vendored byte-identical
 * from c3-brand — never redrawn, recolored, or morphed.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="front-door-screen">
      <div className="fd-ambient" aria-hidden="true">
        <span className="fd-ambient__shape fd-ambient__shape--near" />
        <span className="fd-ambient__shape fd-ambient__shape--far" />
      </div>

      <header className="fd-header">
        <div className="fd-lockup" role="img" aria-label="C3">
          <span className="fd-lockup__mark" aria-hidden="true">
            <img
              className="fd-lockup__image fd-lockup__image--dark"
              src="/brand/gather-lockup-horizontal-dark.svg"
              alt=""
              width="196"
              height="62"
            />
            <img
              className="fd-lockup__image fd-lockup__image--light"
              src="/brand/gather-lockup-horizontal-light.svg"
              alt=""
              width="196"
              height="62"
            />
          </span>
        </div>
        {SHOW_ENV && (
          <span className="fd-env" data-testid="env-badge">
            {ENV_LABEL}
          </span>
        )}
      </header>

      <main className="fd-main">
        <div className="fd-welcome" aria-hidden="true">
          <div className="fd-room">
            <span className="fd-room__halo" />
            <span className="fd-room__seat fd-room__seat--north" />
            <span className="fd-room__seat fd-room__seat--west" />
            <span className="fd-room__seat fd-room__seat--east" />
            <span className="fd-room__table" />
            <span className="fd-room__hearth" />
          </div>
          <div className="fd-welcome-mark">
            <img
              className="fd-welcome-mark__image fd-welcome-mark__image--dark"
              src="/brand/gather-balanced.svg"
              alt=""
              width="82"
              height="62"
            />
            <img
              className="fd-welcome-mark__image fd-welcome-mark__image--light"
              src="/brand/gather-on-light.svg"
              alt=""
              width="82"
              height="62"
            />
          </div>
        </div>

        <section className="fd-panel" aria-label="Sign in">
          {children}
          <p className="fd-help">
            Need help? <a href="mailto:team@c3hq.org">team@c3hq.org</a>
          </p>
        </section>
      </main>
    </div>
  );
}
