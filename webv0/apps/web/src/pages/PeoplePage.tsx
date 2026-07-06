import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Field, Input, Text, makeStyles } from '@fluentui/react-components';
import { usePeople } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', rowGap: '10px', maxWidth: '440px', padding: '16px', marginBottom: '20px' },
  formIntro: { fontSize: '13px', color: 'var(--c3-ink-70)' },
});

export function PeoplePage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = usePeople();
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [ign, setIgn] = useState('');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = me?.capabilities.canSubmitApproval ?? false;

  async function submit() {
    setBusy(true);
    try {
      const res = await api.submitAddPerson({ fullName, ign: ign || undefined, currentTeam: team || undefined });
      notify('success', `Submitted ${res.approval.approvalId} for approval. A person is not created until an owner executes it.`);
      setFullName('');
      setIgn('');
      setTeam('');
      setShowForm(false);
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Submission failed.');
    } finally {
      setBusy(false);
    }
  }

  const addAction = canSubmit ? (
    <Button appearance="primary" onClick={() => setShowForm((v) => !v)} data-testid="add-person-toggle">
      {showForm ? 'Cancel' : 'Add Person'}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader
        title="People"
        context={data ? `${data.people.length} in this view` : undefined}
        actions={addAction}
      />

      {canSubmit && showForm && (
        <Card className={s.form}>
          <Text className={s.formIntro}>
            New person requests go through approval — an owner must review and execute before the person exists.
          </Text>
          <Field label="Full name" required>
            <Input value={fullName} onChange={(_, d) => setFullName(d.value)} data-testid="add-person-fullname" />
          </Field>
          <Field label="In-game name">
            <Input value={ign} onChange={(_, d) => setIgn(d.value)} data-testid="add-person-ign" />
          </Field>
          <Field label="Team">
            <Input value={team} onChange={(_, d) => setTeam(d.value)} data-testid="add-person-team" />
          </Field>
          <Button appearance="primary" onClick={submit} disabled={busy || fullName.trim() === ''} data-testid="add-person-submit">
            {busy ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </Card>
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
              {data.people.map((p) => (
                <tr key={p.personId} className={r.row} data-testid={`person-row-${p.personId}`}>
                  <td className={r.td}>
                    <Link className={r.idLink} to={`/people/${p.personId}`}>
                      {p.personId}
                    </Link>
                  </td>
                  <td className={`${r.td} ${r.name}`}>{p.fullName}</td>
                  <td className={r.td}>{p.currentTeam ?? '—'}</td>
                  <td className={r.td}>
                    <StatusBadge variant={p.isActive ? 'ready' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={r.count}>
            {data.people.length} {data.people.length === 1 ? 'person' : 'people'}
          </div>
        </>
      )}
    </div>
  );
}
