import { useSession } from '../session';
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
      <h1 className="fd-h1">Come in. Your place is ready.</h1>
      <p className="fd-support">Sign in with your organisation account to continue.</p>
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
      <p className="fd-note">Microsoft Entra · Live now. C3 access is by invitation.</p>
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
 * Truthful screen for a valid identity with no C3 membership. A neutral
 * boundary, not an error (403 is authorization, not failure — Part A.12).
 * "Access denied" and "error" stay distinct: this identity reached C3 but
 * doesn't have a place yet, and the copy never accuses the account.
 */
export function AccessNotProvisioned({ identity, onSignOut }: { identity: string; onSignOut: () => void }) {
  return (
    <AuthScreen>
      <div className="fd-symbol" aria-hidden="true">
        <span className="fd-symbol__door" />
        <span className="fd-symbol__heart">♡</span>
      </div>
      <p className="fd-eyebrow">We couldn’t sign you in</p>
      <h1 className="fd-h1">No place here yet.</h1>
      <p className="fd-support" data-testid="not-provisioned">
        {identity} is signed in, but this account doesn’t have a place in C3 yet. Access is by invitation — contact the
        platform owner.
      </p>
      <button type="button" className="fd-action fd-action--quiet" onClick={onSignOut} data-testid="not-provisioned-signout">
        Sign out
      </button>
    </AuthScreen>
  );
}
