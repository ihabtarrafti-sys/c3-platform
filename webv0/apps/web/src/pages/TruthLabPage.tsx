/**
 * TruthLabPage — Phase A's contract made visible (`/truth-lab`, dev builds).
 *
 * All six witness states of the SAME TruthPanel, side by side, with the same
 * data-truth artifacts the product stamps — the living reference for every
 * surface that adopts the contract, and the e2e hook that proves the six
 * renders stay distinct. Dev-auth builds only: the lab is a workshop wall,
 * not a product surface.
 */
import { Link } from 'react-router-dom';
import { AppFrame, ContextHeader, TruthPanel, WorkSurface, type WitnessState } from '../tablework';
import { useSession } from '../session';
import { IS_ENTRA } from '../auth';

const AT = new Date('2026-07-30T12:00:00');

const STATES: Array<{ title: string; law: string; state: WitnessState; body?: string }> = [
  { title: 'Loading', law: 'The witness is still out; claim nothing.', state: { kind: 'loading' } },
  {
    title: 'Verified',
    law: 'A successful witness returned content — and says when it checked.',
    state: { kind: 'verified', at: AT },
    body: 'The content renders here, inside the verified artifact.',
  },
  {
    title: 'Proven empty',
    law: 'Emptiness is a POSITIVE claim, earned by a successful witness — structurally unreachable from an errored query.',
    state: { kind: 'proven-empty', at: AT },
  },
  {
    title: 'Denied',
    law: 'A standing refusal renders AS a denial with its reason class — never an empty list.',
    state: { kind: 'denied', reasonClass: 'MODULE_READ_ONLY' },
  },
  {
    title: 'Fetch failed',
    law: 'A failure is a failure — never a zero, never a greenfield line.',
    state: { kind: 'fetch-failed', message: 'The request did not complete.' },
  },
  {
    title: 'Stale',
    law: 'Old truth may show ONLY under an explicit stamp; dependent actions stop trusting it.',
    state: { kind: 'stale', verifiedAt: AT, message: 'The refresh failed.' },
    body: 'The last verified view renders here, under the stale stamp.',
  },
];

export function TruthLabPage() {
  const { me } = useSession();
  if (IS_ENTRA) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        The Truth Lab is a development surface.
      </div>
    );
  }
  return (
    <AppFrame
      place="Truth Lab"
      actor={{ displayName: me?.displayName ?? 'Member', role: me?.role ?? '', tenantName: me?.tenantSlug ?? '' }}
      header={
        <ContextHeader
          place="Truth Lab"
          origin="Kit"
          record="The six-state contract"
          section="Every witness state, one renderer"
          actions={
            <Link className="intent-button" to="/">
              Home
            </Link>
          }
        />
      }
    >
      <p className="boundary-note" style={{ maxWidth: '64ch' }}>
        Every data region in C3 renders exactly one of these six states, stamped as a <code>data-truth</code> artifact.
        Tests assert the artifact, never the words (instance 48). The fact-level vocabulary
        (<code>data-truth-state</code>, TruthValue) lives INSIDE a verified region — the two altitudes compose.
      </p>
      <div style={{ display: 'grid', gap: 'var(--space-4, 1rem)', maxWidth: '48rem' }}>
        {STATES.map((s) => (
          <WorkSurface key={s.title} className="comms-surface" aria-label={s.title}>
            <header className="surface-heading">
              <div>
                <h2>{s.title}</h2>
                <p>{s.law}</p>
              </div>
            </header>
            <TruthPanel state={s.state} emptyLabel="Nothing here — and that is a checked fact.">
              {s.body ? <p>{s.body}</p> : null}
            </TruthPanel>
          </WorkSurface>
        ))}
      </div>
    </AppFrame>
  );
}
