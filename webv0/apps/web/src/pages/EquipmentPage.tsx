import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { equipmentTransitionsFrom, nextEquipmentStatus, type EquipmentStatus, type EquipmentTransition } from '@c3web/domain';
import type { EquipmentCreateBody, EquipmentUpdateBody } from '../api';
import { equipmentStatusOf, EQUIPMENT_TRANSITION_LABEL } from '../labels';
import { usePeople } from '../queries';
import { ApiError } from '../api';
import { useNotify, useSession } from '../session';
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
 * EquipmentPage (Sprint 38) — the shared register component behind Kit and
 * Apparel, on the Tablework frame (pivot W3 Lane 3; behaviour, testids and
 * copy verbatim). Direct-audited CRUD: the dialogs are honest that the effect
 * is immediate and recorded. One component, two configurations (same
 * philosophy as the backend's generic use-case core).
 *
 * The frame lives HERE rather than in KitPage/ApparelPage because the record
 * band is `config.title` — the two configurations are the same screen, and
 * splitting the wrapper would duplicate that decision in two places.
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

// NOT a kit gap — deliberately UNMARKED, on the EntitiesPage precedent.
// GovernedAction already wraps `extra` in `.governed-extra` (a grid with a token
// gap), so the kit DOES cover this stack. This wrapper is pre-pivot screen code
// carried through the conversion verbatim; it is redundant layout (8px instead
// of --c3-space-3), not a workaround.
const DIALOG_FIELDS: React.CSSProperties = { display: 'flex', flexDirection: 'column', rowGap: '8px' };

function PersonPicker({
  value,
  label,
  onChange,
  testId,
  people,
  // `Field` clones its ONE child with these; PersonPicker sits between the two,
  // so it must pass them through or the <label htmlFor> points at nothing and
  // the hint/error association is lost. Every converted screen that puts a
  // Selector straight inside a Field gets this for free.
  ...injected
}: {
  value: string;
  label: string;
  onChange: (id: string, label: string) => void;
  testId: string;
  people: Array<{ personId: string; fullName: string }>;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  return (
    <Selector
      {...injected}
      // `wide` is the kit's answer to the old `minWidth: 240px` — a person
      // picker must hold "Full Name (PER-0001)" without an inline style.
      width="wide"
      placeholder="Unassigned"
      value={value}
      // `label || undefined` and not `label`: an explicit `display` is the
      // caller stating the trigger text outright, so passing the empty string
      // would print an EMPTY trigger where the Fluent Dropdown printed its
      // placeholder. Unset must fall through to "Unassigned".
      display={label || undefined}
      options={[{ value: '', label: 'Unassigned' }, ...people.map((p) => ({ value: p.personId, label: `${p.fullName} (${p.personId})` }))]}
      onSelect={(optionValue, optionLabel) => onChange(optionValue, optionLabel)}
      data-testid={testId}
    />
  );
}

export function EquipmentPage({ config }: { config: EquipmentPageConfig }) {
  return (
    <TableworkPage record={config.title} section="Register" wide>
      <EquipmentRegister config={config} />
    </TableworkPage>
  );
}

function EquipmentRegister({ config }: { config: EquipmentPageConfig }) {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = config.useList();
  const canManage = me?.capabilities[config.capability] ?? false;
  // THE WIRE LAW: the capability IS the react-query `enabled` flag. The people
  // list is fetched only for an actor who can assign — it must never become an
  // always-on fetch with the picker hidden.
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

  // NO-TOUCH: the `edit` record is never cleared, and the seeded label for an
  // already-assigned row is the person ID rather than the full name. Both are
  // existing behaviour carried verbatim, not defects.
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
    <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid={`add-${config.testPrefix}-toggle`}>
      {`Add ${config.title.toLowerCase()} item`}
    </button>
  ) : undefined;

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title={config.title}
        count={data ? `${data.rows.length} in this view` : undefined}
        actions={addAction}
      >
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
                <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid={`${config.testPrefix}-empty-add`}>
                  {`Add ${config.title.toLowerCase()} item`}
                </button>
              ) : undefined
            }
          />
        )}
        {/* M2 — the count is stated ONCE, in CollectionFrame's header. The old
            `r.count` footer repeated it; no testid and no spec asserted it. */}
        {data && data.rows.length > 0 && (
          <ComparisonTable label={`${config.title} register`} testId={`${config.testPrefix}-table`}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Name</th>
                <th>Category</th>
                <th>Size</th>
                <th>Assigned</th>
                <th>Fulfillment</th>
                <th>Status</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const e = editStateFor(row);
                return (
                  <tr key={row.id} data-testid={`${config.testPrefix}-row-${row.id}`}>
                    <td>{row.id}</td>
                    <td>{row.name}</td>
                    <td>{row.category}</td>
                    <td>{row.size ?? '—'}</td>
                    <td>
                      {row.assignedPersonId ? <RecordLink to={`/people/${row.assignedPersonId}`}>{row.assignedPersonId}</RecordLink> : '—'}
                    </td>
                    <td>
                      {(() => {
                        const badge = equipmentStatusOf(row.status);
                        return (
                          <StatusBadge variant={badge.variant} data-testid={`${config.testPrefix}-fulfillment-${row.id}`}>
                            {badge.label}
                          </StatusBadge>
                        );
                      })()}
                    </td>
                    <td>
                      <StatusBadge variant={row.isActive ? 'ready' : 'neutral'} data-testid={`${config.testPrefix}-status-${row.id}`}>
                        {row.isActive ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                    {canManage && (
                      <td>
                        {row.isActive && (
                          <div className="row-actions">
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
                                <div style={DIALOG_FIELDS}>
                                  <Field label="Name" required>
                                    <Input
                                      value={e.name}
                                      onChange={(ev) => setEdit((c) => ({ ...c, [row.id]: { ...editStateFor(row), ...c[row.id], name: ev.target.value } }))}
                                      data-testid={`edit-${config.testPrefix}-name-${row.id}`}
                                    />
                                  </Field>
                                  <Field label="Category" required>
                                    <Input
                                      value={e.category}
                                      onChange={(ev) => setEdit((c) => ({ ...c, [row.id]: { ...editStateFor(row), ...c[row.id], category: ev.target.value } }))}
                                    />
                                  </Field>
                                  <Field label="Size">
                                    <Input
                                      value={e.size}
                                      onChange={(ev) => setEdit((c) => ({ ...c, [row.id]: { ...editStateFor(row), ...c[row.id], size: ev.target.value } }))}
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
                                    // expectedVersion is read from the SERVER row (`row.version`),
                                    // never from the local edit map — that freshness is what turns
                                    // a rejected concurrent edit into a refusal, not an overwrite.
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
          </ComparisonTable>
        )}
      </CollectionFrame>

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
            <Input value={name} onChange={(ev) => setName(ev.target.value)} data-testid={`add-${config.testPrefix}-name`} />
          </Field>
          <Field label="Category" required>
            <Input value={category} onChange={(ev) => setCategory(ev.target.value)} data-testid={`add-${config.testPrefix}-category`} />
          </Field>
          <Field label="Size">
            <Input value={size} onChange={(ev) => setSize(ev.target.value)} data-testid={`add-${config.testPrefix}-size`} />
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
    </>
  );
}
