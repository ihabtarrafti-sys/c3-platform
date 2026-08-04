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

/**
 * ⛔ CR-031, THE SECOND INDEPENDENT READER — the same shape as CR-012 before it.
 *
 * `apps/backup/src/freshness.ts` is the monitor's canonical module and this file
 * MIRRORS it, because apps are not cross-importable here. A mirror is a promise
 * that two implementations will be changed together, and CR-012 already collected
 * on that promise once: a fix applied only to the monitor left this tile telling
 * the owner a future-dated marker was healthy.
 *
 * ⇒ Extracted as a pure function so the mirror is TESTABLE without standing up an
 * S3 client. An untested mirror is the half of the pair that drifts, and until now
 * `createBackupStatusReader` had no test of its own at all.
 *
 * @returns the refusal reason, or null when the marker's subject is the expected one.
 */
export function refuseUnlessMarkerSubjectMatches(
  parsed: { environment?: unknown; mode?: unknown },
  expected: { environment: string; mode: string },
): string | null {
  for (const [field, want] of [
    ['environment', expected.environment],
    ['mode', expected.mode],
  ] as const) {
    const got = parsed[field];
    if (typeof got !== 'string' || got.length === 0) {
      return `latest-success marker does not name its ${field} — it cannot be confirmed to describe the ${want} backup this tile watches.`;
    }
    if (got !== want) {
      return `latest-success marker is for ${field}=${got}, but this tile watches ${field}=${want} — fresh evidence about a different subject is not evidence about this one.`;
    }
  }
  return null;
}

export function createBackupStatusReader(env: Env): () => Promise<BackupStatusView> {
  const cfg = env.backupStatus;
  if (!cfg) return async () => NOT_CONFIGURED;

  const s3 = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });

  return async (): Promise<BackupStatusView> => {
    /*
     * ⛔ CR-031 — AN UNBOUND TILE MUST NOT GO GREEN, AND IT REFUSES BEFORE IT READS.
     *
     * The marker names its own environment and mode; this reader ignored both, so a
     * genuine PRODUCTION marker would have made a STAGING tile healthy. The bucket was
     * the only separation, and a bucket is a deployment detail, not an assertion.
     *
     * ⚖️ The refusal happens BEFORE the fetch on purpose. Reading first would produce a
     * real `lastSuccessUtc` and a real `ageHours` that this function then has to decline
     * to trust — and numbers that exist are numbers someone eventually surfaces. There is
     * nothing worth computing when the answer cannot be interpreted.
     *
     * ⚠️ This costs a RED tile on any deployment that has R2 configured but not the
     * subject, which is the correct direction: it is a real misconfiguration, it is
     * fixed by setting two variables, and the alternative — booting green on unbound
     * evidence — is the failure this whole finding is about.
     */
    if (!cfg.expectedEnvironment || !cfg.expectedMode) {
      return {
        configured: true,
        healthy: false,
        lastSuccessUtc: null,
        ageHours: null,
        reason:
          'Backup-status monitoring cannot report health: BACKUP_STATUS_EXPECTED_ENVIRONMENT and/or ' +
          'BACKUP_STATUS_EXPECTED_MODE are unset, so there is nothing to check the marker against. ' +
          'A tile that does not know which backup it watches has not found that backup healthy.',
      };
    }

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
    let parsed: { lastSuccessUtc?: unknown; environment?: unknown; mode?: unknown };
    try {
      parsed = JSON.parse(body) as { lastSuccessUtc?: unknown; environment?: unknown; mode?: unknown };
      if (typeof parsed.lastSuccessUtc === 'string') lastSuccessUtc = parsed.lastSuccessUtc;
    } catch {
      return { configured: true, healthy: false, lastSuccessUtc: null, ageHours: null, reason: 'latest-success marker is not valid JSON.' };
    }

    const subjectRefusal = refuseUnlessMarkerSubjectMatches(parsed, {
      environment: cfg.expectedEnvironment,
      mode: cfg.expectedMode,
    });
    if (subjectRefusal) {
      return { configured: true, healthy: false, lastSuccessUtc: null, ageHours: null, reason: subjectRefusal };
    }
    if (!lastSuccessUtc || Number.isNaN(Date.parse(lastSuccessUtc))) {
      return { configured: true, healthy: false, lastSuccessUtc: null, ageHours: null, reason: 'latest-success marker has no valid lastSuccessUtc.' };
    }
    const ageExact = (Date.now() - Date.parse(lastSuccessUtc)) / 3_600_000;
    const ageHours = Math.floor(ageExact);
    // ⛔ CR-012, the SECOND independent reader — fixing only the monitor would
    // leave the Settings tile telling the owner a future-dated marker is
    // healthy. A marker from the future is untrustworthy, not fresh; 15 minutes
    // of clock skew is tolerated, beyond that the tile says what it sees.
    if (ageExact < -0.25) {
      return {
        configured: true,
        healthy: false,
        lastSuccessUtc,
        ageHours,
        reason: `latest-success timestamp is in the FUTURE (${lastSuccessUtc}) — an untrustworthy marker is not a fresh backup.`,
      };
    }
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
