import { Button, Text, makeStyles } from '@fluentui/react-components';
import { useSession } from '../session';
import { AuthScreen } from '../components/AuthScreen';

const useStyles = makeStyles({
  heading: { fontSize: '18px', fontWeight: 600 },
  hint: { fontSize: '13px', color: 'var(--c3-ink-70)' },
  fullBtn: { width: '100%' },
  invite: { fontSize: '12.5px', color: 'var(--c3-ink-50)' },
  notice: { fontSize: '12.5px', color: 'var(--c3-status-blocked)' },
});

/**
 * Deliberate sign-in screen for the Entra (staging/production) build.
 * Button-only Microsoft sign-in (no email-first). Unauthenticated access to a
 * protected route lands here with the intended deep link preserved through the
 * redirect state.
 */
export function EntraSignIn({ intendedPath }: { intendedPath?: string }) {
  const s = useStyles();
  const { signIn, authNotice } = useSession();
  return (
    <AuthScreen>
      <div className={s.heading}>Sign in</div>
      <Text className={s.hint}>Sign in with your organisation account to continue.</Text>
      <Button appearance="primary" className={s.fullBtn} data-testid="entra-signin" onClick={() => void signIn(intendedPath)}>
        Sign in with Microsoft
      </Button>
      <Text className={s.invite}>C3 access is by invitation.</Text>
      <div aria-live="polite">
        {authNotice ? (
          <Text className={s.notice} data-testid="auth-notice">
            Last attempt: {authNotice}
          </Text>
        ) : null}
      </div>
    </AuthScreen>
  );
}

/**
 * Truthful screen for a valid identity with no C3 membership. A neutral
 * boundary, not an error (403 is authorization, not failure — Part A.12).
 */
export function AccessNotProvisioned({ identity, onSignOut }: { identity: string; onSignOut: () => void }) {
  const s = useStyles();
  return (
    <AuthScreen>
      <div className={s.heading}>Access not provisioned</div>
      <Text className={s.hint} data-testid="not-provisioned">
        {identity} is signed in, but this account isn’t provisioned for C3 access. Access is by invitation — contact the
        platform owner.
      </Text>
      <Button appearance="secondary" onClick={onSignOut} data-testid="not-provisioned-signout">
        Sign out
      </Button>
    </AuthScreen>
  );
}
