import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { usePeople } from '../queries';
import { api, ApiError } from '../api';
import { useNotify, useSession } from '../session';

const useStyles = makeStyles({
  head: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' },
  spacer: { flexGrow: 1 },
  form: { display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '420px', padding: '16px', marginBottom: '20px' },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function PeoplePage() {
  const s = useStyles();
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

  return (
    <div>
      <div className={s.head}>
        <Title2>People</Title2>
        <div className={s.spacer} />
        {canSubmit && (
          <Button appearance="primary" onClick={() => setShowForm((v) => !v)} data-testid="add-person-toggle">
            {showForm ? 'Cancel' : 'Add person'}
          </Button>
        )}
      </div>

      {canSubmit && showForm && (
        <Card className={s.form}>
          <Text>New person requests go through approval — an owner must review and execute before the person exists.</Text>
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
            {busy ? 'Submitting...' : 'Submit for approval'}
          </Button>
        </Card>
      )}

      {isLoading && <Spinner label="Loading people..." />}
      {isError && (
        <MessageBar intent="error">
          <MessageBarBody>{error instanceof ApiError ? error.message : 'Could not load people.'}</MessageBarBody>
        </MessageBar>
      )}
      {data && data.people.length === 0 && (
        <Text data-testid="people-empty" className={s.muted}>
          No people yet. {canSubmit ? 'Submit an AddPerson request to get started.' : ''}
        </Text>
      )}
      {data && data.people.length > 0 && (
        <Table data-testid="people-table" aria-label="People register">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Person ID</TableHeaderCell>
              <TableHeaderCell>Full name</TableHeaderCell>
              <TableHeaderCell>Team</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.people.map((p) => (
              <TableRow key={p.personId} data-testid={`person-row-${p.personId}`}>
                <TableCell>
                  <Link to={`/people/${p.personId}`}>{p.personId}</Link>
                </TableCell>
                <TableCell>{p.fullName}</TableCell>
                <TableCell>{p.currentTeam ?? '-'}</TableCell>
                <TableCell>
                  <Badge appearance="tint" color={p.isActive ? 'success' : 'informative'}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
