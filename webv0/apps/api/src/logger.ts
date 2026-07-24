import { pino, type Logger, type LoggerOptions } from 'pino';
import type { Env } from './env';

/**
 * M-09: the guest capability token rides in the intake public URL path
 * (/api/v1/intake/public/<token>) — a bearer-equivalent secret that must never
 * reach the logs. Header redaction alone misses it, so we mask the token
 * segment out of the logged URL. Scoped to the `public/` path so the staff
 * subpaths (/intake/links, /intake/submissions/...) are never over-masked.
 */
export function maskIntakeToken(url: string): string {
  return url.replace(/(\/intake\/public\/)[^/?#]+/g, '$1[REDACTED]');
}

/**
 * S3 search runs `GET /api/v1/search?q=<term>`, and the term can carry a
 * person's name or id — PII that must never reach the request logs (HEARTH-001
 * invariant 9). Fastify logs `req.url`, so mask the `q` value here. The value
 * is percent-encoded, so `&`/`#` inside a term arrive as `%26`/`%23`; `[^&#]*`
 * therefore captures the whole term up to the next REAL delimiter. Over-masking
 * a benign `q` is harmless — the only failure that matters is under-masking.
 */
export function maskSearchQuery(url: string): string {
  return url.replace(/([?&]q=)[^&#]*/g, '$1[REDACTED]');
}

/** Pino options used both for the standalone deps logger and the Fastify logger. */
export function loggerOptions(env: Env): LoggerOptions {
  return {
    level: env.nodeEnv === 'test' ? 'silent' : env.logLevel,
    // Never log credentials or tokens; request bodies (approval payloads,
    // identity claims) are not serialized by Fastify's default req logger. The
    // intake capability token (M-09) and the search `q` term (PII) in the URL
    // are masked by the censor.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'req.url'],
      censor: (value: unknown, path: string[]) =>
        path[path.length - 1] === 'url' && typeof value === 'string' ? maskSearchQuery(maskIntakeToken(value)) : '[REDACTED]',
    },
    ...(env.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  };
}

export function createLogger(env: Env): Logger {
  return pino(loggerOptions(env));
}
