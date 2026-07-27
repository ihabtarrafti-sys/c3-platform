import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePerson, usePersonAgreements, usePersonCredentials, usePersonJourneys, usePersonMissionMemberships, usePersonTeams } from '../queries';
import { useSession } from '../session';
import {
  TableworkPage,
  WorkSurface,
  PersonAvatar,
  SectionHeading,
  FactList,
  ErrorState,
  LoadingState,
  type DefItem,
} from '../tablework';
import { ApiError } from '../api';

/**
 * Person one-pager (Track B, doc-gen lite) — a print-friendly summary of a
 * person assembled from data the profile already loads: identity, active
 * agreements, credentials (with expiries), teams, mission roster, journeys.
 * "Print / Save as PDF" uses the browser; a print stylesheet isolates the
 * sheet so the app chrome never prints. Reuses each domain's read gate (PII
 * fields are simply absent for roles without them — structural omission).
 *
 * Tablework conversion (pivot W3, Lane 4). Behaviour/testids/copy verbatim.
 *
 * 🔴 THIS PAGE HAS ZERO E2E COVERAGE AND ITS PURPOSE IS INVISIBLE TO THE GATE.
 * `PRINT_CSS` below is the ONLY `@media print` block in the app. The two class
 * names it targets — `c3-noprint` on the on-screen bar, `c3-onepager` on the
 * sheet — stay on exactly the elements they were on. A conversion can render
 * perfectly and gate green while breaking the one job this page exists to do;
 * the only proof is a print preview, which is recorded in the lane's QA
 * artifact.
 *
 * ⚠️ THE ONE THING IN PRINT_CSS THAT HAD TO CHANGE, AND WHY — the `!important`
 * on the geometry declarations. It is NOT a behaviour change; it is what KEEPS
 * the behaviour. Every rule in `tablework.css` is scoped `.tw-root .thing`,
 * which is specificity (0,2,0); this block's `.c3-onepager` is (0,1,0). Against
 * Fluent's single-class `makeStyles` output the plain selector won on source
 * order, but against the kit it LOSES: measured on the running page, with the
 * print rules applied, `border-radius` still computed to 20px from
 * `.tw-root .record-card` and `border` would have kept the 1px line from
 * `.tw-root .work-surface` — i.e. a rounded, boxed frame would have printed
 * around the sheet. `visibility` and `display` already carried `!important`
 * here for the same reason; the geometry now does too. Verify by measurement
 * after any change, never by reading.
 */

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .c3-onepager, .c3-onepager * { visibility: visible !important; }
  .c3-onepager {
    position: absolute !important;
    inset: 0 !important;
    margin: 0 !important;
    border: none !important;
    border-radius: 0 !important;
  }
  .c3-noprint { display: none !important; }
}`;

export function OnePagerPage() {
  const { personId = '' } = useParams();
  return (
    <TableworkPage record={personId} section="One-pager">
      <OnePagerSheet personId={personId} />
    </TableworkPage>
  );
}

function OnePagerSheet({ personId }: { personId: string }) {
  const { me } = useSession();
  const canReadAgreements = me?.capabilities.canReadAgreements ?? false;

  const person = usePerson(personId);
  const credentials = usePersonCredentials(personId);
  // The wire law: the capability IS the `enabled` flag.
  const agreements = usePersonAgreements(personId, canReadAgreements);
  const missions = usePersonMissionMemberships(personId);
  const journeys = usePersonJourneys(personId);
  const teams = usePersonTeams(personId);

  if (person.isError) {
    const is404 = person.error instanceof ApiError && person.error.status === 404;
    return <ErrorState data-testid="onepager-error" message={is404 ? `No person ${personId} in your tenant.` : 'Could not load this person.'} />;
  }
  if (person.isLoading || !person.data) return <LoadingState label="Assembling the one-pager…" />;

  const p = person.data.person;
  const activeAgreements = (agreements.data?.agreements ?? []).filter((a) => a.status === 'Active');
  const activeCreds = (credentials.data?.credentials ?? []).filter((c) => c.isActive);
  const activeMissions = (missions.data?.missions ?? []).filter((m) => m.isActive);
  const activeTeams = (teams.data?.members ?? []).filter((t) => t.isActive);
  const openJourneys = (journeys.data?.journeys ?? []).filter((j) => j.status !== 'Completed' && j.status !== 'Cancelled');

  // M-13: a one-pager must never print a section that is still loading or has
  // failed as an authoritative "None". Enumerate the ENABLED section queries,
  // show honest per-section loading/error states, and forbid printing until
  // every enabled section has settled successfully (a saved PDF is complete or
  // it is not offered at all). agreements is only in scope when readable.
  const sectionQueries = [teams, credentials, missions, journeys, ...(canReadAgreements ? [agreements] : [])];
  const sectionsPending = sectionQueries.some((q) => q.isLoading);
  const sectionsFailed = sectionQueries.some((q) => q.isError);
  const sectionBody = (q: { isLoading: boolean; isError: boolean }, ready: () => ReactNode): ReactNode =>
    q.isError ? (
      <div className="record-quiet" data-testid="onepager-section-error">Couldn’t load this section — reopen the one-pager to retry.</div>
    ) : q.isLoading ? (
      <div className="record-quiet">Loading…</div>
    ) : (
      ready()
    );

  /**
   * The identity facts. TWO properties of the original are load-bearing and
   * both are preserved deliberately:
   *
   *  1. A field with no value is OMITTED ENTIRELY, never rendered as an empty
   *     row. That is the PII contract stated in this file's docstring —
   *     structural omission. A role without the read gate must not even see
   *     that a field exists, so the list is BUILT from present values rather
   *     than filtered at render.
   *  2. `literal` is on. Its two effects are the faithful ones here: the
   *     original labels are sentence case (`s.k` set colour only, never
   *     `text-transform`), and a person record's identity values can be
   *     GUEST-TYPED — nationality, date of birth, email and phone all arrive
   *     through the public intake form and are promoted onto the record — so a
   *     deliberately typed "-" must reach the printed sheet as typed, not be
   *     rewritten into the "not set" marker.
   */
  const facts: DefItem[] = [];
  const kv = (label: string, value: string | null | undefined) => {
    if (value) facts.push({ label, value });
  };
  kv('Nationality', p.nationality);
  kv('Game title', p.currentGameTitle);
  kv('Department', p.primaryDepartment);
  kv('Position', p.position);
  kv('Date of birth', p.dateOfBirth);
  kv('Date of joining', p.dateOfJoining);
  kv('Email', p.email);
  kv('Phone', p.phone);
  kv('Nationality (other)', p.otherNationalities?.length ? p.otherNationalities.join(', ') : null);

  return (
    <div className="record-rows">
      <style>{PRINT_CSS}</style>
      <div className="row-actions c3-noprint">
        <button
          className="primary-action"
          type="button"
          onClick={() => window.print()}
          data-testid="onepager-print"
          disabled={sectionsPending || sectionsFailed}
        >
          {sectionsPending ? 'Assembling…' : sectionsFailed ? 'Incomplete — cannot print' : 'Print / Save as PDF'}
        </button>
        {/* Flattened from `<Link><Button/></Link>` — a <button> inside an <a>
            was never valid HTML; same copy, same destination. */}
        <Link className="secondary-action" to={`/people/${personId}`}>Back to profile</Link>
      </div>

      {/* `.record-card` carries padding/radius/rhythm ONLY — the surface (base
          background + subtle border, matching the Fluent-era sheet) comes from
          WorkSurface, which is how every other converted screen pairs them. A
          bare div here rendered an invisible panel. */}
      <WorkSurface className="record-card c3-onepager" data-testid="onepager-sheet">
        <div className="surface-heading">
          <div>
            <p className="eyebrow">C3 · Geekay Esports · Person one-pager</p>
            <h2>{p.fullName}</h2>
            <p>
              {p.personId}{p.ign ? ` · ${p.ign}` : ''}{p.primaryRole ? ` · ${p.primaryRole}` : ''}{p.currentTeam ? ` · ${p.currentTeam}` : ''}
            </p>
          </div>
          <PersonAvatar personId={p.personId} photoUpdatedAt={p.photoUpdatedAt} name={p.fullName} size={72} />
        </div>

        <FactList items={facts} literal />

        <div>
          <SectionHeading level={3}>Teams</SectionHeading>
          {sectionBody(teams, () => activeTeams.length === 0 ? <div className="record-quiet">None</div> : activeTeams.map((t) => (
            <div className="record-row-name" key={t.teamId}>{t.teamId} <span className="record-quiet">· {t.role}</span></div>
          )))}
        </div>

        <div>
          <SectionHeading level={3}>Active agreements</SectionHeading>
          {!canReadAgreements ? <div className="record-quiet">—</div> : sectionBody(agreements, () => activeAgreements.length === 0 ? <div className="record-quiet">None</div> : activeAgreements.map((a) => (
            <div className="record-row-name" key={a.agreementId}>{a.agreementType} <span className="record-quiet">· {a.agreementId} · {a.startsOn} → {a.endsOn}</span></div>
          )))}
        </div>

        <div>
          <SectionHeading level={3}>Credentials</SectionHeading>
          {sectionBody(credentials, () => activeCreds.length === 0 ? <div className="record-quiet">None</div> : activeCreds.map((c) => (
            <div className="record-row-name" key={c.credentialId}>{c.credentialType} <span className="record-quiet">· {c.credentialId}{c.expiresOn ? ` · expires ${c.expiresOn}` : ''}</span></div>
          )))}
        </div>

        <div>
          <SectionHeading level={3}>Mission roster</SectionHeading>
          {sectionBody(missions, () => activeMissions.length === 0 ? <div className="record-quiet">None</div> : activeMissions.map((m) => (
            <div className="record-row-name" key={m.missionId}>{m.missionName ?? m.missionId} <span className="record-quiet">· {m.role}</span></div>
          )))}
        </div>

        <div>
          <SectionHeading level={3}>Journeys in progress</SectionHeading>
          {sectionBody(journeys, () => openJourneys.length === 0 ? <div className="record-quiet">None</div> : openJourneys.map((j) => (
            <div className="record-row-name" key={j.journeyId}>{j.journeyType}{j.title ? ` — ${j.title}` : ''} <span className="record-quiet">· {j.status}</span></div>
          )))}
        </div>

        <div className="record-quiet">Generated by C3 on {new Date().toISOString().slice(0, 10)} — {p.personId}</div>
      </WorkSurface>
    </div>
  );
}
