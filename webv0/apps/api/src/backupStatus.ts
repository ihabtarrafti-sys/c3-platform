/**
 * backupStatus.ts — Tier 0.5: the Settings tile's one honest question, "when
 * did the last backup succeed?". Reads ONLY status/latest-success.json (the
 * marker the backup cron already writes) with a read-only credential — never
 * lists, downloads, or decrypts dumps. No config → { configured: false },
 * stated honestly.
 *
 * The staleness evaluation mirrors apps/backup/src/freshness.ts (the GitHub
 * monitor's canonical module, 36h threshold) — apps are not cross-importable,
 * so the ~15 lines are duplicated here rather than restructuring workspaces.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Env } from './env';

export const BACKUP_STALE_THRESHOLD_HOURS = 36;

export interface BackupStatusView {
  readonly configured: boolean;
  readonly healthy: boolean | null;
  readonly lastSuccessUtc: string | null;
  readonly ageHours: number | null;
  readonly reason: string | null;
}

const NOT_CONFIGURED: BackupStatusView = {
  configured: false,
  healthy: null,
  lastSuccessUtc: null,
  ageHours: null,
  reason: 'Backup-status monitoring is not configured on this API (BACKUP_STATUS_* env).',
};

export function createBackupStatusReader(env: Env): () => Promise<BackupStatusView> {
  const cfg = env.backupStatus;
  if (!cfg) return async () => NOT_CONFIGURED;

  const s3 = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });

  return async (): Promise<BackupStatusView> => {
    let body: string;
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: 'status/latest-success.json' }));
      body = (await res.Body?.transformToString()) ?? '';
    } catch {
      return {
        configured: true,
        healthy: false,
        lastSuccessUtc: null,
        ageHours: null,
        reason: 'No latest-success marker readable (no successful backup recorded, or the credential cannot reach it).',
      };
    }
    let lastSuccessUtc: string | null = null;
    try {
      const parsed = JSON.parse(body) as { lastSuccessUtc?: unknown };
      if (typeof parsed.lastSuccessUtc === 'string') lastSuccessUtc = parsed.lastSuccessUtc;
    } catch {
      return { configured: true, healthy: false, lastSuccessUtc: null, ageHours: null, reason: 'latest-success marker is not valid JSON.' };
    }
    if (!lastSuccessUtc || Number.isNaN(Date.parse(lastSuccessUtc))) {
      return { configured: true, healthy: false, lastSuccessUtc: null, ageHours: null, reason: 'latest-success marker has no valid lastSuccessUtc.' };
    }
    const ageHours = Math.floor((Date.now() - Date.parse(lastSuccessUtc)) / 3_600_000);
    const stale = ageHours >= BACKUP_STALE_THRESHOLD_HOURS;
    return {
      configured: true,
      healthy: !stale,
      lastSuccessUtc,
      ageHours,
      reason: stale ? `No successful backup in ${ageHours}h (threshold ${BACKUP_STALE_THRESHOLD_HOURS}h).` : null,
    };
  };
}
