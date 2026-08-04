import { useEffect, useRef, type ReactNode } from 'react';
import { useSession, type MembershipRelayState } from '../session';
import { AuthScreen } from '../components/AuthScreen';

/**
 * Deliberate sign-in screen for the Entra (staging/production) build —
 * signature screen 01 voice. Button-only Microsoft sign-in: Entra is the one
 * live route, so it is the one route shown (truthfulness boundary — no
 * designed-target routes appear in the product). Unauthenticated access to a
 * protected route lands here with the intended deep link preserved through
 * the redirect state.
 */
export function EntraSignIn({ intendedPath }: { intendedPath?: string }) {
  const { signIn, authNotice } = useSession();
  return (
    <AuthScreen>
      <p className="fd-eyebrow">Sign in</p>
      <h1 className="fd-h1">Sign in to find your place.</h1>
      <p className="fd-support">Microsoft verifies your organisation account. C3 checks your membership after sign-in.</p>
      <button
        type="button"
        className="fd-action fd-action--primary fd-action--entra"
        data-testid="entra-signin"
        onClick={() => void signIn(intendedPath)}
      >
        <span className="fd-mswindow" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>Continue with Microsoft</span>
      </button>
      <p className="fd-note">Signing in does not create C3 access. Membership is confirmed separately.</p>
      <div aria-live="polite">
        {authNotice ? (
          <p className="fd-notice" data-testid="auth-notice">
            Last attempt: {authNotice}
          </p>
        ) : null}
      </div>
    </AuthScreen>
  );
}

/**
 * Truthful boundary for a provider-valid identity whose membership has not
 * opened product routes. A named 403, an unreliable read, and a confirmed
 * handoff remain visibly different here.
 */
export interface SeatRelayProps {
  identity: string;
  state: MembershipRelayState;
  onCheck: () => void;
  onEnter: () => void;
  onSignOut: () => void;
}

function SeatSymbol({ state }: { state: MembershipRelayState['kind'] }) {
  if (state === 'checking') {
    return (
      <div className="fd-symbol" aria-hidden="true">
        <span className="fd-symbol__orbit" />
        <span className="fd-symbol__center" />
      </div>
    );
  }
  if (state === 'ambiguous') {
    return (
      <div className="fd-symbol fd-symbol--ambiguous" aria-hidden="true">
        <span className="fd-symbol__door fd-symbol__door--left" />
        <span className="fd-symbol__door fd-symbol__door--right" />
        <span className="fd-symbol__fork" />
      </div>
    );
  }
  return (
    <div className="fd-symbol" aria-hidden="true">
      <span className="fd-symbol__door" />
      {state === 'confirmed' ? (
        <span className="fd-symbol__keyline" />
      ) : state === 'verification_failed' ? (
        <span className="fd-symbol__question">?</span>
      ) : (
        <span className="fd-symbol__heart">♡</span>
      )}
    </div>
  );
}

const SEAT_STATE_TEST_IDS: Record<MembershipRelayState['kind'], string> = {
  checking: 'seat-state-checking',
  not_seated: 'seat-state-not-seated',
  verification_failed: 'seat-state-verification-failed',
  ambiguous: 'seat-state-ambiguous',
  confirmed: 'seat-state-confirmed',
};

function SeatState({ state, children }: { state: MembershipRelayState['kind']; children: ReactNode }) {
  return (
    <div
      className={`fd-state fd-state--${state.replace('_', '-')}`}
      data-testid={SEAT_STATE_TEST_IDS[state]}
      aria-live="polite"
      aria-atomic="true"
      aria-busy={state === 'checking' ? true : undefined}
    >
      {children}
    </div>
  );
}

/**
 * The product half of the seating relay. Each server answer owns a distinct
 * surface; in particular, "not seated", "could not verify", and "known more
 * than once" can never collapse into the same refusal.
 */
export function SeatRelay({ identity, state, onCheck, onEnter, onSignOut }: SeatRelayProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Rechecks replace the button that held keyboard focus. Put focus on the
  // named result instead of dropping it onto the document body; the stable
  // SeatState live region also announces the changed answer atomically.
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.kind]);

  if (state.kind === 'checking') {
    return (
      <SeatState state={state.kind}>
        <SeatSymbol state={state.kind} />
        <p className="fd-eyebrow">Membership check</p>
        <h1 className="fd-h1" ref={headingRef} tabIndex={-1}>Looking for your place.</h1>
        <p className="fd-support">{identity} remains signed in while C3 checks the membership register once.</p>
        <div className="fd-action-row">
          <button type="button" className="fd-action fd-action--primary" data-testid="seat-check" disabled>
            Checking…
          </button>
          <button type="button" className="fd-action fd-action--quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </SeatState>
    );
  }

  if (state.kind === 'not_seated') {
    return (
      <SeatState state={state.kind}>
        <SeatSymbol state={state.kind} />
        <p className="fd-eyebrow">Membership checked</p>
        <h1 className="fd-h1" ref={headingRef} tabIndex={-1}>No place here yet.</h1>
        <p className="fd-support" data-testid="not-provisioned">
          {identity} is signed in. C3 checked the membership register and did not find an active place for this identity.
          If someone has just seated you, check again.
        </p>
        <div className="fd-action-row">
          <button type="button" className="fd-action fd-action--primary" onClick={onCheck} data-testid="seat-check">
            Check again
          </button>
          <button type="button" className="fd-action fd-action--quiet" onClick={onSignOut} data-testid="not-provisioned-signout">
            Sign out
          </button>
        </div>
      </SeatState>
    );
  }

  if (state.kind === 'verification_failed') {
    return (
      <SeatState state={state.kind}>
        <SeatSymbol state={state.kind} />
        <p className="fd-eyebrow">Membership not verified</p>
        <h1 className="fd-h1" ref={headingRef} tabIndex={-1}>We couldn’t verify your place.</h1>
        <p className="fd-support">
          C3 did not get a reliable answer from the membership register. {identity} is still signed in; this is not a
          finding that you have no place.
        </p>
        <p className="fd-note">Last check: {state.message}</p>
        <div className="fd-action-row">
          <button type="button" className="fd-action fd-action--primary" onClick={onCheck} data-testid="seat-check">
            Check again
          </button>
          <button type="button" className="fd-action fd-action--quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </SeatState>
    );
  }

  if (state.kind === 'ambiguous') {
    return (
      <SeatState state={state.kind}>
        <SeatSymbol state={state.kind} />
        <p className="fd-eyebrow">Membership needs resolution</p>
        <h1 className="fd-h1" ref={headingRef} tabIndex={-1}>C3 knows you in more than one place.</h1>
        <p className="fd-support">
          The membership register links {identity} to more than one organisation. C3 will not choose one on your behalf,
          so neither place can open until the platform owner resolves the ambiguity.
        </p>
        <div className="fd-action-row">
          <button type="button" className="fd-action fd-action--primary" onClick={onCheck} data-testid="seat-check">
            Check after it’s resolved
          </button>
          <button type="button" className="fd-action fd-action--quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </SeatState>
    );
  }

  return (
    <SeatState state={state.kind}>
      <SeatSymbol state={state.kind} />
      <p className="fd-eyebrow">Membership confirmed</p>
      <h1 className="fd-h1" ref={headingRef} tabIndex={-1}>Your place is ready.</h1>
      <p className="fd-support">
        {state.me.displayName}, C3 confirmed your place in {state.me.tenantSlug} as {state.me.role}. The page you asked for
        is still waiting.
      </p>
      <div className="fd-action-row">
        <button type="button" className="fd-action fd-action--primary" onClick={onEnter} data-testid="seat-enter">
          Enter C3
        </button>
        <button type="button" className="fd-action fd-action--quiet" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </SeatState>
  );
}

export function AccessNotProvisioned({ identity, onSignOut }: { identity: string; onSignOut: () => void }) {
  const { membershipRelay, checkSeat, enterSeat } = useSession();
  return (
    <AuthScreen label="Membership status">
      <SeatRelay
        identity={identity}
        state={membershipRelay}
        onCheck={() => void checkSeat()}
        onEnter={enterSeat}
        onSignOut={onSignOut}
      />
    </AuthScreen>
  );
}
