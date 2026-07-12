import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Field, Input, Option } from '@fluentui/react-components';
import { usePeople, useEntities } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { PersonAvatar } from '../components/PersonAvatar';
import { SavedViewsBar } from '../components/SavedViewsBar';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { FormDrawer } from '../components/FormDrawer';

/** The People register's filter/sort state — the payload a saved view stores. */
type PeopleStatus = 'active' | 'all' | 'inactive';
type PeopleSort = 'name' | 'id' | 'team';
interface PeopleViewState {
  q: string;
  team: string;
  status: PeopleStatus;
  sort: PeopleSort;
}
const DEFAULT_VIEW: PeopleViewState = { q: '', team: '', status: 'active', sort: 'name' };
/** Coerce an opaque saved-view blob back into a valid PeopleViewState. */
function coerceView(state: unknown): PeopleViewState {
  const s = (state ?? {}) as Record<string, unknown>;
  const status: PeopleStatus = s.status === 'all' || s.status === 'inactive' ? s.status : 'active';
  const sort: PeopleSort = s.sort === 'id' || s.sort === 'team' ? s.sort : 'name';
  return { q: typeof s.q === 'string' ? s.q : '', team: typeof s.team === 'string' ? s.team : '', status, sort };
}

export function PeoplePage() {
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = usePeople();
  const canSubmit = me?.capabilities.canSubmitApproval ?? false;
  const entities = useEntities(canSubmit);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [ign, setIgn] = useState('');
  const [team, setTeam] = useState('');
  const [entityId, setEntityId] = useState('');
  const [entityLabel, setEntityLabel] = useState('');
  const [busy, setBusy] = useState(false);

  // ── register filter/sort state (client-side over the loaded roster) ────────
  const [view, setView] = useState<PeopleViewState>(DEFAULT_VIEW);
  const patchView = (p: Partial<PeopleViewState>) => setView((v) => ({ ...v, ...p }));

  const people = data?.people ?? [];
  const teamsPresent = useMemo(
    () => Array.from(new Set(people.map((p) => p.currentTeam).filter((t): t is string => !!t))).sort(),
    [people],
  );
  const shown = useMemo(() => {
    const q = view.q.trim().toLowerCase();
    let rows = people.filter((p) => {
      if (view.status === 'active' && !p.isActive) return false;
      if (view.status === 'inactive' && p.isActive) return false;
      if (view.team && p.currentTeam !== view.team) return false;
      if (q) {
        const hay = `${p.fullName} ${p.ign ?? ''} ${p.personId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (view.sort === 'id') return a.personId.localeCompare(b.personId);
      if (view.sort === 'team') return (a.currentTeam ?? '').localeCompare(b.currentTeam ?? '') || a.fullName.localeCompare(b.fullName);
      return a.fullName.localeCompare(b.fullName);
    });
    return rows;
  }, [people, view]);
  const isFiltered = view.q !== '' || view.team !== '' || view.status !== 'active' || view.sort !== 'name';

  async function submit() {
    setBusy(true);
    try {
      const res = await api.submitAddPerson({
        fullName,
        ign: ign || undefined,
        currentTeam: team || undefined,
        entityId: entityId || undefined,
      });
      notify('success', `Submitted ${res.approval.approvalId} for approval. A person is not created until an owner executes it.`);
      setFullName('');
      setIgn('');
      setTeam('');
      setEntityId('');
      setEntityLabel('');
      setShowForm(false);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
    } finally {
      setBusy(false);
    }
  }

  const activeEntities = (entities.data?.entities ?? []).filter((e) => e.isActive);

  const addAction = canSubmit ? (
    <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="add-person-toggle">
      Add Person
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader
        kicker="Register"
        title="People"
        context={data ? `${shown.length} shown${isFiltered ? ` · ${people.length} total` : ''}` : undefined}
        actions={addAction}
      />

      {canSubmit && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow="Add person"
          mode="governed"
          intro="New person requests go through approval — an owner must review and execute before the person exists."
          footer={
            <GovernedAction
              triggerLabel="Submit for approval"
              triggerTestId="add-person-submit"
              triggerDisabled={busy || fullName.trim() === ''}
              title="Submit this request for approval?"
              description="It goes to an approver for review; approval and execution are separate steps. You can polish or withdraw it until review starts — after that, corrections become a new request."
              confirmLabel="Submit for approval"
              onConfirm={submit}
            />
          }
        >
          <Field label="Full name" required>
            <Input value={fullName} onChange={(_, d) => setFullName(d.value)} data-testid="add-person-fullname" />
          </Field>
          <Field label="In-game name">
            <Input value={ign} onChange={(_, d) => setIgn(d.value)} data-testid="add-person-ign" />
          </Field>
          <Field label="Team">
            <Input value={team} onChange={(_, d) => setTeam(d.value)} data-testid="add-person-team" />
          </Field>
          {activeEntities.length > 0 && (
            <Field label="Signed with (entity)" hint="Which of your legal entities this person signed with.">
              <Dropdown
                placeholder="Not assigned"
                value={entityLabel}
                selectedOptions={entityId ? [entityId] : []}
                onOptionSelect={(_, d) => {
                  setEntityId(d.optionValue ?? '');
                  setEntityLabel(d.optionValue ? (d.optionText ?? '') : '');
                }}
                data-testid="add-person-entity"
              >
                <Option value="" text="Not assigned">
                  Not assigned
                </Option>
                {activeEntities.map((e) => (
                  <Option key={e.entityId} value={e.entityId} text={`${e.name} (${e.jurisdiction})`}>
                    {`${e.name} (${e.jurisdiction})`}
                  </Option>
                ))}
              </Dropdown>
            </Field>
          )}
        </FormDrawer>
      )}

      {isLoading && <LoadingState label="Loading people…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load people.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.people.length === 0 && (
        <EmptyState
          data-testid="people-empty"
          message="No people yet."
          action={
            canSubmit ? (
              <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="people-empty-add">
                Add Person
              </Button>
            ) : undefined
          }
        />
      )}
      {data && data.people.length > 0 && (
        <>
          <SavedViewsBar register="people" currentState={view} onApply={(st) => setView(coerceView(st))} />
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', margin: '0 0 16px' }} data-testid="people-filters">
            <Field label="Search">
              <Input
                value={view.q}
                placeholder="Name, IGN, or ID"
                onChange={(_, d) => patchView({ q: d.value })}
                data-testid="people-filter-search"
              />
            </Field>
            <Field label="Team">
              <Dropdown
                value={view.team || 'All teams'}
                selectedOptions={[view.team]}
                onOptionSelect={(_, d) => patchView({ team: d.optionValue ?? '' })}
                data-testid="people-filter-team"
              >
                <Option value="" text="All teams">All teams</Option>
                {teamsPresent.map((t) => (
                  <Option key={t} value={t} text={t}>{t}</Option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Status">
              <Dropdown
                value={view.status === 'active' ? 'Active' : view.status === 'inactive' ? 'Inactive' : 'All'}
                selectedOptions={[view.status]}
                onOptionSelect={(_, d) => patchView({ status: (d.optionValue as PeopleStatus) ?? 'active' })}
                data-testid="people-filter-status"
              >
                <Option value="active" text="Active">Active</Option>
                <Option value="all" text="All">All</Option>
                <Option value="inactive" text="Inactive">Inactive</Option>
              </Dropdown>
            </Field>
            <Field label="Sort">
              <Dropdown
                value={view.sort === 'id' ? 'Person ID' : view.sort === 'team' ? 'Team' : 'Full name'}
                selectedOptions={[view.sort]}
                onOptionSelect={(_, d) => patchView({ sort: (d.optionValue as PeopleSort) ?? 'name' })}
                data-testid="people-filter-sort"
              >
                <Option value="name" text="Full name">Full name</Option>
                <Option value="id" text="Person ID">Person ID</Option>
                <Option value="team" text="Team">Team</Option>
              </Dropdown>
            </Field>
            {isFiltered && (
              <Button appearance="subtle" onClick={() => setView(DEFAULT_VIEW)} data-testid="people-filter-reset">
                Reset
              </Button>
            )}
          </div>
          <table className={r.table} data-testid="people-table" aria-label="People register">
            <thead>
              <tr>
                <th className={r.th}>Person</th>
                <th className={r.th}>Full name</th>
                <th className={r.th}>Team</th>
                <th className={r.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td className={r.td} colSpan={4} data-testid="people-no-matches">
                    No people match this view.
                  </td>
                </tr>
              )}
              {shown.map((p) => (
                <tr key={p.personId} className={r.row} data-testid={`person-row-${p.personId}`}>
                  <td className={r.td}>
                    <Link className={r.idLink} to={`/people/${p.personId}`}>
                      {p.personId}
                    </Link>
                  </td>
                  <td className={`${r.td} ${r.name}`}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', columnGap: '8px' }}>
                      <PersonAvatar personId={p.personId} photoUpdatedAt={p.photoUpdatedAt} name={p.fullName} size={26} />
                      {p.fullName}
                    </span>
                  </td>
                  <td className={r.td}>{p.currentTeam ?? '—'}</td>
                  <td className={r.td}>
                    <StatusBadge variant={p.isActive ? 'ready' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={r.count}>
            {shown.length} {shown.length === 1 ? 'person' : 'people'}
            {isFiltered ? ` of ${people.length}` : ''}
          </div>
        </>
      )}
    </div>
  );
}
