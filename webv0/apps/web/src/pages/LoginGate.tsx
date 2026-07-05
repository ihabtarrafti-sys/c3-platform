import { useState } from 'react';
import {
  Button,
  Card,
  Dropdown,
  Field,
  Input,
  Option,
  Text,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useSession, useNotify } from '../session';
import { ApiError } from '../api';

const useStyles = makeStyles({
  wrap: { display: 'flex', justifyContent: 'center', padding: '64px 16px' },
  card: { display: 'flex', flexDirection: 'column', gap: '14px', width: '360px', padding: '24px' },
  hint: { color: tokens.colorNeutralForeground3 },
});

const ROLES = ['owner', 'operations', 'legal', 'finance', 'hr', 'management', 'visitor'];

/**
 * Development sign-in (backed by the API's signed dev IdP). Not a production
 * surface — it exists so the People/AddPerson slice can be exercised as
 * different roles. Production uses Entra OIDC at the same boundary.
 */
export function LoginGate({ intendedPath }: { intendedPath?: string }) {
  const s = useStyles();
  const { devLogin } = useSession();
  const { notify } = useNotify();
  const [email, setEmail] = useState('ops@alpha.com');
  const [role, setRole] = useState('operations');
  const [tenantSlug, setTenantSlug] = useState('alpha');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    try {
      await devLogin({ email, role, tenantSlug });
      if (intendedPath && intendedPath !== '/' && window.location.pathname !== intendedPath) {
        window.history.replaceState(null, '', intendedPath);
      }
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.wrap}>
      <Card className={s.card}>
        <Title2>Sign in</Title2>
        <Text className={s.hint}>Development identity provider (dev IdP). Production uses Entra ID.</Text>
        <Field label="Email">
          <Input value={email} onChange={(_, d) => setEmail(d.value)} data-testid="login-email" />
        </Field>
        <Field label="Role">
          <Dropdown
            value={role}
            selectedOptions={[role]}
            onOptionSelect={(_, d) => d.optionValue && setRole(d.optionValue)}
            data-testid="login-role"
          >
            {ROLES.map((r) => (
              <Option key={r} value={r}>
                {r}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label="Tenant">
          <Input value={tenantSlug} onChange={(_, d) => setTenantSlug(d.value)} data-testid="login-tenant" />
        </Field>
        <Button appearance="primary" onClick={onSubmit} disabled={busy} data-testid="login-submit">
          {busy ? 'Signing in...' : 'Sign in'}
        </Button>
      </Card>
    </div>
  );
}
