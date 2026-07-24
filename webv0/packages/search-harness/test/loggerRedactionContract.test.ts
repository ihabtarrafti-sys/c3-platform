import { Writable } from 'node:stream';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { loggerOptions } from '../../../apps/api/src/logger.js';

type RedactCensor = (value: unknown, path: string[]) => unknown;

function productionLoggerOptions() {
  return loggerOptions({
    nodeEnv: 'production',
    logLevel: 'info',
  } as Parameters<typeof loggerOptions>[0]);
}

function requestUrlCensor(): RedactCensor {
  const redact = productionLoggerOptions().redact as {
    readonly censor?: RedactCensor;
  };
  if (typeof redact.censor !== 'function') {
    throw new Error('production logger has no request-URL censor');
  }
  return redact.censor;
}

describe('H0 logger redaction enforcement contract', () => {
  it.each([
    [
      'the app-generated encoded term',
      'Jordan Reyes',
      '/api/v1/search?q=Jordan%20Reyes',
    ],
    [
      'the Neural-ruled term followed by a limit',
      'PER-0001',
      '/api/v1/search?q=PER-0001&limit=25',
    ],
  ] as const)('removes %s from the censored request target', (_label, term, url) => {
    const censor = requestUrlCensor();
    const censored = String(censor(url, ['req', 'url']));
    expect(censored).toContain('[REDACTED]');
    expect(censored).not.toContain(term);
    expect(censored).not.toContain(encodeURIComponent(term));
  });

  it('preserves the existing intake-token mask in direct and serialized production logs', async () => {
    const sentinel = 'HEARTH-INTAKE-TOKEN-7f3a91';
    const url = `/api/v1/intake/public/${sentinel}?next=1`;
    const expected =
      '/api/v1/intake/public/[REDACTED]?next=1';
    expect(requestUrlCensor()(url, ['req', 'url'])).toBe(expected);

    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(productionLoggerOptions(), sink);
    logger.info({ req: { url } }, 'intake request');
    await new Promise<void>((resolve) => sink.end(resolve));

    const output = chunks.join('');
    expect(output).toContain(`"url":"${expected}"`);
    expect(output).not.toContain(sentinel);
  });

  it('removes the real q term from serialized production logs and redacts credentials', async () => {
    const querySentinel = 'HEARTH SEARCH/+PII_7f3a91';
    const encodedQuerySentinel = encodeURIComponent(querySentinel);
    const authorizationSentinel = 'HEARTH_AUTH_8b429e';
    const cookieSentinel = 'HEARTH_COOKIE_1c570d';
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino(productionLoggerOptions(), sink);

    logger.info(
      {
        req: {
          url: `/api/v1/search?q=${encodedQuerySentinel}`,
          headers: {
            authorization: `Bearer ${authorizationSentinel}`,
            cookie: `sid=${cookieSentinel}`,
          },
        },
      },
      'request completed',
    );
    logger.info(
      {
        req: {
          url: `/api/v1/search?q=${encodedQuerySentinel}&limit=25`,
          headers: {
            authorization: `Bearer ${authorizationSentinel}`,
            cookie: `sid=${cookieSentinel}`,
          },
        },
      },
      'limited request completed',
    );
    await new Promise<void>((resolve) => sink.end(resolve));

    const records = chunks
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        readonly req: {
          readonly url: string;
          readonly headers: {
            readonly authorization: string;
            readonly cookie: string;
          };
        };
      });
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.req.url).toContain('[REDACTED]');
      expect(record.req.url).not.toContain(querySentinel);
      expect(record.req.url).not.toContain(encodedQuerySentinel);
      expect(record.req.headers.authorization).toBe('[REDACTED]');
      expect(record.req.headers.cookie).toBe('[REDACTED]');
    }
    const output = JSON.stringify(records);
    expect(output).not.toContain(querySentinel);
    expect(output).not.toContain(encodedQuerySentinel);
    expect(output).not.toContain(authorizationSentinel);
    expect(output).not.toContain(cookieSentinel);
  });

  it('enforces redaction across actual production Fastify terminal paths', async () => {
    const sentinel = 'HEARTH LOG/+PII_4c72@example.invalid';
    const encodedSentinel = encodeURIComponent(sentinel);
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const app = Fastify({
      loggerInstance: pino(productionLoggerOptions(), sink),
    });
    await app.register(rateLimit, {
      global: true,
      max: 1,
      timeWindow: '1 minute',
      keyGenerator: (request) =>
        String(request.headers['x-log-matrix-client'] ?? request.id),
    });
    app.addHook('preValidation', async (request, reply) => {
      if (!request.headers.authorization?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'UNAUTHENTICATED' });
      }
    });
    app.get<{
      Querystring: { q: string; limit?: number };
    }>(
      '/api/v1/search',
      {
        schema: {
          querystring: {
            type: 'object',
            required: ['q'],
            properties: {
              q: { type: 'string', minLength: 2 },
              limit: { type: 'integer' },
            },
          },
        },
      },
      async (request) => {
        const terminal = request.headers['x-log-matrix-terminal'];
        if (terminal === 'timeout') {
          throw Object.assign(new Error('synthetic request timeout'), {
            statusCode: 408,
          });
        }
        if (terminal === 'cancel') {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { results: [] };
      },
    );

    const request = (
      terminal: string,
      suffix = '',
      authorization = 'Bearer synthetic',
    ) =>
      app.inject({
        method: 'GET',
        url: `/api/v1/search?q=${encodedSentinel}${suffix}`,
        headers: {
          authorization,
          'x-log-matrix-client': terminal,
          'x-log-matrix-terminal': terminal,
        },
      });

    expect((await request('success')).statusCode).toBe(200);
    expect((await request('unauthenticated', '', '')).statusCode).toBe(401);
    expect((await request('rate-limit')).statusCode).toBe(200);
    expect((await request('rate-limit')).statusCode).toBe(429);
    expect((await request('timeout')).statusCode).toBe(408);

    const controller = new AbortController();
    const cancelled = app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${encodedSentinel}`,
      headers: {
        authorization: 'Bearer synthetic',
        'x-log-matrix-client': 'cancel',
        'x-log-matrix-terminal': 'cancel',
      },
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    await app.close();
    await new Promise<void>((resolve) => sink.end(resolve));

    const output = chunks.join('');
    expect(output).toContain('q=[REDACTED]');
    expect(output).not.toContain(sentinel);
    expect(output).not.toContain(encodedSentinel);
  });
});
