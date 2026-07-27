import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Field, Input, SectionHeading, Textarea, WorkSurface } from '../tablework';

/**
 * Guest intake (Track B6) — the PUBLIC form. Rendered OUTSIDE the app shell and
 * the session: a new joiner opens the tokenized link with no account, fills
 * their own details, optionally attaches files, and submits into the sandbox.
 * It talks to the public API directly (no bearer token); the tenant is resolved
 * server-side from the unguessable token. Nothing here reaches live data — a
 * staff member reviews and promotes it through the governed pipeline.
 *
 * Tablework conversion (pivot W3, Lane 4). Behaviour/testids/copy verbatim.
 *
 * 🔴 THE THINGS THIS FILE MUST NOT LOSE
 *  - `autoComplete="off"` on all FIFTEEN controls (F3 ④). The Fluent controls
 *    carried it through the `input=`/`textarea=` SLOT props; the kit controls
 *    are thin native elements, so it is now a plain attribute on each one.
 *    Count them before you touch this file: 14 Inputs + 1 Textarea.
 *  - The `guest-*` testids — `zzz-intake-erasure.spec.ts` walks this form
 *    through `guest-fullName`, `guest-submit` and `guest-done`, and the rest
 *    are the same contract.
 *  - Values here are typed by someone OUTSIDE the org. Nothing may restyle or
 *    reinterpret them. (There is no label/value list on this screen, so no
 *    `FactList` is involved; if one is ever added it must be `FactList
 *    literal` — the plain one uppercases the `<dt>` and rewrites a typed "-".)
 *
 * The `required` word replaces Fluent's asterisk on "Full name" — the ruled
 * kit contract, accepted uniformly across the wave.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000';

interface PeekState {
  status: 'loading' | 'open' | 'closed' | 'notfound';
  message?: string;
}

// KIT-GAP WORKAROUND (provisional — remove when the gap closes).
// GAP: the kit has no page shell for a SESSION-LESS public route. Two parts:
//   (a) every selector in `tablework.css` nests under `.tw-root`, and the only
//       component that emits that class is `AppFrame` — which requires a
//       `TableworkActor` and renders the rail, the ContextHeader and the shell
//       intents. A guest has no account, so this route cannot mount it, and
//       without the scope root every kit class on this page renders unstyled.
//   (b) the kit's only measure is `Room`'s (`min(100%, 76rem)`, and `.room`
//       only exists inside `AppFrame`). This form is a 560px centred card;
//       there is no token, class or component for that width.
// WORKAROUND: emit `.tw-root` by hand (the class only — no styling is
//   redeclared) and carry the shell's centring + the card's measure as the two
//   inline style objects below. Every element INSIDE the card uses kit classes
//   and kit components; nothing else on this page is hand-styled.
// CLASS: additive — the kit needs a public/standalone surface (a `Room` usable
//   without `AppFrame`, plus a narrow measure). No existing kit behaviour is
//   contradicted, so nothing here has to change when it lands.
const PUBLIC_SHELL: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '32px 16px',
  boxSizing: 'border-box',
};
const PUBLIC_CARD: React.CSSProperties = {
  width: '100%',
  maxWidth: '560px',
  display: 'flex',
  flexDirection: 'column',
  rowGap: '18px',
};

type Fields = Record<string, string>;

export function GuestIntakePage() {
  const { token } = useParams<{ token: string }>();
  const [peek, setPeek] = useState<PeekState>({ status: 'loading' });
  const [f, setF] = useState<Fields>({});
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

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
    <div className="tw-root" style={PUBLIC_SHELL}>
      <div style={PUBLIC_CARD}>
        <div className="eyebrow">C3 · Geekay Esports</div>

        {peek.status === 'loading' && <p className="record-quiet">Loading…</p>}

        {/* `.record-card` is padding/radius/rhythm ONLY — the surface (base
            background + subtle border, matching the Fluent-era `s.panel`) comes
            from WorkSurface. A bare div renders an invisible panel. */}
        {peek.status === 'notfound' && (
          <WorkSurface className="record-card">
            <h1 className="collection-title">Link not found</h1>
            <p className="record-quiet">This intake link doesn’t exist. Please check the link your contact sent you.</p>
          </WorkSurface>
        )}

        {peek.status === 'closed' && (
          <WorkSurface className="record-card" data-testid="guest-closed">
            <h1 className="collection-title">Link unavailable</h1>
            <p className="record-quiet">{peek.message ?? 'This link is no longer available. Ask your contact for a fresh one.'}</p>
          </WorkSurface>
        )}

        {peek.status === 'open' && done && (
          <WorkSurface className="record-card" data-testid="guest-done">
            <strong>Thank you — your details were received.</strong>
            <p className="record-quiet">Reference {done}. The team will review your submission. You can close this page.</p>
          </WorkSurface>
        )}

        {peek.status === 'open' && !done && (
          <>
            <h1 className="collection-title">Welcome — tell us about you</h1>
            <p className="record-quiet">
              Fill in what you can. Only your full name is required. Nothing here is final — a team member reviews it
              before anything is created.
            </p>

            <div className="record-rows">
              <SectionHeading>Identity</SectionHeading>
              <Field label="Full name" required>
                <Input autoComplete="off" value={f.fullName ?? ''} onChange={set('fullName')} data-testid="guest-fullName" />
              </Field>
              <div className="form-row">
                <Field label="Nationality"><Input autoComplete="off" value={f.nationality ?? ''} onChange={set('nationality')} data-testid="guest-nationality" /></Field>
                <Field label="Date of birth (YYYY-MM-DD)"><Input autoComplete="off" value={f.dateOfBirth ?? ''} onChange={set('dateOfBirth')} placeholder="1999-05-20" data-testid="guest-dob" /></Field>
              </div>

              <SectionHeading>Contact</SectionHeading>
              <div className="form-row">
                <Field label="Email"><Input autoComplete="off" value={f.email ?? ''} onChange={set('email')} data-testid="guest-email" /></Field>
                <Field label="Phone"><Input autoComplete="off" value={f.phone ?? ''} onChange={set('phone')} data-testid="guest-phone" /></Field>
              </div>
              <Field label="Address line"><Input autoComplete="off" value={f.addressLine1 ?? ''} onChange={set('addressLine1')} /></Field>
              <div className="form-row">
                <Field label="City"><Input autoComplete="off" value={f.addressCity ?? ''} onChange={set('addressCity')} /></Field>
                <Field label="Country"><Input autoComplete="off" value={f.addressCountry ?? ''} onChange={set('addressCountry')} /></Field>
              </div>

              <SectionHeading>Gaming</SectionHeading>
              <div className="form-row">
                <Field label="In-game name"><Input autoComplete="off" value={f.ign ?? ''} onChange={set('ign')} data-testid="guest-ign" /></Field>
                <Field label="Game title"><Input autoComplete="off" value={f.currentGameTitle ?? ''} onChange={set('currentGameTitle')} /></Field>
              </div>
              <div className="form-row">
                <Field label="Role"><Input autoComplete="off" value={f.primaryRole ?? ''} onChange={set('primaryRole')} /></Field>
                <Field label="Team"><Input autoComplete="off" value={f.currentTeam ?? ''} onChange={set('currentTeam')} /></Field>
              </div>

              <SectionHeading>Sizes</SectionHeading>
              <div className="form-row">
                <Field label="Apparel size"><Input autoComplete="off" value={f.apparelSize ?? ''} onChange={set('apparelSize')} data-testid="guest-apparel" /></Field>
                <Field label="Shoe size"><Input autoComplete="off" value={f.shoeSize ?? ''} onChange={set('shoeSize')} /></Field>
              </div>

              <SectionHeading>Documents (optional)</SectionHeading>
              {/* B1 deliberately does NOT style input[type=file] — left bare. */}
              <input
                type="file"
                multiple
                data-testid="guest-files"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <span className="record-quiet">e.g. a passport or ID scan. Up to 6 files.{files.length > 0 ? ` ${files.length} selected.` : ''}</span>

              <Field label="Anything else">
                <Textarea autoComplete="off" value={f.note ?? ''} onChange={set('note')} data-testid="guest-note" />
              </Field>

              {/* The kit's state-coloured SENTENCE — never a raw inline colour. */}
              {error && <p className="record-quiet danger" data-testid="guest-error">{error}</p>}

              <div className="row-actions">
                <button className="primary-action" type="button" onClick={submit} disabled={!canSubmit} data-testid="guest-submit">
                  {submitting ? 'Sending…' : 'Submit'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
