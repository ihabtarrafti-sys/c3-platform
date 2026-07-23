import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMissions, useTeams } from '../queries';
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
  Field,
  Input,
  DateInput,
  Selector,
  FormDrawer,
  GovernedAction,
} from '../tablework';

/**
 * Missions (Sprint 39) — the register, on the Tablework frame (pivot W1-2;
 * the Fluent page's behavior, testids, and copy verbatim). The mission SHELL
 * is direct-audited (create here; edit/deactivate live on the mission page);
 * PARTICIPANT membership is governed and lives on the mission page too.
 */

export function MissionsPage() {
  return (
    <TableworkPage record="Missions" section="Register" wide>
      <MissionsRegister />
    </TableworkPage>
  );
}

function MissionsRegister() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useMissions();
  const teams = useTeams();
  const canManage = me?.capabilities.canManageMissions ?? false;

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [city, setCity] = useState('');
  const [gameTitle, setGameTitle] = useState('');
  const [teamId, setTeamId] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');

  async function submitCreate() {
    try {
      const res = await api.createMission({
        name: name.trim(),
        code: code.trim() || undefined,
        organizer: organizer.trim() || undefined,
        city: city.trim() || undefined,
        gameTitle: gameTitle.trim() || undefined,
        teamId: teamId || undefined,
        startsOn,
        endsOn: endsOn || undefined,
      });
      notify('success', `${res.mission.missionId} created and recorded.`);
      setShowForm(false);
      setName('');
      setCode('');
      setOrganizer('');
      setCity('');
      setGameTitle('');
      setStartsOn('');
      setEndsOn('');
      void qc.invalidateQueries({ queryKey: ['missions'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  const ready = name.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) && (endsOn === '' || endsOn >= startsOn);

  const canViewFinancials = me?.capabilities.canViewFinancials ?? false;
  const divisions = (teams.data?.teams ?? []).filter((x) => x.isActive && x.kind === 'GameDivision');
  const addAction = (
    <>
      {canViewFinancials && (
        <Link to="/missions/finance" data-testid="missions-finance-link">
          <span className="secondary-action">Finance view</span>
        </Link>
      )}
      {canManage && (
        <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="add-mission-toggle">
          Add mission
        </button>
      )}
    </>
  );

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title="Missions"
        count={data ? `${data.missions.length} in this view` : undefined}
        actions={addAction}
      >
        {isLoading && <LoadingState label="Loading missions…" />}
        {isError && (
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not load missions.'}
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
          />
        )}
        {data && data.missions.length === 0 && (
          <EmptyState
            data-testid="missions-empty"
            message="No missions yet."
            action={
              canManage ? (
                <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="missions-empty-add">
                  Add mission
                </button>
              ) : undefined
            }
          />
        )}
        {data && data.missions.length > 0 && (
          <>
            <ComparisonTable label="Missions register" testId="missions-table">
              <thead>
                <tr>
                  <th>Mission</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Game</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.missions.map((m) => (
                  <tr key={m.missionId} data-testid={`mission-row-${m.missionId}`}>
                    <td>
                      <Link to={`/missions/${m.missionId}`} data-testid={`mission-link-${m.missionId}`}>
                        {m.missionId}
                      </Link>
                    </td>
                    <td className="mono" data-testid={`mission-code-${m.missionId}`}>
                      {m.code ?? '—'}
                    </td>
                    <td>{m.name}</td>
                    <td>{m.gameTitle ?? '—'}</td>
                    <td>{m.startsOn}</td>
                    <td>{m.endsOn ?? '—'}</td>
                    <td>
                      <StatusBadge variant={m.isActive ? 'ready' : 'neutral'} data-testid={`mission-status-${m.missionId}`}>
                        {m.isActive ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ComparisonTable>
            <p className="collection-count">
              {data.missions.length} {data.missions.length === 1 ? 'mission' : 'missions'}
            </p>
          </>
        )}
      </CollectionFrame>

      {canManage && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow="New mission"
          mode="direct"
          intro="New missions are created immediately and recorded in the audit history."
          footer={
            <GovernedAction
              triggerLabel="Create mission"
              triggerTestId="add-mission-submit"
              triggerDisabled={!ready}
              title="Create this mission?"
              description="This takes effect immediately and is recorded in the audit history."
              confirmLabel="Create mission"
              onConfirm={submitCreate}
            />
          }
        >
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="add-mission-name" />
          </Field>
          <Field label="Tournament code" hint='The org’s join key across budgets, invoices and payouts — e.g. "SATR/2024/0001". Unique when set.'>
            <Input value={code} onChange={(e) => setCode(e.target.value)} data-testid="add-mission-code" />
          </Field>
          <Field label="Organizer" hint='e.g. "Saudi Esports Federation", "VSPN"'>
            <Input value={organizer} onChange={(e) => setOrganizer(e.target.value)} data-testid="add-mission-organizer" />
          </Field>
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} data-testid="add-mission-city" />
          </Field>
          <Field label="Game title">
            <Input value={gameTitle} onChange={(e) => setGameTitle(e.target.value)} data-testid="add-mission-game" />
          </Field>
          <Field label="Team (the division fielding this event)" hint="Optional — powers the per-team P&L">
            <Selector
              data-testid="add-mission-team"
              placeholder=""
              value={teamId}
              options={divisions.map((x) => ({ value: x.teamId, label: `${x.code} · ${x.name}` }))}
              onSelect={(value) => setTeamId(value)}
            />
          </Field>
          <Field label="Starts on" required>
            <DateInput value={startsOn} onChange={(e) => setStartsOn(e.target.value)} data-testid="add-mission-starts" />
          </Field>
          <Field label="Ends on">
            <DateInput value={endsOn} onChange={(e) => setEndsOn(e.target.value)} data-testid="add-mission-ends" />
          </Field>
        </FormDrawer>
      )}
    </>
  );
}
