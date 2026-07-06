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

const result = evaluateFreshness(body, new Date(), threshold);
console.log(JSON.stringify({ event: 'monitor.result', ...result }));

// Emit a short summary line the workflow parses for the issue body.
console.log('FRESHNESS_STALE=' + (result.stale ? 'true' : 'false'));
console.log('FRESHNESS_REASON=' + result.reason);

process.exit(result.stale ? 1 : 0);
