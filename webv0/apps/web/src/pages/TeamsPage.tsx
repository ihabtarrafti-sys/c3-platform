import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { suggestEntityCode } from '@c3web/domain';
import { useTeams } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
// The pivot (Wave 2, Lane B): the frozen kit carries API-identical ports of
// every piece this register uses — the import path IS the conversion for
// StatusBadge/EmptyState/ErrorState/LoadingState/FormDrawer/GovernedAction.
// CollectionFrame's header count is the SINGLE count line (M2); no footer.
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  RecordLink,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  Field,
  Input,
  Selector,
  FormDrawer,
  GovernedAction,
} from '../tablework';

/**
 * Teams (S7) — the structure GK-Core runs its P&L on: game divisions (R6,
 * HOK — they field rosters and own tournament money) and departments
 * (Operations, Content). The short CODE is the reporting key and feeds the
 * structured person codes (R6/PL/007). Rosters and the per-team money view
 * live on each team's page.
 */

const KIND_LABEL: Record<string, string> = { GameDivision: 'Game division', Department: 'Department' };

const KIND_OPTIONS = (['GameDivision', 'Department'] as const).map((k) => ({ value: k, label: KIND_LABEL[k]! }));

export function TeamsPage() {
  return (
    <TableworkPage record="Teams" section="Register">
      <TeamsRegister />
    </TableworkPage>
  );
}

function TeamsRegister() {
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
    <>
      <CollectionFrame
        kicker="Register"
        title="Teams"
        count={data ? `${data.teams.length} in this view` : undefined}
        actions={
          canManage ? (
            <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="add-team-toggle">
              Add team
            </button>
          ) : undefined
        }
      >
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
                <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="teams-empty-add">
                  Add team
                </button>
              ) : undefined
            }
          />
        )}
        {data && data.teams.length > 0 && (
          <ComparisonTable label="Teams register" testId="teams-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Code</th>
                <th>Name</th>
                <th>Kind</th>
                <th>Game</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((t) => (
                <tr key={t.teamId} data-testid={`team-row-${t.teamId}`}>
                  <td>
                    <RecordLink to={`/teams/${t.teamId}`} data-testid={`team-link-${t.teamId}`}>
                      {t.teamId}
                    </RecordLink>
                  </td>
                  <td className="mono" data-testid={`team-code-${t.teamId}`}>
                    {t.code}
                  </td>
                  <td>{t.name}</td>
                  <td>{KIND_LABEL[t.kind] ?? t.kind}</td>
                  <td>{t.gameTitle ?? '—'}</td>
                  <td>
                    <StatusBadge variant={t.isActive ? 'ready' : 'neutral'} data-testid={`team-status-${t.teamId}`}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </ComparisonTable>
        )}
      </CollectionFrame>

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
              onChange={(e) => {
                setName(e.target.value);
                if (!codeTouched) setCode(suggestEntityCode(e.target.value));
              }}
              data-testid="add-team-name"
            />
          </Field>
          <Field label="Code" required hint="2–8 letters/digits (R6, HOK, OPS) — unique, feeds person codes">
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setCodeTouched(true);
              }}
              data-testid="add-team-code"
            />
          </Field>
          <Field label="Kind" required>
            <Selector
              data-testid="add-team-kind"
              value={kind}
              options={KIND_OPTIONS}
              onSelect={(value) => setKind(value as 'GameDivision' | 'Department')}
            />
          </Field>
          {kind === 'GameDivision' && (
            <Field label="Game title (display)">
              <Input value={gameTitle} onChange={(e) => setGameTitle(e.target.value)} data-testid="add-team-game" />
            </Field>
          )}
        </FormDrawer>
      )}
    </>
  );
}
