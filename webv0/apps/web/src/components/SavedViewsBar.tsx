import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, makeStyles } from '@fluentui/react-components';
import { useSavedViews } from '../queries';
import { api } from '../apiClient';
import { ApiError } from '../api';
import { useNotify } from '../session';

/**
 * SavedViewsBar — the register-agnostic control for personal saved views. It
 * lists this user's views for a register, applies one on click (handing the
 * opaque `state` back to the parent, which owns the shape), saves the current
 * state under a name, and soft-removes a view. The parent decides what `state`
 * means; this component never interprets it. The active view is highlighted by
 * a structural equality check against the current state.
 */

const useStyles = makeStyles({
  bar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '0 0 14px' },
  label: { fontSize: '12px', color: 'var(--c3-ink-quiet)', fontFamily: 'var(--c3-font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '2px' },
  saveRow: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
  empty: { fontSize: '12px', color: 'var(--c3-ink-quiet)' },
});

export function SavedViewsBar({
  register,
  currentState,
  onApply,
}: {
  register: string;
  currentState: unknown;
  onApply: (state: unknown) => void;
}) {
  const s = useStyles();
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
    <div className={s.bar} data-testid="saved-views-bar">
      <span className={s.label}>Views</span>
      {views.length === 0 && <span className={s.empty}>None saved</span>}
      {views.map((v) => {
        const active = JSON.stringify(v.state) === currentJson;
        return (
          <span key={v.id} className={s.chip}>
            <Button
              size="small"
              appearance={active ? 'primary' : 'secondary'}
              onClick={() => onApply(v.state)}
              data-testid={`saved-view-apply-${v.id}`}
            >
              {v.name}
            </Button>
            <Button
              size="small"
              appearance="subtle"
              aria-label={`Remove view ${v.name}`}
              title={`Remove "${v.name}"`}
              onClick={() => void remove(v.id, v.name)}
              data-testid={`saved-view-remove-${v.id}`}
            >
              ✕
            </Button>
          </span>
        );
      })}
      {saving ? (
        <span className={s.saveRow}>
          <Input
            size="small"
            value={name}
            placeholder="View name"
            onChange={(_, d) => setName(d.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') setSaving(false);
            }}
            data-testid="save-view-name"
          />
          <Button size="small" appearance="primary" disabled={busy || name.trim() === ''} onClick={() => void save()} data-testid="save-view-confirm">
            Save
          </Button>
          <Button size="small" appearance="subtle" onClick={() => setSaving(false)} data-testid="save-view-cancel">
            Cancel
          </Button>
        </span>
      ) : (
        <Button size="small" appearance="secondary" onClick={() => setSaving(true)} data-testid="save-view-toggle">
          Save current view…
        </Button>
      )}
    </div>
  );
}
