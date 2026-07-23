import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
import { ApiError } from '../api';
import { useNotify } from '../session';
import { PersonAvatar, GovernedAction } from '../tablework';

/**
 * PersonPhotoControl — the headshot on the person profile, with the ops
 * upload / replace / remove affordances beside it. Mirrors DocumentsSection:
 * the API enforces the write gate (owner/operations); canManage only mirrors it
 * so read-only roles see the photo but no controls. Set/remove are
 * direct-audited on the person trail; invalidation refreshes the person, the
 * roster, and the history timeline.
 */

export function PersonPhotoControl({
  personId,
  name,
  photoUpdatedAt,
  canManage,
}: {
  personId: string;
  name: string;
  photoUpdatedAt: string | null | undefined;
  canManage: boolean;
}) {
  const { notify } = useNotify();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['person', personId] });
    void qc.invalidateQueries({ queryKey: ['personAudit', personId] });
    void qc.invalidateQueries({ queryKey: ['people'] });
  };

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadPersonPhoto(personId, file);
      notify('success', 'Photo updated.');
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="identity-photo-control" data-testid="person-photo-control">
      <PersonAvatar personId={personId} photoUpdatedAt={photoUpdatedAt} name={name} size={72} />
      {canManage && (
        <div className="panel-actions">
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            onChange={(e) => void onPick(e.target.files)}
            data-testid="person-photo-input"
          />
          <button className="secondary-action" type="button" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="person-photo-upload">
            {busy ? 'Uploading…' : photoUpdatedAt ? 'Replace photo…' : 'Upload photo…'}
          </button>
          {photoUpdatedAt && (
            <GovernedAction
              triggerLabel="Remove"
              triggerTestId="person-photo-remove"
              triggerAppearance="secondary"
              title="Remove this photo?"
              description="The headshot is removed immediately and the change is recorded on the person's history. The stored image is retained for the audit trail but is no longer reachable."
              confirmLabel="Remove photo"
              onConfirm={async () => {
                try {
                  await api.removePersonPhoto(personId);
                  notify('success', 'Photo removed.');
                  invalidate();
                } catch (err) {
                  notify('error', err instanceof ApiError ? err.message : 'The action failed.');
                  throw err instanceof Error ? err : new Error('failed');
                }
              }}
            />
          )}
          {!photoUpdatedAt && <span className="record-quiet">PNG, JPEG, or WEBP · up to 8 MB.</span>}
        </div>
      )}
    </div>
  );
}
