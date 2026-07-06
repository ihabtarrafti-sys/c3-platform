import type { ReactNode } from 'react';
import { makeStyles } from '@fluentui/react-components';
import { ENV_LABEL, SHOW_ENV } from '../theme/env';

/**
 * Pre-authentication surface — Concept C "Split Authority", identity register.
 * A focused Command Black backdrop (the LOGIN-UX-SPECIFICATION permits login on
 * Command Black), the A2.2 mark + C3 wordmark on top, and one calm light card
 * for the surface-specific content (sign in / callback / access-not-provisioned).
 * Reading is quiet; there is no navigation and no domain action here.
 */
const useStyles = makeStyles({
  root: {
    minHeight: '100vh',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 16px',
    position: 'relative',
    backgroundColor: 'var(--c3-command-black)',
    color: 'var(--c3-identity-white)',
    fontFamily: 'var(--c3-font-base)',
  },
  envBadge: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    fontFamily: 'var(--c3-font-mono)',
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.14em',
    color: 'var(--c3-signal-red)',
    border: '1px solid var(--c3-signal-red)',
    borderRadius: 'var(--c3-radius)',
    padding: '2px 8px',
  },
  column: { width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  mark: { width: '40px', height: '36px', display: 'block', marginBottom: '14px' },
  wordmark: { fontSize: '22px', fontWeight: 600, letterSpacing: '0.02em', marginBottom: '24px' },
  card: {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--c3-identity-white)',
    color: 'var(--c3-command-black)',
    border: '1px solid var(--c3-hairline)',
    borderRadius: 'var(--c3-radius)',
    boxShadow: 'var(--c3-e1)',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '14px',
  },
  support: { marginTop: '20px', fontSize: '12.5px', color: 'var(--c3-on-dark-70)', textAlign: 'center' },
  supportLink: {
    color: 'var(--c3-identity-white)',
    textDecoration: 'none',
    ':hover': { textDecoration: 'underline' },
  },
});

export function AuthScreen({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <div className={s.root}>
      {SHOW_ENV && (
        <span className={s.envBadge} data-testid="env-badge">
          {ENV_LABEL}
        </span>
      )}
      <div className={s.column}>
        <img className={s.mark} src="/brand/c3-symbol-white.svg" alt="" aria-hidden="true" />
        <div className={s.wordmark}>C3</div>
        <div className={s.card}>{children}</div>
        <div className={s.support}>
          Need help?{' '}
          <a className={s.supportLink} href="mailto:team@c3hq.org">
            team@c3hq.org
          </a>
        </div>
      </div>
    </div>
  );
}
