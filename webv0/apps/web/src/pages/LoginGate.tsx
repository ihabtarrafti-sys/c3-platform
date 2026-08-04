import { useState } from 'react';
import { useSession, useNotify } from '../session';
import { ApiError } from '../api';
import { AuthScreen } from '../components/AuthScreen';
import { Field, Input, Selector } from '../tablework';

const ROLES = ['owner', 'operations', 'legal', 'finance', 'hr', 'management', 'visitor'];
const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: r }));

// K6 CLOSED (marker chapter): the scope-without-shell posture is now the
// kit's own `.tw-embedded` — the same three neutralised properties this file
// carried inline, byte-identical (and the `display: contents` trap that was
// tried and reverted here is recorded AT the kit rule so nobody retries it).
// The front door hosts kit controls; the kit no longer needs hand-neutralising.

/**
 * Development sign-in (backed by the API's signed dev IdP) — wears the
 * signature-01 front door. Not a production surface — dead-code-eliminated
 * from the Entra build — it exists so every slice can be exercised as
 * different roles. Production uses Entra OIDC at the same boundary
 * (EntraSignIn).
 *
 * ⚠️ THE `login-*` TEST IDS ARE THE E2E SUITE'S SIGN-IN CONTRACT, AND THIS IS
 * THE MOST DEPENDED-ON FILE IN THE APP. 27 of the 28 spec files enter through
 * all four of them (the exception is `pwa.spec.ts`, which never signs in). If
 * one moves, 27 specs fail at sign-in — and each failure reads as a defect in
 * whatever that spec was actually testing, not here.
 *
 * It is also mounted from THREE places, one of which is the kit wrapper:
 * `components/AppShell.tsx` (Fluent, Wave 4), `pages/MissionCommsPage.tsx`,
 * and `tablework/TableworkPage.tsx` — through which every Wave-1 and Wave-2
 * screen signs in. This is the sign-in surface of all three tiers at once.
 *
 * ⚖️ THE PILOT'S LAW (stated by TableworkPage, enforced by its caller):
 * loading → sign-in WITH THE DEEP LINK PRESERVED → unprovisioned → the screen,
 * and queries mount ONLY once authenticated. `intendedPath` below is that
 * preservation; do not "simplify" the history replace, and do not let anything
 * in this file fetch.
 *
 * CONVERSION NOTE (Wave 3 pre-wave): the Fluent `Dropdown`/`Option` became the
 * kit `Selector`, which keeps the contract exactly — its `data-testid` lands on
 * the trigger button (so `getByTestId('login-role').click()` opens it) and its
 * rows are REAL `role="option"` elements (so `getByRole('option', { name,
 * exact: true })` resolves). Option labels are the bare role strings, because
 * that `exact: true` match is on the accessible name.
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
      <h1 className="fd-h1">Sign in to find your place.</h1>
      <p className="fd-support">
        The development identity provider verifies this account. C3 checks its membership after sign-in.
      </p>
      <div className="fd-slot tw-root tw-embedded">
        <Field label="Email">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" />
        </Field>
        <Field label="Role">
          <Selector
            value={role}
            options={ROLE_OPTIONS}
            onSelect={(value) => setRole(value)}
            data-testid="login-role"
          />
        </Field>
        <Field label="Tenant">
          <Input value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} data-testid="login-tenant" />
        </Field>
        <button className="primary-action" type="button" onClick={onSubmit} disabled={busy} data-testid="login-submit">
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </div>
      <p className="fd-note">Signing in does not create C3 access. Membership is confirmed separately.</p>
    </AuthScreen>
  );
}
