import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, makeStyles } from '@fluentui/react-components';
import { usePerson, usePersonAgreements, usePersonCredentials, usePersonJourneys, usePersonMissionMemberships, usePersonTeams } from '../queries';
import { useSession } from '../session';
import { ErrorState, LoadingState } from '../components/states';
import { PersonAvatar } from '../components/PersonAvatar';
import { ApiError } from '../api';

/**
 * Person one-pager (Track B, doc-gen lite) — a print-friendly summary of a
 * person assembled from data the profile already loads: identity, active
 * agreements, credentials (with expiries), teams, mission roster, journeys.
 * "Print / Save as PDF" uses the browser; a print stylesheet isolates the
 * sheet so the app chrome never prints. Reuses each domain's read gate (PII
 * fields are simply absent for roles without them — structural omission).
 */

const useStyles = makeStyles({
  wrap: { maxWidth: '820px' },
  bar: { display: 'flex', gap: '8px', marginBottom: '16px' },
  sheet: { border: '1px solid var(--c3-hairline)', borderRadius: '12px', padding: '28px 32px', backgroundColor: 'var(--c3-surface, transparent)' },
  headRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', columnGap: '16px' },
  brand: { fontFamily: 'var(--c3-font-mono)', fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c3-ink-muted)' },
  name: { fontSize: '24px', fontWeight: 600, color: 'var(--c3-ink)', margin: '4px 0 2px' },
  sub: { fontSize: '13px', color: 'var(--c3-ink-mid)' },
  grid: { display: 'grid', gridTemplateColumns: '150px 1fr', columnGap: '14px', rowGap: '5px', fontSize: '13px', marginTop: '14px' },
  k: { color: 'var(--c3-ink-muted)' },
  v: { color: 'var(--c3-ink)' },
  section: { marginTop: '20px' },
  sTitle: { fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c3-ink-muted)', fontFamily: 'var(--c3-font-mono)', borderBottom: '1px solid var(--c3-hairline)', paddingBottom: '4px', marginBottom: '8px' },
  row: { fontSize: '13px', color: 'var(--c3-ink)', padding: '2px 0' },
  rowMuted: { fontSize: '12px', color: 'var(--c3-ink-muted)' },
  empty: { fontSize: '12.5px', color: 'var(--c3-ink-muted)' },
  gen: { fontSize: '11px', color: 'var(--c3-ink-muted)', marginTop: '20px' },
});

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  .c3-onepager, .c3-onepager * { visibility: visible !important; }
  .c3-onepager { position: absolute; inset: 0; margin: 0; border: none; border-radius: 0; }
  .c3-noprint { display: none !important; }
}`;

export function OnePagerPage() {
  const s = useStyles();
  const { personId = '' } = useParams();
  const { me } = useSession();
  const canReadAgreements = me?.capabilities.canReadAgreements ?? false;

  const person = usePerson(personId);
  const credentials = usePersonCredentials(personId);
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
      <div className={s.empty} data-testid="onepager-section-error">Couldn’t load this section — reopen the one-pager to retry.</div>
    ) : q.isLoading ? (
      <div className={s.empty}>Loading…</div>
    ) : (
      ready()
    );
  const kv = (label: string, value: string | null | undefined) =>
    value ? [<span key={`${label}k`} className={s.k}>{label}</span>, <span key={`${label}v`} className={s.v}>{value}</span>] : [];

  return (
    <div className={s.wrap}>
      <style>{PRINT_CSS}</style>
      <div className={`${s.bar} c3-noprint`}>
        <Button
          appearance="primary"
          onClick={() => window.print()}
          data-testid="onepager-print"
          disabled={sectionsPending || sectionsFailed}
        >
          {sectionsPending ? 'Assembling…' : sectionsFailed ? 'Incomplete — cannot print' : 'Print / Save as PDF'}
        </Button>
        <Link to={`/people/${personId}`}><Button appearance="secondary">Back to profile</Button></Link>
      </div>

      <div className={`${s.sheet} c3-onepager`} data-testid="onepager-sheet">
        <div className={s.headRow}>
          <div>
            <div className={s.brand}>C3 · Geekay Esports · Person one-pager</div>
            <div className={s.name}>{p.fullName}</div>
            <div className={s.sub}>
              {p.personId}{p.ign ? ` · ${p.ign}` : ''}{p.primaryRole ? ` · ${p.primaryRole}` : ''}{p.currentTeam ? ` · ${p.currentTeam}` : ''}
            </div>
          </div>
          <PersonAvatar personId={p.personId} photoUpdatedAt={p.photoUpdatedAt} name={p.fullName} size={72} />
        </div>

        <div className={s.grid}>
          {kv('Nationality', p.nationality)}
          {kv('Game title', p.currentGameTitle)}
          {kv('Department', p.primaryDepartment)}
          {kv('Position', p.position)}
          {kv('Date of birth', p.dateOfBirth)}
          {kv('Date of joining', p.dateOfJoining)}
          {kv('Email', p.email)}
          {kv('Phone', p.phone)}
          {kv('Nationality (other)', p.otherNationalities?.length ? p.otherNationalities.join(', ') : null)}
        </div>

        <div className={s.section}>
          <div className={s.sTitle}>Teams</div>
          {sectionBody(teams, () => activeTeams.length === 0 ? <div className={s.empty}>None</div> : activeTeams.map((t) => (
            <div className={s.row} key={t.teamId}>{t.teamId} <span className={s.rowMuted}>· {t.role}</span></div>
          )))}
        </div>

        <div className={s.section}>
          <div className={s.sTitle}>Active agreements</div>
          {!canReadAgreements ? <div className={s.empty}>—</div> : sectionBody(agreements, () => activeAgreements.length === 0 ? <div className={s.empty}>None</div> : activeAgreements.map((a) => (
            <div className={s.row} key={a.agreementId}>{a.agreementType} <span className={s.rowMuted}>· {a.agreementId} · {a.startsOn} → {a.endsOn}</span></div>
          )))}
        </div>

        <div className={s.section}>
          <div className={s.sTitle}>Credentials</div>
          {sectionBody(credentials, () => activeCreds.length === 0 ? <div className={s.empty}>None</div> : activeCreds.map((c) => (
            <div className={s.row} key={c.credentialId}>{c.credentialType} <span className={s.rowMuted}>· {c.credentialId}{c.expiresOn ? ` · expires ${c.expiresOn}` : ''}</span></div>
          )))}
        </div>

        <div className={s.section}>
          <div className={s.sTitle}>Mission roster</div>
          {sectionBody(missions, () => activeMissions.length === 0 ? <div className={s.empty}>None</div> : activeMissions.map((m) => (
            <div className={s.row} key={m.missionId}>{m.missionName ?? m.missionId} <span className={s.rowMuted}>· {m.role}</span></div>
          )))}
        </div>

        <div className={s.section}>
          <div className={s.sTitle}>Journeys in progress</div>
          {sectionBody(journeys, () => openJourneys.length === 0 ? <div className={s.empty}>None</div> : openJourneys.map((j) => (
            <div className={s.row} key={j.journeyId}>{j.journeyType}{j.title ? ` — ${j.title}` : ''} <span className={s.rowMuted}>· {j.status}</span></div>
          )))}
        </div>

        <div className={s.gen}>Generated by C3 on {new Date().toISOString().slice(0, 10)} — {p.personId}</div>
      </div>
    </div>
  );
}
