import { useState } from 'react';
import { Button, Dropdown, Field, Input, Option } from '@fluentui/react-components';
import { useSession, useNotify } from '../session';
import { ApiError } from '../api';
import { AuthScreen } from '../components/AuthScreen';

const ROLES = ['owner', 'operations', 'legal', 'finance', 'hr', 'management', 'visitor'];

/**
 * Development sign-in (backed by the API's signed dev IdP) — wears the
 * signature-01 front door. Not a production surface — dead-code-eliminated
 * from the Entra build — it exists so every slice can be exercised as
 * different roles. Production uses Entra OIDC at the same boundary
 * (EntraSignIn). The Fluent controls and login-* test ids are the e2e
 * suite's sign-in contract — all 25 specs enter through them.
 */
export function LoginGate({ intendedPath }: { intendedPath?: string }) {
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
    <AuthScreen>
      <p className="fd-eyebrow">Sign in</p>
      <h1 className="fd-h1">Come in. Your place is ready.</h1>
      <p className="fd-support">Development identity provider (dev IdP). Production uses Microsoft Entra.</p>
      <div className="fd-slot">
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
      </div>
    </AuthScreen>
  );
}
