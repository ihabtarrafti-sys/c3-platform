import { Button, Card, Text, Title2, makeStyles, tokens } from '@fluentui/react-components';
import { useSession } from '../session';

const useStyles = makeStyles({
  wrap: { display: 'flex', justifyContent: 'center', padding: '64px 16px' },
  card: { display: 'flex', flexDirection: 'column', gap: '14px', width: '360px', padding: '24px' },
  hint: { color: tokens.colorNeutralForeground3 },
});

/**
 * Deliberate sign-in screen for the Entra (staging/production) build.
 * Unauthenticated access to a protected route lands here with the intended
 * deep link preserved through the redirect state.
 */
export function EntraSignIn({ intendedPath }: { intendedPath?: string }) {
  const s = useStyles();
  const { signIn } = useSession();
  return (
    <div className={s.wrap}>
      <Card className={s.card}>
        <Title2>C3</Title2>
        <Text className={s.hint}>Sign in with your organisation account to continue.</Text>
        <Button appearance="primary" data-testid="entra-signin" onClick={() => void signIn(intendedPath)}>
          Sign in with Microsoft
        </Button>
      </Card>
    </div>
  );
}

/** Truthful screen for a valid identity with no C3 membership. */
export function AccessNotProvisioned({ identity, onSignOut }: { identity: string; onSignOut: () => void }) {
  const s = useStyles();
  return (
    <div className={s.wrap}>
      <Card className={s.card}>
        <Title2>Access not provisioned</Title2>
        <Text data-testid="not-provisioned">
          {identity} is authenticated, but has not been provisioned for C3 access. Contact the platform owner.
        </Text>
        <Button appearance="secondary" onClick={onSignOut} data-testid="not-provisioned-signout">
          Sign out
        </Button>
      </Card>
    </div>
  );
}
