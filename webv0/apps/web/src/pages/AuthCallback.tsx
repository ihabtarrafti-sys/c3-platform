import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner, Text, makeStyles } from '@fluentui/react-components';
import { authClient } from '../auth';
import { useSession } from '../session';
import { AuthScreen } from '../components/AuthScreen';

const useStyles = makeStyles({
  row: { display: 'flex', alignItems: 'center', columnGap: '10px' },
  heading: { fontSize: '18px', fontWeight: 600 },
  error: { fontSize: '13px', color: 'var(--c3-status-blocked)' },
});

/** Safe internal-path check: only same-origin relative paths are restored. */
export function safeInternalPath(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/people';
  return candidate;
}

/**
 * /auth/callback — completes the Entra authorization-code (PKCE) redirect and
 * restores the intended deep link carried through the state parameter. Renders
 * on the pre-auth AuthScreen (it sits outside the protected shell).
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

  return (
    <AuthScreen>
      {error ? (
        <div aria-live="assertive">
          <div className={s.heading}>Sign-in didn’t complete</div>
          <Text className={s.error} data-testid="callback-error">
            {error}
          </Text>
        </div>
      ) : (
        <div className={s.row} data-testid="callback-progress">
          <Spinner size="tiny" />
          <Text>Completing sign-in…</Text>
        </div>
      )}
    </AuthScreen>
  );
}
