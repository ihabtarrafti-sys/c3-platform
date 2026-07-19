import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Field, Input, Textarea, makeStyles } from '@fluentui/react-components';

/**
 * Guest intake (Track B6) — the PUBLIC form. Rendered OUTSIDE the app shell and
 * the session: a new joiner opens the tokenized link with no account, fills
 * their own details, optionally attaches files, and submits into the sandbox.
 * It talks to the public API directly (no bearer token); the tenant is resolved
 * server-side from the unguessable token. Nothing here reaches live data — a
 * staff member reviews and promotes it through the governed pipeline.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000';

interface PeekState {
  status: 'loading' | 'open' | 'closed' | 'notfound';
  message?: string;
}

const useStyles = makeStyles({
  wrap: { minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: '32px 16px', boxSizing: 'border-box' },
  card: {
    width: '100%',
    maxWidth: '560px',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '18px',
  },
  brand: { fontFamily: 'var(--c3-font-mono)', fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c3-ink-quiet)' },
  title: { fontSize: '26px', fontWeight: 600, color: 'var(--c3-ink-default)', margin: 0 },
  lede: { fontSize: '13.5px', lineHeight: '20px', color: 'var(--c3-ink-muted)' },
  group: { display: 'flex', flexDirection: 'column', rowGap: '12px' },
  groupTitle: { fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c3-ink-quiet)', fontFamily: 'var(--c3-font-mono)', marginTop: '8px' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '12px', rowGap: '12px' },
  fileNote: { fontSize: '12px', color: 'var(--c3-ink-quiet)' },
  panel: {
    padding: '18px 20px',
    border: '1px solid var(--c3-border-subtle)',
    borderRadius: 'var(--c3-radius-md, 14px)',
    backgroundColor: 'var(--c3-surface-base, transparent)',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '10px',
  },
  ok: { color: 'var(--c3-ink-default)', fontSize: '15px', fontWeight: 600 },
  actions: { marginTop: '6px' },
});

type Fields = Record<string, string>;

export function GuestIntakePage() {
  const s = useStyles();
  const { token } = useParams<{ token: string }>();
  const [peek, setPeek] = useState<PeekState>({ status: 'loading' });
  const [f, setF] = useState<Fields>({});
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (_: unknown, d: { value: string }) => setF((prev) => ({ ...prev, [k]: d.value }));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/intake/public/${token}`);
        if (cancelled) return;
        if (res.status === 404) return setPeek({ status: 'notfound' });
        const json = await res.json();
        if (!res.ok) return setPeek({ status: 'closed', message: json?.error?.message });
        setPeek(json.open ? { status: 'open' } : { status: 'closed', message: `This link is ${String(json.status).toLowerCase()}.` });
      } catch {
        if (!cancelled) setPeek({ status: 'closed', message: 'The service could not be reached.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const canSubmit = useMemo(() => (f.fullName ?? '').trim().length > 0 && !submitting, [f.fullName, submitting]);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      // Only include non-empty fields (fullName always) — a tidy sandbox row.
      const payload: Record<string, string> = { fullName: (f.fullName ?? '').trim() };
      for (const [k, v] of Object.entries(f)) {
        if (k !== 'fullName' && v && v.trim()) payload[k] = v.trim();
      }
      const form = new FormData();
      form.append('payload', JSON.stringify(payload));
      for (const file of files) form.append('file', file);
      const res = await fetch(`${API_BASE}/api/v1/intake/public/${token}`, { method: 'POST', body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? 'Your submission could not be sent.');
        return;
      }
      setDone(json.reference as string);
    } catch {
      setError('The service could not be reached. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <div className={s.brand}>C3 · Geekay Esports</div>

        {peek.status === 'loading' && <p className={s.lede}>Loading…</p>}

        {peek.status === 'notfound' && (
          <div className={s.panel}>
            <h1 className={s.title}>Link not found</h1>
            <p className={s.lede}>This intake link doesn’t exist. Please check the link your contact sent you.</p>
          </div>
        )}

        {peek.status === 'closed' && (
          <div className={s.panel} data-testid="guest-closed">
            <h1 className={s.title}>Link unavailable</h1>
            <p className={s.lede}>{peek.message ?? 'This link is no longer available. Ask your contact for a fresh one.'}</p>
          </div>
        )}

        {peek.status === 'open' && done && (
          <div className={s.panel} data-testid="guest-done">
            <span className={s.ok}>Thank you — your details were received.</span>
            <p className={s.lede}>Reference {done}. The team will review your submission. You can close this page.</p>
          </div>
        )}

        {peek.status === 'open' && !done && (
          <>
            <h1 className={s.title}>Welcome — tell us about you</h1>
            <p className={s.lede}>
              Fill in what you can. Only your full name is required. Nothing here is final — a team member reviews it
              before anything is created.
            </p>

            <div className={s.group}>
              <div className={s.groupTitle}>Identity</div>
              <Field label="Full name" required>
                <Input value={f.fullName ?? ''} onChange={set('fullName')} data-testid="guest-fullName" />
              </Field>
              <div className={s.twoCol}>
                <Field label="Nationality"><Input value={f.nationality ?? ''} onChange={set('nationality')} data-testid="guest-nationality" /></Field>
                <Field label="Date of birth (YYYY-MM-DD)"><Input value={f.dateOfBirth ?? ''} onChange={set('dateOfBirth')} placeholder="1999-05-20" data-testid="guest-dob" /></Field>
              </div>

              <div className={s.groupTitle}>Contact</div>
              <div className={s.twoCol}>
                <Field label="Email"><Input value={f.email ?? ''} onChange={set('email')} data-testid="guest-email" /></Field>
                <Field label="Phone"><Input value={f.phone ?? ''} onChange={set('phone')} data-testid="guest-phone" /></Field>
              </div>
              <Field label="Address line"><Input value={f.addressLine1 ?? ''} onChange={set('addressLine1')} /></Field>
              <div className={s.twoCol}>
                <Field label="City"><Input value={f.addressCity ?? ''} onChange={set('addressCity')} /></Field>
                <Field label="Country"><Input value={f.addressCountry ?? ''} onChange={set('addressCountry')} /></Field>
              </div>

              <div className={s.groupTitle}>Gaming</div>
              <div className={s.twoCol}>
                <Field label="In-game name"><Input value={f.ign ?? ''} onChange={set('ign')} data-testid="guest-ign" /></Field>
                <Field label="Game title"><Input value={f.currentGameTitle ?? ''} onChange={set('currentGameTitle')} /></Field>
              </div>
              <div className={s.twoCol}>
                <Field label="Role"><Input value={f.primaryRole ?? ''} onChange={set('primaryRole')} /></Field>
                <Field label="Team"><Input value={f.currentTeam ?? ''} onChange={set('currentTeam')} /></Field>
              </div>

              <div className={s.groupTitle}>Sizes</div>
              <div className={s.twoCol}>
                <Field label="Apparel size"><Input value={f.apparelSize ?? ''} onChange={set('apparelSize')} data-testid="guest-apparel" /></Field>
                <Field label="Shoe size"><Input value={f.shoeSize ?? ''} onChange={set('shoeSize')} /></Field>
              </div>

              <div className={s.groupTitle}>Documents (optional)</div>
              <input
                type="file"
                multiple
                data-testid="guest-files"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <span className={s.fileNote}>e.g. a passport or ID scan. Up to 6 files.{files.length > 0 ? ` ${files.length} selected.` : ''}</span>

              <Field label="Anything else">
                <Textarea value={f.note ?? ''} onChange={set('note')} data-testid="guest-note" />
              </Field>

              {error && <p className={s.lede} data-testid="guest-error" style={{ color: 'var(--c3-state-danger, #d13438)' }}>{error}</p>}

              <div className={s.actions}>
                <Button appearance="primary" onClick={submit} disabled={!canSubmit} data-testid="guest-submit">
                  {submitting ? 'Sending…' : 'Submit'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
