import { createServer, type Server as HttpServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createDocumentStorage, R2_HTTP_HANDLER_OPTIONS } from '../src/storage';

describe('HARDEN-3.6 T5 — R2 request-timeout enforcement', () => {
  it('configures both the timeout and Smithy enforcement flag', () => {
    expect(R2_HTTP_HANDLER_OPTIONS).toMatchObject({
      connectionTimeout: 10_000,
      requestTimeout: 120_000,
      throwOnRequestTimeout: true,
    });
  });
});

describe('HARDEN-3.8 H2 — R2 listing progress fails closed', () => {
  it('raises on a real repeated continuation token without disclosing it', async () => {
    const prefix = '00000000-0000-4000-8000-000000000091/';
    const repeatedToken = 'opaque-cycle-a';
    const listTokens: Array<string | null> = [];
    const peer: HttpServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method !== 'GET' || url.searchParams.get('list-type') !== '2') {
        req.resume();
        res.writeHead(404).end();
        return;
      }
      const token = url.searchParams.get('continuation-token');
      listTokens.push(token);
      res.writeHead(200, { 'content-type': 'application/xml' });
      setTimeout(() => {
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
          `<Name>documents</Name><Prefix>${prefix}</Prefix><KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys>` +
          `<IsTruncated>true</IsTruncated><NextContinuationToken>${repeatedToken}</NextContinuationToken>` +
          `<Contents><Key>${prefix}straggler</Key><LastModified>2026-07-15T00:00:00.000Z</LastModified>` +
          `<ETag>&quot;etag&quot;</ETag><Size>1</Size><StorageClass>STANDARD</StorageClass></Contents>` +
          `</ListBucketResult>`,
        );
      }, 10);
    });
    await new Promise<void>((resolve, reject) => {
      peer.once('error', reject);
      peer.listen(0, '127.0.0.1', resolve);
    });

    const controller = new AbortController();
    let deadline: NodeJS.Timeout | undefined;
    try {
      const port = (peer.address() as { port: number }).port;
      const storage = createDocumentStorage({
        driver: 'r2', endpoint: `http://127.0.0.1:${port}`,
        accessKeyId: 'h2-access', secretAccessKey: 'h2-secret', bucket: 'documents',
      });
      let progressEvents = 0;
      type Outcome =
        | { readonly kind: 'resolved' }
        | { readonly kind: 'rejected'; readonly error: unknown }
        | { readonly kind: 'test-deadline' };
      const listing: Promise<Outcome> = storage.listKeys(prefix, {
        signal: controller.signal,
        onProgress: () => { progressEvents += 1; },
      }).then(
        () => ({ kind: 'resolved' } as const),
        (error: unknown) => ({ kind: 'rejected', error } as const),
      );
      const bounded = new Promise<Outcome>((resolve) => {
        deadline = setTimeout(() => resolve({ kind: 'test-deadline' }), 500);
      });
      const outcome = await Promise.race([listing, bounded]);
      if (outcome.kind === 'test-deadline') {
        controller.abort(new Error('cyclic-listing RED cleanup'));
      }
      await listing;

      expect(outcome.kind, 'cyclic pagination crossed the bounded test deadline').toBe('rejected');
      if (outcome.kind === 'rejected') {
        const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
        expect(message).toMatch(/repeated or cyclic continuation token/i);
        expect(message).not.toContain(repeatedToken);
      }
      expect(listTokens).toEqual([null, repeatedToken]);
      expect(progressEvents).toBe(1);
    } finally {
      if (deadline) clearTimeout(deadline);
      if (!controller.signal.aborted) controller.abort(new Error('cyclic-listing test cleanup'));
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    }
  }, 10_000);
});
