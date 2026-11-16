import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import pino from 'pino';
import {
  REDACT_PATHS,
  REQUEST_ID_HEADER,
  buildLoggerParams,
  resolveRequestId,
} from './logger.config.js';

function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    res: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as ServerResponse,
  };
}

describe('resolveRequestId', () => {
  it('reuses a well-formed x-request-id and echoes it', () => {
    const { res, headers } = fakeRes();
    const req = { headers: { [REQUEST_ID_HEADER]: 'abc-123' } };
    expect(resolveRequestId(req as unknown as IncomingMessage, res)).toBe(
      'abc-123',
    );
    expect(headers[REQUEST_ID_HEADER]).toBe('abc-123');
  });

  it.each([undefined, '', 'has space', 'x'.repeat(129), 'line\nbreak'])(
    'generates a UUID when the header is %j',
    (value) => {
      const { res, headers } = fakeRes();
      const req = { headers: { [REQUEST_ID_HEADER]: value } };
      const id = resolveRequestId(req as unknown as IncomingMessage, res);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(headers[REQUEST_ID_HEADER]).toBe(id);
    },
  );
});

describe('buildLoggerParams', () => {
  it('pretty-prints only in development', () => {
    const dev = buildLoggerParams({
      NODE_ENV: 'development',
      LOG_LEVEL: 'debug',
    });
    const prod = buildLoggerParams({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    });
    expect(dev.pinoHttp).toMatchObject({
      transport: { target: 'pino-pretty' },
    });
    expect(prod.pinoHttp).toMatchObject({
      level: 'info',
      transport: undefined,
    });
  });

  it('skips health probes in HTTP logs', () => {
    const params = buildLoggerParams({ NODE_ENV: 'test', LOG_LEVEL: 'info' });
    const { ignore } = (
      params.pinoHttp as {
        autoLogging: { ignore: (req: { url?: string }) => boolean };
      }
    ).autoLogging;
    expect(ignore({ url: '/api/v1/health' })).toBe(true);
    expect(ignore({ url: '/api/v1/health/live' })).toBe(true);
    expect(ignore({ url: '/api/v1/provinces' })).toBe(false);
  });
});

describe('redaction', () => {
  it('censors sensitive fields at the top level and one level deep', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = pino(
      { redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
      stream,
    );

    logger.info(
      {
        password: 'p1',
        otp: '123456',
        body: { refreshToken: 'r1', pin: '0000' },
        req: { headers: { authorization: 'Bearer t', cookie: 'c=1' } },
        userId: 'u1',
      },
      'Something happened',
    );

    const output = lines.join('');
    for (const secret of ['p1', '123456', 'r1', '0000', 'Bearer t', 'c=1']) {
      expect(output).not.toContain(`"${secret}"`);
    }
    expect(output).toContain('"userId":"u1"');
  });
});
