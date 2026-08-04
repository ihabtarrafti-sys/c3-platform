/**
 * check-freshness.mjs — independent stale-backup monitor (GitHub Actions).
 *
 * Uses the READ-ONLY R2 monitor credential to fetch status/latest-success.json
 * ONLY. It never downloads or decrypts a database dump, never receives the
 * database URL, and never receives the encryption private key.
 *
 * Exit 0 = fresh. Exit 1 = stale/missing (the workflow opens/updates an issue).
 * Env: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID (read-only), R2_SECRET_ACCESS_KEY,
 *      optional STALE_THRESHOLD_HOURS (default 36).
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { evaluateFreshness } from '../src/freshness.ts';

const bucket = process.env.R2_BUCKET;
const threshold = Number(process.env.STALE_THRESHOLD_HOURS ?? '36');
if (!bucket) {
  console.error('Missing R2_BUCKET');
  process.exit(2);
}

/*
 * ⛔ CR-031 — THE MONITOR MUST STATE WHAT IT IS WATCHING, AND REFUSES WITHOUT IT.
 *
 * The marker names its own environment and mode. Until now this script ignored
 * both, so a genuine, fresh PRODUCTION marker would have satisfied this STAGING
 * monitor — the bucket is the only thing that separated them, and a bucket is a
 * deployment detail, not an assertion.
 *
 * ⚖️ NEITHER GETS A DEFAULT, INCLUDING `mode`. A default would make the common
 * case work and leave the discriminator unstated, which is the same hole with
 * better manners — and defaulting one of the two after writing "required, not
 * optional" into the module one file over would be the law surviving as a slogan.
 * The workflow supplies both explicitly.
 */
const environment = process.env.BACKUP_EXPECTED_ENVIRONMENT;
const mode = process.env.BACKUP_EXPECTED_MODE;
if (!environment || !mode) {
  console.error(
    'Missing BACKUP_EXPECTED_ENVIRONMENT and/or BACKUP_EXPECTED_MODE. A monitor that does not know ' +
      'which backup it is responsible for cannot report that backup healthy — refusing rather than ' +
      'accepting whatever marker happens to be in the bucket.',
  );
  process.exit(2);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  forcePathStyle: true,
});

let body = null;
try {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'status/latest-success.json' }));
  body = Buffer.from(await res.Body.transformToByteArray()).toString('utf8');
} catch (e) {
  // Missing marker => treated as stale by evaluateFreshness(null).
  console.error(JSON.stringify({ event: 'monitor.marker_unreadable', message: String(e?.name ?? e) }));
}

const result = evaluateFreshness(body, new Date(), { environment, mode, thresholdHours: threshold });
console.log(JSON.stringify({ event: 'monitor.result', ...result }));

// Emit a short summary line the workflow parses for the issue body.
console.log('FRESHNESS_STALE=' + (result.stale ? 'true' : 'false'));
console.log('FRESHNESS_REASON=' + result.reason);

process.exit(result.stale ? 1 : 0);
