/**
 * SavedViews.tsx — the register-agnostic saved-views bar on the Tablework
 * frame (pivot W1-1; the Fluent SavedViewsBar's logic + testids verbatim).
 * It lists this user's views for a register, applies one on click (handing
 * the opaque `state` back to the parent, which owns the shape), saves the
 * current state under a name, and soft-removes a view. The active view is a
 * structural equality check against the current state.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSavedViews } from '../queries';
import { api } from '../apiClient';
import { ApiError } from '../api';
import { useNotify } from '../session';

export function SavedViews({
  register,
  currentState,
  onApply,
}: {
  register: string;
  currentState: unknown;
  onApply: (state: unknown) => void;
}) {
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data } = useSavedViews(register);
  const views = data?.views ?? [];
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const currentJson = JSON.stringify(currentState);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['savedViews', register] });

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await api.createSavedView(register, trimmed, currentState);
      notify('success', `View "${trimmed}" saved.`);
      setName('');
      setSaving(false);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not save the view.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, viewName: string) {
    try {
      await api.removeSavedView(id);
      notify('success', `View "${viewName}" removed.`);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not remove the view.');
    }
  }

  return (
    <div className="saved-views" data-testid="saved-views-bar">
      <span className="saved-views-label">Views</span>
      {views.length === 0 && <span className="saved-views-empty">None saved</span>}
      {views.map((v) => {
        const active = JSON.stringify(v.state) === currentJson;
        return (
          <span key={v.id} className="saved-views-chip">
            <button
              type="button"
              className={active ? 'mini-action active' : 'mini-action'}
              onClick={() => onApply(v.state)}
              data-testid={`saved-view-apply-${v.id}`}
            >
              {v.name}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove view ${v.name}`}
              title={`Remove "${v.name}"`}
              onClick={() => void remove(v.id, v.name)}
              data-testid={`saved-view-remove-${v.id}`}
            >
              ✕
            </button>
          </span>
        );
      })}
      {saving ? (
        <span className="saved-views-save">
          <input
            type="text"
            value={name}
            placeholder="View name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') setSaving(false);
            }}
            data-testid="save-view-name"
          />
          <button type="button" className="primary-action" disabled={busy || name.trim() === ''} onClick={() => void save()} data-testid="save-view-confirm">
            Save
          </button>
          <button type="button" className="quiet-action" onClick={() => setSaving(false)} data-testid="save-view-cancel">
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" className="mini-action" onClick={() => setSaving(true)} data-testid="save-view-toggle">
          Save current view…
        </button>
      )}
    </div>
  );
}
