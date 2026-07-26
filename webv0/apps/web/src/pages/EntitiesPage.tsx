import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CURRENCY_CODES } from '@c3web/api-contracts';
import { suggestEntityCode } from '@c3web/domain';
import { useEntities } from '../queries';
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
  Selector,
  FormDrawer,
  GovernedAction,
} from '../tablework';

/**
 * Entities (S48) — the tenant company's own legal operating entities per
 * jurisdiction (e.g. a UAE company, a KSA company), on the Tablework frame
 * (pivot W2 Lane A; behaviour, testids and copy verbatim). People are assigned
 * to the one they signed with; agreements sit under one. Direct-audited CRUD
 * (owner/operations), the mission-shell pattern. Finance specifics (banking,
 * per-diem, money) are deliberately out of scope until the finance session.
 */

interface EditState {
  name: string;
  code: string;
  jurisdiction: string;
  registrationId: string;
  localCurrency: string;
}

// NOT a kit gap — deliberately UNMARKED. GovernedAction already wraps `extra` in
// `.governed-extra` (a grid with a token gap), so the kit DOES cover this stack.
// This wrapper is pre-pivot screen code that survived the conversion verbatim; it
// is redundant layout (8px instead of --c3-space-3), not a workaround.
const DIALOG_FIELDS: React.CSSProperties = { display: 'flex', flexDirection: 'column', rowGap: '8px' };
const CURRENCY_OPTIONS = CURRENCY_CODES.map((c) => ({ value: c, label: c }));

export function EntitiesPage() {
  return (
    <TableworkPage record="Entities" section="Register" wide>
      <EntitiesRegister />
    </TableworkPage>
  );
}

function EntitiesRegister() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canManage = me?.capabilities.canManageEntities ?? false;
  const { data, isLoading, isError, error } = useEntities();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [jurisdiction, setJurisdiction] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [localCurrency, setLocalCurrency] = useState('USD');
  // NO-TOUCH: the `edit` record is never cleared, and the double-spread seeding
  // order below is deliberate. Both are existing behaviour, not defects.
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
      () =>
        api.createEntity({
          name: name.trim(),
          code: code.trim() || undefined,
          jurisdiction: jurisdiction.trim(),
          registrationId: registrationId.trim() || undefined,
          localCurrency,
        }),
      'Entity created and recorded.',
    );
    setShowForm(false);
    setName('');
    setCode('');
    setCodeTouched(false);
    setJurisdiction('');
    setRegistrationId('');
    setLocalCurrency('USD');
  }

  function editStateFor(id: string, e: { name: string; code: string | null; jurisdiction: string; registrationId: string | null; localCurrency: string }): EditState {
    return edit[id] ?? { name: e.name, code: e.code ?? '', jurisdiction: e.jurisdiction, registrationId: e.registrationId ?? '', localCurrency: e.localCurrency };
  }

  const ready = name.trim() !== '' && jurisdiction.trim() !== '';

  const addAction = canManage ? (
    <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="add-entity-toggle">
      Add entity
    </button>
  ) : undefined;

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title="Entities"
        count={data ? `${data.entities.length} in this view` : undefined}
        actions={addAction}
      >
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
                <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="entities-empty-add">
                  Add entity
                </button>
              ) : undefined
            }
          />
        )}
        {/* M2 — the count is stated ONCE, in CollectionFrame's header. The old
            `r.count` footer repeated it; no testid and no spec asserted it. */}
        {data && data.entities.length > 0 && (
          <ComparisonTable label="Entities register" testId="entities-table">
            <thead>
              <tr>
                <th>Entity</th>
                <th>Code</th>
                <th>Name</th>
                <th>Jurisdiction</th>
                <th>Currency</th>
                <th>Registration</th>
                <th>Status</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.entities.map((e) => {
                const es = editStateFor(e.entityId, e);
                return (
                  <tr key={e.entityId} data-testid={`entity-row-${e.entityId}`}>
                    {/* The entity id is NOT a link (there is no entity record
                        route), so RecordLink would be a lie. `.mono` styles the
                        CELL — putting it on the td is the honest port of the old
                        non-link `<span className={r.idLink}>`. */}
                    <td className="mono">{e.entityId}</td>
                    <td className="mono" data-testid={`entity-code-${e.entityId}`}>{e.code ?? '—'}</td>
                    <td>{e.name}</td>
                    <td>{e.jurisdiction}</td>
                    <td className="mono" data-testid={`entity-currency-${e.entityId}`}>{e.localCurrency}</td>
                    <td>{e.registrationId ?? '—'}</td>
                    <td>
                      <StatusBadge variant={e.isActive ? 'ready' : 'neutral'} data-testid={`entity-status-${e.entityId}`}>
                        {e.isActive ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                    {canManage && (
                      <td>
                        {e.isActive && (
                          <div className="row-actions">
                            <GovernedAction
                              triggerLabel="Edit…"
                              triggerTestId={`edit-entity-${e.entityId}`}
                              triggerAppearance="secondary"
                              title={`Edit ${e.entityId}?`}
                              description="Changes take effect immediately; what changed is recorded in the audit history."
                              extra={
                                <div style={DIALOG_FIELDS}>
                                  <Field label="Name" required>
                                    <Input
                                      value={es.name}
                                      onChange={(ev) => setEdit((c) => ({ ...c, [e.entityId]: { ...editStateFor(e.entityId, e), ...c[e.entityId], name: ev.target.value } }))}
                                      data-testid={`edit-entity-name-${e.entityId}`}
                                    />
                                  </Field>
                                  <Field label="Code (2–8 letters/digits; empty clears)">
                                    <Input
                                      value={es.code}
                                      onChange={(ev) => setEdit((c) => ({ ...c, [e.entityId]: { ...editStateFor(e.entityId, e), ...c[e.entityId], code: ev.target.value.toUpperCase() } }))}
                                      data-testid={`edit-entity-code-${e.entityId}`}
                                    />
                                  </Field>
                                  <Field label="Jurisdiction" required>
                                    <Input
                                      value={es.jurisdiction}
                                      onChange={(ev) => setEdit((c) => ({ ...c, [e.entityId]: { ...editStateFor(e.entityId, e), ...c[e.entityId], jurisdiction: ev.target.value } }))}
                                    />
                                  </Field>
                                  <Field label="Local currency">
                                    <Selector
                                      value={es.localCurrency}
                                      options={CURRENCY_OPTIONS}
                                      onSelect={(value) => setEdit((c) => ({ ...c, [e.entityId]: { ...editStateFor(e.entityId, e), ...c[e.entityId], localCurrency: value } }))}
                                    />
                                  </Field>
                                  <Field label="Registration / licence no.">
                                    <Input
                                      value={es.registrationId}
                                      onChange={(ev) => setEdit((c) => ({ ...c, [e.entityId]: { ...editStateFor(e.entityId, e), ...c[e.entityId], registrationId: ev.target.value } }))}
                                    />
                                  </Field>
                                </div>
                              }
                              confirmLabel="Save changes"
                              confirmDisabled={es.name.trim() === '' || es.jurisdiction.trim() === ''}
                              onConfirm={() =>
                                run(
                                  () =>
                                    // expectedVersion is read from the SERVER row (`e.version`),
                                    // never from the local edit map — that freshness is what turns
                                    // a rejected concurrent edit into a refusal, not an overwrite.
                                    api.updateEntity(e.entityId, {
                                      expectedVersion: e.version,
                                      name: es.name.trim(),
                                      code: es.code.trim() === '' ? null : es.code.trim(),
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
                        {!e.isActive && (
                          <div className="row-actions">
                            <GovernedAction
                              triggerLabel="Reactivate…"
                              triggerTestId={`reactivate-entity-${e.entityId}`}
                              triggerAppearance="secondary"
                              title={`Reactivate ${e.entityId}?`}
                              description="This takes effect immediately and is recorded. The entity becomes available for new assignments again."
                              confirmLabel="Reactivate"
                              onConfirm={() => run(() => api.reactivateEntity(e.entityId, e.version), `${e.entityId} reactivated and recorded.`)}
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
            <Input
              value={name}
              onChange={(ev) => {
                setName(ev.target.value);
                // C3 suggests a code from the name until the owner types their own.
                if (!codeTouched) setCode(suggestEntityCode(ev.target.value));
              }}
              data-testid="add-entity-name"
            />
          </Field>
          <Field label="Code" hint="Short code for invoice series (e.g. GKA → GKA-INV-2026-001). Suggested from the name — type your own to override. 2–8 letters/digits.">
            <Input
              value={code}
              onChange={(ev) => {
                setCode(ev.target.value.toUpperCase());
                setCodeTouched(true);
              }}
              data-testid="add-entity-code"
            />
          </Field>
          <Field label="Jurisdiction" required hint='e.g. "United Arab Emirates" or "KSA · Riyadh"'>
            <Input value={jurisdiction} onChange={(ev) => setJurisdiction(ev.target.value)} data-testid="add-entity-jurisdiction" />
          </Field>
          <Field label="Local currency" required hint="The entity's base currency — the default for money booked under it.">
            <Selector
              value={localCurrency}
              options={CURRENCY_OPTIONS}
              onSelect={(value) => setLocalCurrency(value)}
              data-testid="add-entity-currency"
            />
          </Field>
          <Field label="Registration / licence no.">
            <Input value={registrationId} onChange={(ev) => setRegistrationId(ev.target.value)} data-testid="add-entity-registration" />
          </Field>
        </FormDrawer>
      )}
    </>
  );
}
