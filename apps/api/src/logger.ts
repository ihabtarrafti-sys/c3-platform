import { pino, type Logger, type LoggerOptions } from 'pino';
import type { Env } from './env';

/** Pino options used both for the standalone deps logger and the Fastify logger. */
export function loggerOptions(env: Env): LoggerOptions {
  return {
    level: env.nodeEnv === 'test' ? 'silent' : env.logLevel,
    // Never log credentials or tokens; request bodies (approval payloads,
    // identity claims) are not serialized by Fastify's default req logger.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization'],
      censor: '[REDACTED]',
    },
    ...(env.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  };
}

export function createLogger(env: Env): Logger {
  return pino(loggerOptions(env));
}
