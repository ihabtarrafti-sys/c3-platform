import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authClient } from '../auth';
import { useSession } from '../session';
import { AuthScreen } from '../components/AuthScreen';

/** Safe internal-path check: only same-origin relative paths are restored. */
export function safeInternalPath(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/people';
  return candidate;
}

/**
 * /auth/callback — completes the Entra authorization-code (PKCE) redirect and
 * restores the intended deep link carried through the state parameter.
 * Signature-01 states: the return leg of the sign-in handoff (calm orbit,
 * polite status), or the error voice — which never accuses the account and
 * stays distinct from access-denied (AccessNotProvisioned owns that).
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await authClient.completeRedirect();
        await refresh();
        navigate(safeInternalPath(result?.intendedPath), { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sign-in could not be completed.');
      }
    })();
  }, [navigate, refresh]);

  return (
    <AuthScreen>
      {error ? (
        <div className="fd-state" aria-live="assertive">
          <div className="fd-symbol" aria-hidden="true">
            <span className="fd-symbol__door" />
            <span className="fd-symbol__keyline" />
          </div>
          <p className="fd-eyebrow">Something interrupted the route</p>
          <h1 className="fd-h1">The front door didn’t open.</h1>
          <p className="fd-support">This may be temporary; we haven’t confirmed an account problem.</p>
          <p className="fd-notice" data-testid="callback-error">
            {error}
          </p>
        </div>
      ) : (
        <div className="fd-state" data-testid="callback-progress" role="status" aria-live="polite">
          <div className="fd-symbol" aria-hidden="true">
            <span className="fd-symbol__orbit" />
            <span className="fd-symbol__center" />
          </div>
          <p className="fd-eyebrow">Sign-in handoff</p>
          <h1 className="fd-h1">Completing sign-in…</h1>
        </div>
      )}
    </AuthScreen>
  );
}
