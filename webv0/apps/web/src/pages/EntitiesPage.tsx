import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Field, Input, Option } from '@fluentui/react-components';
import { CURRENCY_CODES } from '@c3web/api-contracts';
import { useEntities } from '../queries';
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
 * Entities (S48) — the tenant company's own legal operating entities per
 * jurisdiction (e.g. a UAE company, a KSA company). People are assigned to the
 * one they signed with; agreements sit under one. Direct-audited CRUD
 * (owner/operations), the mission-shell pattern. Finance specifics (banking,
 * per-diem, money) are deliberately out of scope until the finance session.
 */

interface EditState {
  name: string;
  jurisdiction: string;
  registrationId: string;
  localCurrency: string;
}

export function EntitiesPage() {
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageEntities ?? false;
  const { data, isLoading, isError, error } = useEntities();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [localCurrency, setLocalCurrency] = useState('USD');
  const [edit, setEdit] = useState<Record<string, EditState>>({});

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['entities'] });

  async function run<T>(fn: () => Promise<T>, successMessage: string): Promise<void> {
    try {
      await fn();
      notify('success', successMessage);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  async function submitCreate() {
    await run(
      () => api.createEntity({ name: name.trim(), jurisdiction: jurisdiction.trim(), registrationId: registrationId.trim() || undefined, localCurrency }),
      'Entity created and recorded.',
    );
    setShowForm(false);
    setName('');
    setJurisdiction('');
    setRegistrationId('');
    setLocalCurrency('USD');
  }

  function editStateFor(id: string, e: { name: string; jurisdiction: string; registrationId: string | null; localCurrency: string }): EditState {
    return edit[id] ?? { name: e.name, jurisdiction: e.jurisdiction, registrationId: e.registrationId ?? '', localCurrency: e.localCurrency };
  }

  const ready = name.trim() !== '' && jurisdiction.trim() !== '';

  const addAction = canManage ? (
    <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="add-entity-toggle">
      Add Entity
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader kicker="Register" title="Entities" context={data ? `${data.entities.length} in this view` : undefined} actions={addAction} />

      {canManage && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow="New entity"
          mode="direct"
          intro="A legal operating entity is created immediately and recorded in the audit history. People and agreements can then be assigned to it."
          footer={
            <GovernedAction
              triggerLabel="Create entity"
              triggerTestId="add-entity-submit"
              triggerDisabled={!ready}
              title="Create this entity?"
              description="This takes effect immediately and is recorded in the audit history."
              confirmLabel="Create entity"
              onConfirm={submitCreate}
            />
          }
        >
          <Field label="Name" required hint='e.g. "Geekay Esports FZ-LLC"'>
            <Input value={name} onChange={(_, d) => setName(d.value)} data-testid="add-entity-name" />
          </Field>
          <Field label="Jurisdiction" required hint='e.g. "United Arab Emirates" or "KSA · Riyadh"'>
            <Input value={jurisdiction} onChange={(_, d) => setJurisdiction(d.value)} data-testid="add-entity-jurisdiction" />
          </Field>
          <Field label="Local currency" required hint="The entity's base currency — the default for money booked under it.">
            <Dropdown
              value={localCurrency}
              selectedOptions={[localCurrency]}
              onOptionSelect={(_, d) => d.optionValue && setLocalCurrency(d.optionValue)}
              data-testid="add-entity-currency"
            >
              {CURRENCY_CODES.map((c) => (
                <Option key={c} value={c}>
                  {c}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label="Registration / licence no.">
            <Input value={registrationId} onChange={(_, d) => setRegistrationId(d.value)} data-testid="add-entity-registration" />
          </Field>
        </FormDrawer>
      )}

      {isLoading && <LoadingState label="Loading entities…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load entities.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.entities.length === 0 && (
        <EmptyState
          data-testid="entities-empty"
          message="No entities yet."
          action={
            canManage ? (
              <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="entities-empty-add">
                Add Entity
              </Button>
            ) : undefined
          }
        />
      )}
      {data && data.entities.length > 0 && (
        <>
          <table className={r.table} data-testid="entities-table" aria-label="Entities register">
            <thead>
              <tr>
                <th className={r.th}>Entity</th>
                <th className={r.th}>Name</th>
                <th className={r.th}>Jurisdiction</th>
                <th className={r.th}>Currency</th>
                <th className={r.th}>Registration</th>
                <th className={r.th}>Status</th>
                {canManage && <th className={r.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.entities.map((e) => {
                const es = editStateFor(e.entityId, e);
                return (
                  <tr key={e.entityId} className={r.row} data-testid={`entity-row-${e.entityId}`}>
                    <td className={r.td}>
                      <span className={r.idLink}>{e.entityId}</span>
                    </td>
                    <td className={`${r.td} ${r.name}`}>{e.name}</td>
                    <td className={r.td}>{e.jurisdiction}</td>
                    <td className={`${r.td} ${r.mono}`} data-testid={`entity-currency-${e.entityId}`}>{e.localCurrency}</td>
                    <td className={r.td}>{e.registrationId ?? '—'}</td>
                    <td className={r.td}>
                      <StatusBadge variant={e.isActive ? 'ready' : 'neutral'} data-testid={`entity-status-${e.entityId}`}>
                        {e.isActive ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                    {canManage && (
                      <td className={r.td}>
                        {e.isActive && (
                          <div style={{ display: 'flex', columnGap: '8px', flexWrap: 'wrap' }}>
                            <GovernedAction
                              triggerLabel="Edit…"
                              triggerTestId={`edit-entity-${e.entityId}`}
                              triggerAppearance="secondary"
                              title={`Edit ${e.entityId}?`}
                              description="Changes take effect immediately; what changed is recorded in the audit history."
                              extra={
                                <div style={{ display: 'flex', flexDirection: 'column', rowGap: '8px' }}>
                                  <Field label="Name" required>
                                    <Input
                                      value={es.name}
                                      onChange={(_, d) => setEdit((c) => ({ ...c, [e.entityId]: { ...editStateFor(e.entityId, e), ...c[e.entityId], name: d.value } }))}
                                      data-testid={`edit-entity-name-${e.entityId}`}
                                    />
                                  </Field>
                                  <Field label="Jurisdiction" required>
                                    <Input
                                      value={es.jurisdiction}
                                      onChange={(_, d) => setEdit((c) => ({ ...c, [e.entityId]: { ...editStateFor(e.entityId, e), ...c[e.entityId], jurisdiction: d.value } }))}
                                    />
                                  </Field>
                                  <Field label="Local currency">
                                    <Dropdown
                                      value={es.localCurrency}
                                      selectedOptions={[es.localCurrency]}
                                      onOptionSelect={(_, d) => d.optionValue && setEdit((c) => ({ ...c, [e.entityId]: { ...editStateFor(e.entityId, e), ...c[e.entityId], localCurrency: d.optionValue! } }))}
                                    >
                                      {CURRENCY_CODES.map((c) => (
                                        <Option key={c} value={c}>
                                          {c}
                                        </Option>
                                      ))}
                                    </Dropdown>
                                  </Field>
                                  <Field label="Registration / licence no.">
                                    <Input
                                      value={es.registrationId}
                                      onChange={(_, d) => setEdit((c) => ({ ...c, [e.entityId]: { ...editStateFor(e.entityId, e), ...c[e.entityId], registrationId: d.value } }))}
                                    />
                                  </Field>
                                </div>
                              }
                              confirmLabel="Save changes"
                              confirmDisabled={es.name.trim() === '' || es.jurisdiction.trim() === ''}
                              onConfirm={() =>
                                run(
                                  () =>
                                    api.updateEntity(e.entityId, {
                                      expectedVersion: e.version,
                                      name: es.name.trim(),
                                      jurisdiction: es.jurisdiction.trim(),
                                      registrationId: es.registrationId.trim() === '' ? null : es.registrationId.trim(),
                                      localCurrency: es.localCurrency,
                                    }),
                                  `${e.entityId} updated and recorded.`,
                                )
                              }
                            />
                            <GovernedAction
                              triggerLabel="Deactivate…"
                              triggerTestId={`deactivate-entity-${e.entityId}`}
                              triggerAppearance="secondary"
                              title={`Deactivate ${e.entityId}?`}
                              description="This takes effect immediately and is recorded. People and agreements already assigned keep their link."
                              confirmLabel="Deactivate"
                              onConfirm={() => run(() => api.deactivateEntity(e.entityId, e.version), `${e.entityId} deactivated and recorded.`)}
                            />
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={r.count}>
            {data.entities.length} {data.entities.length === 1 ? 'entity' : 'entities'}
          </div>
        </>
      )}
    </div>
  );
}
