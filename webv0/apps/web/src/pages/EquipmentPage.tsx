import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Field, Input, Option, makeStyles } from '@fluentui/react-components';
import type { UseQueryResult } from '@tanstack/react-query';
import { equipmentTransitionsFrom, nextEquipmentStatus, type EquipmentStatus, type EquipmentTransition } from '@c3web/domain';
import type { EquipmentCreateBody, EquipmentUpdateBody } from '../api';
import { equipmentStatusOf, EQUIPMENT_TRANSITION_LABEL } from '../labels';
import { usePeople } from '../queries';
import { ApiError } from '../api';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { FormDrawer } from '../components/FormDrawer';

/**
 * EquipmentPage (Sprint 38) — the shared register component behind Kit and
 * Apparel. Direct-audited CRUD: the dialogs are honest that the effect is
 * immediate and recorded. One component, two configurations (same philosophy
 * as the backend's generic use-case core).
 */

export interface EquipmentRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly size: string | null;
  readonly assignedPersonId: string | null;
  readonly status: EquipmentStatus;
  readonly isActive: boolean;
  readonly version: number;
}

export interface EquipmentPageConfig {
  readonly title: string;
  readonly itemNoun: string; // "kit item" / "apparel item"
  readonly testPrefix: string; // "kit" / "apparel"
  readonly capability: 'canManageKit' | 'canManageApparel';
  readonly queryKey: string;
  readonly useList: () => UseQueryResult<{ rows: EquipmentRow[] }>;
  readonly create: (body: EquipmentCreateBody) => Promise<unknown>;
  readonly update: (id: string, body: EquipmentUpdateBody) => Promise<unknown>;
  readonly deactivate: (id: string, expectedVersion: number) => Promise<unknown>;
  readonly transition: (id: string, action: EquipmentTransition, expectedVersion: number) => Promise<unknown>;
}

const useStyles = makeStyles({
  personSelect: { minWidth: '240px' },
  actionsCell: { display: 'flex', columnGap: '8px', flexWrap: 'wrap' },
  editFields: { display: 'flex', flexDirection: 'column', rowGap: '8px' },
});

function PersonPicker({
  value,
  label,
  onChange,
  testId,
  people,
}: {
  value: string;
  label: string;
  onChange: (id: string, label: string) => void;
  testId: string;
  people: Array<{ personId: string; fullName: string }>;
}) {
  const s = useStyles();
  return (
    <Dropdown
      className={s.personSelect}
      placeholder="Unassigned"
      value={label}
      selectedOptions={value ? [value] : []}
      onOptionSelect={(_, d) => onChange(d.optionValue ?? '', d.optionText ?? '')}
      data-testid={testId}
    >
      <Option value="" text="Unassigned">
        Unassigned
      </Option>
      {people.map((p) => (
        <Option key={p.personId} value={p.personId} text={`${p.fullName} (${p.personId})`}>
          {`${p.fullName} (${p.personId})`}
        </Option>
      ))}
    </Dropdown>
  );
}

export function EquipmentPage({ config }: { config: EquipmentPageConfig }) {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = config.useList();
  const canManage = me?.capabilities[config.capability] ?? false;
  const people = usePeople(canManage);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [size, setSize] = useState('');
  const [personId, setPersonId] = useState('');
  const [personLabel, setPersonLabel] = useState('');
  const [edit, setEdit] = useState<Record<string, { name: string; category: string; size: string; personId: string; personLabel: string }>>({});

  const invalidate = () => void qc.invalidateQueries({ queryKey: [config.queryKey] });

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
      () =>
        config.create({
          name: name.trim(),
          category: category.trim(),
          size: size.trim() || undefined,
          assignedPersonId: personId || undefined,
        }),
      `${config.title} item created and recorded.`,
    );
    setShowForm(false);
    setName('');
    setCategory('');
    setSize('');
    setPersonId('');
    setPersonLabel('');
  }

  function editStateFor(row: EquipmentRow) {
    return (
      edit[row.id] ?? {
        name: row.name,
        category: row.category,
        size: row.size ?? '',
        personId: row.assignedPersonId ?? '',
        personLabel: row.assignedPersonId ?? '',
      }
    );
  }

  const addAction = canManage ? (
    <Button appearance="primary" onClick={() => setShowForm(true)} data-testid={`add-${config.testPrefix}-toggle`}>
      {`Add ${config.title} Item`}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader kicker="Register" title={config.title} context={data ? `${data.rows.length} in this view` : undefined} actions={addAction} />

      {canManage && (
        <FormDrawer
          open={showForm}
          onClose={() => setShowForm(false)}
          eyebrow={`Add ${config.title.toLowerCase()} item`}
          mode="direct"
          intro={`New ${config.itemNoun}s are created immediately and recorded in the audit history.`}
          footer={
            <GovernedAction
              triggerLabel="Create item"
              triggerTestId={`add-${config.testPrefix}-submit`}
              triggerDisabled={name.trim() === '' || category.trim() === ''}
              title={`Create this ${config.itemNoun}?`}
              description="This takes effect immediately and is recorded in the audit history."
              confirmLabel="Create item"
              onConfirm={submitCreate}
            />
          }
        >
          <Field label="Name" required>
            <Input value={name} onChange={(_, d) => setName(d.value)} data-testid={`add-${config.testPrefix}-name`} />
          </Field>
          <Field label="Category" required>
            <Input value={category} onChange={(_, d) => setCategory(d.value)} data-testid={`add-${config.testPrefix}-category`} />
          </Field>
          <Field label="Size">
            <Input value={size} onChange={(_, d) => setSize(d.value)} data-testid={`add-${config.testPrefix}-size`} />
          </Field>
          <Field label="Assigned to">
            <PersonPicker
              value={personId}
              label={personLabel}
              onChange={(id, label) => {
                setPersonId(id);
                setPersonLabel(id ? label : '');
              }}
              testId={`add-${config.testPrefix}-person`}
              people={people.data?.people ?? []}
            />
          </Field>
        </FormDrawer>
      )}

      {isLoading && <LoadingState label={`Loading ${config.title.toLowerCase()}…`} />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : `Could not load ${config.title.toLowerCase()}.`}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.rows.length === 0 && (
        <EmptyState
          data-testid={`${config.testPrefix}-empty`}
          message={`No ${config.itemNoun}s yet.`}
          action={
            canManage ? (
              <Button appearance="primary" onClick={() => setShowForm(true)} data-testid={`${config.testPrefix}-empty-add`}>
                {`Add ${config.title} Item`}
              </Button>
            ) : undefined
          }
        />
      )}
      {data && data.rows.length > 0 && (
        <>
          <table className={r.table} data-testid={`${config.testPrefix}-table`} aria-label={`${config.title} register`}>
            <thead>
              <tr>
                <th className={r.th}>Item</th>
                <th className={r.th}>Name</th>
                <th className={r.th}>Category</th>
                <th className={r.th}>Size</th>
                <th className={r.th}>Assigned</th>
                <th className={r.th}>Fulfillment</th>
                <th className={r.th}>Status</th>
                {canManage && <th className={r.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const e = editStateFor(row);
                return (
                  <tr key={row.id} className={r.row} data-testid={`${config.testPrefix}-row-${row.id}`}>
                    <td className={r.td}>{row.id}</td>
                    <td className={`${r.td} ${r.name}`}>{row.name}</td>
                    <td className={r.td}>{row.category}</td>
                    <td className={r.td}>{row.size ?? '—'}</td>
                    <td className={r.td}>
                      {row.assignedPersonId ? (
                        <Link className={r.idLink} to={`/people/${row.assignedPersonId}`}>
                          {row.assignedPersonId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={r.td}>
                      {(() => {
                        const badge = equipmentStatusOf(row.status);
                        return (
                          <StatusBadge variant={badge.variant} data-testid={`${config.testPrefix}-fulfillment-${row.id}`}>
                            {badge.label}
                          </StatusBadge>
                        );
                      })()}
                    </td>
                    <td className={r.td}>
                      <StatusBadge variant={row.isActive ? 'ready' : 'neutral'} data-testid={`${config.testPrefix}-status-${row.id}`}>
                        {row.isActive ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                    {canManage && (
                      <td className={r.td}>
                        {row.isActive && (
                          <div className={s.actionsCell}>
                            {equipmentTransitionsFrom(row.status).map((action) => {
                              const label = EQUIPMENT_TRANSITION_LABEL[action] ?? action;
                              return (
                              <GovernedAction
                                key={action}
                                triggerLabel={label}
                                triggerTestId={`transition-${config.testPrefix}-${action}-${row.id}`}
                                triggerAppearance="secondary"
                                title={`${label} — ${row.id}?`}
                                description="This moves the item's fulfillment status. It takes effect immediately and is recorded in the audit history."
                                confirmLabel={label}
                                onConfirm={() => {
                                  const to = nextEquipmentStatus(action, row.status);
                                  const toLabel = to ? equipmentStatusOf(to).label.toLowerCase() : 'updated';
                                  return run(() => config.transition(row.id, action, row.version), `${row.id} is now ${toLabel}. Recorded.`);
                                }}
                              />
                              );
                            })}
                            <GovernedAction
                              triggerLabel="Edit…"
                              triggerTestId={`edit-${config.testPrefix}-${row.id}`}
                              triggerAppearance="secondary"
                              title={`Edit ${row.id}?`}
                              description="Changes take effect immediately; what changed is recorded in the audit history."
                              extra={
                                <div className={s.editFields}>
                                  <Field label="Name" required>
                                    <Input
                                      value={e.name}
                                      onChange={(_, d) => setEdit((c) => ({ ...c, [row.id]: { ...editStateFor(row), ...c[row.id], name: d.value } }))}
                                      data-testid={`edit-${config.testPrefix}-name-${row.id}`}
                                    />
                                  </Field>
                                  <Field label="Category" required>
                                    <Input
                                      value={e.category}
                                      onChange={(_, d) => setEdit((c) => ({ ...c, [row.id]: { ...editStateFor(row), ...c[row.id], category: d.value } }))}
                                    />
                                  </Field>
                                  <Field label="Size">
                                    <Input
                                      value={e.size}
                                      onChange={(_, d) => setEdit((c) => ({ ...c, [row.id]: { ...editStateFor(row), ...c[row.id], size: d.value } }))}
                                    />
                                  </Field>
                                  <Field label="Assigned to">
                                    <PersonPicker
                                      value={e.personId}
                                      label={e.personLabel}
                                      onChange={(id, label) =>
                                        setEdit((c) => ({ ...c, [row.id]: { ...editStateFor(row), ...c[row.id], personId: id, personLabel: id ? label : '' } }))
                                      }
                                      testId={`edit-${config.testPrefix}-person-${row.id}`}
                                      people={people.data?.people ?? []}
                                    />
                                  </Field>
                                </div>
                              }
                              confirmLabel="Save changes"
                              confirmDisabled={e.name.trim() === '' || e.category.trim() === ''}
                              onConfirm={() =>
                                run(
                                  () =>
                                    config.update(row.id, {
                                      expectedVersion: row.version,
                                      name: e.name.trim(),
                                      category: e.category.trim(),
                                      size: e.size.trim() === '' ? null : e.size.trim(),
                                      assignedPersonId: e.personId === '' ? null : e.personId,
                                    }),
                                  `${row.id} updated and recorded.`,
                                )
                              }
                            />
                            <GovernedAction
                              triggerLabel="Deactivate…"
                              triggerTestId={`deactivate-${config.testPrefix}-${row.id}`}
                              triggerAppearance="secondary"
                              title={`Deactivate ${row.id}?`}
                              description="This takes effect immediately and is recorded. Retired items stay retired."
                              confirmLabel="Deactivate"
                              onConfirm={() => run(() => config.deactivate(row.id, row.version), `${row.id} deactivated and recorded.`)}
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
            {data.rows.length} {data.rows.length === 1 ? 'item' : 'items'}
          </div>
        </>
      )}
    </div>
  );
}
