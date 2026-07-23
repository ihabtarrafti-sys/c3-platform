import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePeople, useEntities } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  SavedViews,
  PersonAvatar,
  Field,
  Input,
  Selector,
  Select,
  FormDrawer,
  GovernedAction,
} from '../tablework';

/**
 * The People register on the Tablework frame (pivot W1-1 — the first
 * converted screen; the Fluent page's behavior, testids, and copy verbatim).
 * The entity picker stays an in-page Selector (the e2e oracle drives its
 * role="option" rows + Escape); the spec-free filter dropdowns are native.
 */

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
  return (
    <TableworkPage record="People" section="Register" wide>
      <PeopleRegister />
    </TableworkPage>
  );
}

function PeopleRegister() {
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
    <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="add-person-toggle">
      Add person
    </button>
  ) : undefined;

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title="People"
        count={data ? `${shown.length} shown${isFiltered ? ` · ${people.length} total` : ''}` : undefined}
        actions={addAction}
        filters={
          data && data.people.length > 0 ? (
            <>
              <SavedViews register="people" currentState={view} onApply={(st) => setView(coerceView(st))} />
              <div className="collection-filters" data-testid="people-filters">
                <Field label="Search">
                  <Input value={view.q} placeholder="Name, IGN, or ID" onChange={(e) => patchView({ q: e.target.value })} data-testid="people-filter-search" />
                </Field>
                <Field label="Team">
                  <Select value={view.team} onChange={(e) => patchView({ team: e.target.value })} data-testid="people-filter-team">
                    <option value="">All teams</option>
                    {teamsPresent.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={view.status} onChange={(e) => patchView({ status: (e.target.value as PeopleStatus) || 'active' })} data-testid="people-filter-status">
                    <option value="active">Active</option>
                    <option value="all">All</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                </Field>
                <Field label="Sort">
                  <Select value={view.sort} onChange={(e) => patchView({ sort: (e.target.value as PeopleSort) || 'name' })} data-testid="people-filter-sort">
                    <option value="name">Full name</option>
                    <option value="id">Person ID</option>
                    <option value="team">Team</option>
                  </Select>
                </Field>
                {isFiltered && (
                  <button className="quiet-action" type="button" onClick={() => setView(DEFAULT_VIEW)} data-testid="people-filter-reset">
                    Reset
                  </button>
                )}
              </div>
            </>
          ) : undefined
        }
      >
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
                <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="people-empty-add">
                  Add person
                </button>
              ) : undefined
            }
          />
        )}
        {data && data.people.length > 0 && (
          <>
            <ComparisonTable label="People register" testId="people-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Full name</th>
                  <th>Team</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={4} data-testid="people-no-matches">
                      No people match this view.
                    </td>
                  </tr>
                )}
                {shown.map((p) => (
                  <tr key={p.personId} data-testid={`person-row-${p.personId}`}>
                    <td>
                      <Link to={`/people/${p.personId}`}>{p.personId}</Link>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', columnGap: 'var(--c3-space-2)' }}>
                        <PersonAvatar personId={p.personId} photoUpdatedAt={p.photoUpdatedAt} name={p.fullName} size={26} />
                        {p.fullName}
                      </span>
                    </td>
                    <td>{p.currentTeam ?? '—'}</td>
                    <td>
                      <StatusBadge variant={p.isActive ? 'ready' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ComparisonTable>
            <p className="collection-count">
              {shown.length} {shown.length === 1 ? 'person' : 'people'}
              {isFiltered ? ` of ${people.length}` : ''}
            </p>
          </>
        )}
      </CollectionFrame>

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
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="add-person-fullname" />
          </Field>
          <Field label="In-game name">
            <Input value={ign} onChange={(e) => setIgn(e.target.value)} data-testid="add-person-ign" />
          </Field>
          <Field label="Team">
            <Input value={team} onChange={(e) => setTeam(e.target.value)} data-testid="add-person-team" />
          </Field>
          {activeEntities.length > 0 && (
            <Field label="Signed with (entity)" hint="Which of your legal entities this person signed with.">
              <Selector
                data-testid="add-person-entity"
                placeholder="Not assigned"
                value={entityId}
                display={entityId ? entityLabel : undefined}
                options={[
                  { value: '', label: 'Not assigned' },
                  ...activeEntities.map((e) => ({ value: e.entityId, label: `${e.name} (${e.jurisdiction})` })),
                ]}
                onSelect={(value, label) => {
                  setEntityId(value);
                  setEntityLabel(value ? label : '');
                }}
              />
            </Field>
          )}
        </FormDrawer>
      )}
    </>
  );
}
