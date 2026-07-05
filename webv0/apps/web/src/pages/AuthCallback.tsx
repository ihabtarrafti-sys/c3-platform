import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageBar, MessageBarBody, Spinner, makeStyles } from '@fluentui/react-components';
import { authClient } from '../auth';
import { useSession } from '../session';

const useStyles = makeStyles({ center: { display: 'flex', justifyContent: 'center', padding: '64px' } });

/** Safe internal-path check: only same-origin relative paths are restored. */
export function safeInternalPath(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/people';
  return candidate;
}

/**
 * /auth/callback — completes the Entra authorization-code (PKCE) redirect and
 * restores the intended deep link carried through the state parameter.
 */
export function AuthCallback() {
  const s = useStyles();
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

  if (error) {
    return (
      <MessageBar intent="error">
        <MessageBarBody data-testid="callback-error">Sign-in failed: {error}</MessageBarBody>
      </MessageBar>
    );
  }
  return (
    <div className={s.center}>
      <Spinner label="Completing sign-in..." />
    </div>
  );
}
