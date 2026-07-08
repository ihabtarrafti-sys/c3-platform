import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input } from '@fluentui/react-components';
import { useMissions } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { FormDrawer } from '../components/FormDrawer';

/**
 * Missions (Sprint 39) — the register. The mission SHELL is direct-audited
 * (create here; edit/deactivate live on the mission page); PARTICIPANT
 * membership is governed and lives on the mission page too.
 */

export function MissionsPage() {
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useMissions();
  const canManage = me?.capabilities.canManageMissions ?? false;

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [gameTitle, setGameTitle] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');

  async function submitCreate() {
    try {
      const res = await api.createMission({
        name: name.trim(),
        gameTitle: gameTitle.trim() || undefined,
        startsOn,
        endsOn: endsOn || undefined,
      });
      notify('success', `${res.mission.missionId} created and recorded.`);
      setShowForm(false);
      setName('');
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

  const addAction = canManage ? (
    <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="add-mission-toggle">
      Add Mission
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader kicker="Register" title="Missions" context={data ? `${data.missions.length} in this view` : undefined} actions={addAction} />

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
            <Input value={name} onChange={(_, d) => setName(d.value)} data-testid="add-mission-name" />
          </Field>
          <Field label="Game title">
            <Input value={gameTitle} onChange={(_, d) => setGameTitle(d.value)} data-testid="add-mission-game" />
          </Field>
          <Field label="Starts on" required>
            <Input type="date" value={startsOn} onChange={(_, d) => setStartsOn(d.value)} data-testid="add-mission-starts" />
          </Field>
          <Field label="Ends on">
            <Input type="date" value={endsOn} onChange={(_, d) => setEndsOn(d.value)} data-testid="add-mission-ends" />
          </Field>
        </FormDrawer>
      )}

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
              <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="missions-empty-add">
                Add Mission
              </Button>
            ) : undefined
          }
        />
      )}
      {data && data.missions.length > 0 && (
        <>
          <table className={r.table} data-testid="missions-table" aria-label="Missions register">
            <thead>
              <tr>
                <th className={r.th}>Mission</th>
                <th className={r.th}>Name</th>
                <th className={r.th}>Game</th>
                <th className={r.th}>Starts</th>
                <th className={r.th}>Ends</th>
                <th className={r.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.missions.map((m) => (
                <tr key={m.missionId} className={r.row} data-testid={`mission-row-${m.missionId}`}>
                  <td className={r.td}>
                    <Link className={r.idLink} to={`/missions/${m.missionId}`} data-testid={`mission-link-${m.missionId}`}>
                      {m.missionId}
                    </Link>
                  </td>
                  <td className={`${r.td} ${r.name}`}>{m.name}</td>
                  <td className={r.td}>{m.gameTitle ?? '—'}</td>
                  <td className={r.td}>{m.startsOn}</td>
                  <td className={r.td}>{m.endsOn ?? '—'}</td>
                  <td className={r.td}>
                    <StatusBadge variant={m.isActive ? 'ready' : 'neutral'} data-testid={`mission-status-${m.missionId}`}>
                      {m.isActive ? 'Active' : 'Inactive'}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={r.count}>
            {data.missions.length} {data.missions.length === 1 ? 'mission' : 'missions'}
          </div>
        </>
      )}
    </div>
  );
}
