import { Link, useParams } from 'react-router-dom';
import {
  Badge,
  Card,
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
import { usePerson, usePersonAudit } from '../queries';
import { ApiError } from '../api';

const useStyles = makeStyles({
  card: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 24px', padding: '20px', maxWidth: '560px', marginBottom: '24px' },
  label: { color: tokens.colorNeutralForeground3 },
  back: { marginBottom: '12px', display: 'inline-block' },
});

export function PersonProfilePage() {
  const s = useStyles();
  const { personId = '' } = useParams();
  const { data, isLoading, isError, error } = usePerson(personId);
  const audit = usePersonAudit(personId);

  return (
    <div>
      <Link to="/people" className={s.back}>
        &larr; People
      </Link>
      {isLoading && <Spinner label="Loading person..." />}
      {isError && (
        <MessageBar intent={error instanceof ApiError && error.status === 404 ? 'warning' : 'error'}>
          <MessageBarBody data-testid="person-error">
            {error instanceof ApiError && error.status === 404 ? `No person ${personId} in your tenant.` : 'Could not load this person.'}
          </MessageBarBody>
        </MessageBar>
      )}
      {data && (
        <>
          <Title2 data-testid="person-title">{data.person.fullName}</Title2>
          <Card className={s.card}>
            <Text className={s.label}>Person ID</Text>
            <Text data-testid="person-id">{data.person.personId}</Text>
            <Text className={s.label}>In-game name</Text>
            <Text>{data.person.ign ?? '-'}</Text>
            <Text className={s.label}>Team</Text>
            <Text>{data.person.currentTeam ?? '-'}</Text>
            <Text className={s.label}>Status</Text>
            <Badge appearance="tint" color={data.person.isActive ? 'success' : 'informative'}>
              {data.person.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </Card>

          <Title2>History</Title2>
          {audit.data && audit.data.events.length > 0 ? (
            <Table aria-label="Person audit history" data-testid="person-audit">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>When</TableHeaderCell>
                  <TableHeaderCell>Action</TableHeaderCell>
                  <TableHeaderCell>Actor</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.data.events.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell>{new Date(e.at).toLocaleString()}</TableCell>
                    <TableCell>{e.action}</TableCell>
                    <TableCell>{e.actor}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Text>No audit history.</Text>
          )}
        </>
      )}
    </div>
  );
}
