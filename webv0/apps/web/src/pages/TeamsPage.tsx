import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Field, Input, Option } from '@fluentui/react-components';
import { suggestEntityCode } from '@c3web/domain';
import { useTeams } from '../queries';
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
 * Teams (S7) — the structure GK-Core runs its P&L on: game divisions (R6,
 * HOK — they field rosters and own tournament money) and departments
 * (Operations, Content). The short CODE is the reporting key and feeds the
 * structured person codes (R6/PL/007). Rosters and the per-team money view
 * live on each team's page.
 */

const KIND_LABEL: Record<string, string> = { GameDivision: 'Game division', Department: 'Department' };

export function TeamsPage() {
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageEntities ?? false;
  const { data, isLoading, isError, error } = useTeams();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [kind, setKind] = useState<'GameDivision' | 'Department'>('GameDivision');
  const [gameTitle, setGameTitle] = useState('');

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['teams'] });

  async function submitCreate() {
    try {
      await api.createTeam({
        name: name.trim(),
        code: code.trim(),
        kind,
        gameTitle: gameTitle.trim() === '' ? null : gameTitle.trim(),
      });
      notify('success', 'Team created and recorded.');
      invalidate();
      setShowForm(false);
      setName('');
      setCode('');
      setCodeTouched(false);
      setGameTitle('');
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The create failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  const ready = name.trim() !== '' && /^[A-Za-z0-9]{2,8}$/.test(code.trim());

  return (
    <div>
      <PageHeader
        kicker="Register"
        title="Teams"
        context={data ? `${data.teams.length} in this view` : undefined}
        actions={
          canManage ? (
            <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="add-team-toggle">
              Add team
            </Button>
          ) : undefined
        }
      />

      {canManage && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow="New team"
          mode="direct"
          intro="A game division fields rosters and owns tournament money; a department is staff structure. The CODE is the reporting key — it numbers person codes and heads every per-team report."
          footer={
            <GovernedAction
              triggerLabel="Create team"
              triggerTestId="add-team-submit"
              triggerDisabled={!ready}
              title="Create this team?"
              description="This takes effect immediately and is recorded in the audit history."
              confirmLabel="Create team"
              onConfirm={submitCreate}
            />
          }
        >
          <Field label="Name" required hint='e.g. "Rainbow Six" or "Operations"'>
            <Input
              value={name}
              onChange={(_, d) => {
                setName(d.value);
                if (!codeTouched) setCode(suggestEntityCode(d.value));
              }}
              data-testid="add-team-name"
            />
          </Field>
          <Field label="Code" required hint="2–8 letters/digits (R6, HOK, OPS) — unique, feeds person codes">
            <Input
              value={code}
              onChange={(_, d) => {
                setCode(d.value.toUpperCase());
                setCodeTouched(true);
              }}
              data-testid="add-team-code"
            />
          </Field>
          <Field label="Kind" required>
            <Dropdown
              value={KIND_LABEL[kind]}
              selectedOptions={[kind]}
              onOptionSelect={(_, d) => d.optionValue && setKind(d.optionValue as 'GameDivision' | 'Department')}
              data-testid="add-team-kind"
            >
              {(['GameDivision', 'Department'] as const).map((k) => (
                <Option key={k} value={k} text={KIND_LABEL[k]!}>
                  {KIND_LABEL[k]}
                </Option>
              ))}
            </Dropdown>
          </Field>
          {kind === 'GameDivision' && (
            <Field label="Game title (display)">
              <Input value={gameTitle} onChange={(_, d) => setGameTitle(d.value)} data-testid="add-team-game" />
            </Field>
          )}
        </FormDrawer>
      )}

      {isLoading && <LoadingState label="Loading teams…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load teams.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.teams.length === 0 && (
        <EmptyState
          data-testid="teams-empty"
          message="No teams yet. Divisions and departments make the org's structure — and its per-team P&L — first-class."
          action={
            canManage ? (
              <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="teams-empty-add">
                Add team
              </Button>
            ) : undefined
          }
        />
      )}
      {data && data.teams.length > 0 && (
        <table className={r.table} data-testid="teams-table" aria-label="Teams register">
          <thead>
            <tr>
              <th className={r.th}>Team</th>
              <th className={r.th}>Code</th>
              <th className={r.th}>Name</th>
              <th className={r.th}>Kind</th>
              <th className={r.th}>Game</th>
              <th className={r.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map((t) => (
              <tr key={t.teamId} className={r.row} data-testid={`team-row-${t.teamId}`}>
                <td className={r.td}>
                  <Link className={r.idLink} to={`/teams/${t.teamId}`} data-testid={`team-link-${t.teamId}`}>
                    {t.teamId}
                  </Link>
                </td>
                <td className={`${r.td} ${r.mono}`} data-testid={`team-code-${t.teamId}`}>{t.code}</td>
                <td className={`${r.td} ${r.name}`}>{t.name}</td>
                <td className={r.td}>{KIND_LABEL[t.kind] ?? t.kind}</td>
                <td className={r.td}>{t.gameTitle ?? '—'}</td>
                <td className={r.td}>
                  <StatusBadge variant={t.isActive ? 'ready' : 'neutral'} data-testid={`team-status-${t.teamId}`}>
                    {t.isActive ? 'Active' : 'Inactive'}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
