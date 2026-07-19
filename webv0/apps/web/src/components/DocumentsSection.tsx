import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, makeStyles } from '@fluentui/react-components';
import { useDocuments } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify } from '../session';
import { GovernedAction } from './GovernedAction';

/**
 * DocumentsSection (S4) — the owning record's paper: list, upload, download,
 * soft-remove. Mounted on Agreement / Mission / Person detail pages. The API
 * enforces the owning record's read gate and the owner/ops write gate; this
 * component only mirrors it (canManage hides the affordances).
 */

const useStyles = makeStyles({
  section: { marginTop: '32px' },
  h2Row: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', columnGap: '12px', flexWrap: 'wrap' },
  h2: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, color: 'var(--c3-ink-strong)', margin: '0 0 12px' },
  list: { display: 'flex', flexDirection: 'column', rowGap: '6px' },
  rowItem: {
    display: 'flex',
    alignItems: 'center',
    columnGap: '12px',
    padding: '10px 14px',
    border: '1px solid var(--c3-border-subtle)',
    borderRadius: 'var(--c3-radius)',
    backgroundColor: 'var(--c3-surface-elevated)',
  },
  name: { fontSize: '14px', color: 'var(--c3-ink-default)', overflowWrap: 'anywhere' },
  meta: { fontFamily: 'var(--c3-font-mono)', fontSize: '11.5px', color: 'var(--c3-ink-quiet)', whiteSpace: 'nowrap' },
  spacer: { flexGrow: 1 },
  empty: { fontSize: '13px', color: 'var(--c3-ink-quiet)' },
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsSection({ ownerType, ownerId, canManage }: { ownerType: string; ownerId: string; canManage: boolean }) {
  const s = useStyles();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading } = useDocuments(ownerType, ownerId);
  const docs = data?.documents ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['documents', ownerType, ownerId] });
    void qc.invalidateQueries({ queryKey: [`${ownerType.toLowerCase()}Audit`, ownerId] });
    void qc.invalidateQueries({ queryKey: ['missionAudit', ownerId] });
    void qc.invalidateQueries({ queryKey: ['agreementAudit', ownerId] });
    void qc.invalidateQueries({ queryKey: ['personAudit', ownerId] });
  };

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadDocument(ownerType, ownerId, file);
      notify('success', `"${file.name}" attached and recorded.`);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onDownload(documentId: string) {
    try {
      const { blob, fileName } = await api.downloadDocument(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The download failed.');
    }
  }

  return (
    <div className={s.section} data-testid="documents-panel">
      <div className={s.h2Row}>
        <h2 className={s.h2}>Documents</h2>
        {canManage && (
          <>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv,.txt"
              onChange={(e) => void onPick(e.target.files)}
              data-testid="document-file-input"
            />
            <Button appearance="secondary" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="attach-document">
              {busy ? 'Uploading…' : 'Attach file…'}
            </Button>
          </>
        )}
      </div>

      {isLoading && <span className={s.empty}>Loading documents…</span>}
      {!isLoading && docs.length === 0 && (
        <span className={s.empty} data-testid="documents-empty">
          No documents attached.
        </span>
      )}
      {docs.length > 0 && (
        <div className={s.list} data-testid="documents-list">
          {docs.map((d) => (
            <div key={d.documentId} className={s.rowItem} data-testid={`document-row-${d.documentId}`}>
              <span className={s.name}>
                {d.fileName}
                {d.label ? ` — ${d.label}` : ''}
              </span>
              <span className={s.meta}>{`${formatSize(d.sizeBytes)} · ${d.uploadedBy}`}</span>
              <span className={s.spacer} />
              <Button size="small" appearance="secondary" onClick={() => void onDownload(d.documentId)} data-testid={`download-document-${d.documentId}`}>
                Download
              </Button>
              {canManage && (
                <GovernedAction
                  triggerLabel="Remove…"
                  triggerTestId={`remove-document-${d.documentId}`}
                  triggerAppearance="secondary"
                  title={`Remove "${d.fileName}"?`}
                  description="The document disappears from this record immediately and the removal is recorded. The stored bytes are retained for the audit trail but are no longer reachable."
                  confirmLabel="Remove document"
                  onConfirm={async () => {
                    try {
                      await api.removeDocument(d.documentId, d.version);
                      notify('success', `"${d.fileName}" removed and recorded.`);
                      invalidate();
                    } catch (err) {
                      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
                      throw err instanceof Error ? err : new Error('failed');
                    }
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
