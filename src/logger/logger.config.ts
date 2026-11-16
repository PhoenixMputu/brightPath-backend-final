import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../config/env.schema.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Health probes hit the API every few seconds: keep them out of HTTP logs. */
export const HTTP_LOG_IGNORED_PREFIX = '/api/v1/health';

/**
 * Sensitive fields, censored at the top level, one level deep (`body.password`,
 * `user.token`) and in the request/response headers. Add every new sensitive
 * field here.
 */
export const REDACTED_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'otp',
  'pin',
  'authorization',
  'cookie',
  'set-cookie',
] as const;

export const REDACT_PATHS = [
  ...REDACTED_FIELDS.flatMap((field) =>
    /^\w+$/.test(field)
      ? [field, `*.${field}`]
      : [`["${field}"]`, `*["${field}"]`],
  ),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/** Accepted inbound ids: short, no spaces or control characters. */
const REQUEST_ID_PATTERN = /^[\w.:-]{1,128}$/;

/**
 * Reuses the caller's `x-request-id` when it is well-formed, otherwise
 * generates one, and echoes it in the response header.
 */
export function resolveRequestId(
  req: IncomingMessage,
  res: ServerResponse,
): string {
  const header = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof header === 'string' && REQUEST_ID_PATTERN.test(header)
      ? header
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function buildLoggerParams(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      // JSON everywhere except local development (pino-pretty is a dev
      // dependency only).
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
      genReqId: resolveRequestId,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      autoLogging: {
        ignore: (req) => req.url?.startsWith(HTTP_LOG_IGNORED_PREFIX) ?? false,
      },
      // Only what is needed to trace a request: no headers, no body.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
