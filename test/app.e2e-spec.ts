import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/**
 * Boots the real AppModule (config validation, logger, filters, throttler,
 * cache, controllers) with in-memory fakes for the database and Redis, so the
 * suite needs no external service.
 */

// Set before AppModule is imported: ConfigModule validates the env on load.
// Real env vars win over .env, so a local .env does not leak into the suite.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/e2e',
  REDIS_URL: 'redis://localhost:6379',
  RESEND_API_KEY: 're_e2e',
  MAIL_FROM: 'BrightPath <noreply@example.com>',
  CORS_ORIGINS: 'http://localhost:3000',
});

const { AppModule } = await import('../src/app.module.js');
const { configureApp } = await import('../src/app.setup.js');
const { PrismaService } = await import('../src/prisma/prisma.service.js');
const { REDIS_CLIENT } = await import('../src/redis/redis.constants.js');

interface Province {
  id: string;
  name: string;
}

/** Just enough of the Prisma client for the province and health routes. */
function fakePrisma(rows: Province[]) {
  const matches = (where: { name?: { contains: string } }) => (p: Province) =>
    !where.name ||
    p.name.toLowerCase().includes(where.name.contains.toLowerCase());
  return {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    province: {
      create: vi.fn(({ data }: { data: { name: string } }) => {
        const row = { id: `id-${rows.length + 1}`, name: data.name };
        rows.push(row);
        return Promise.resolve(row);
      }),
      count: vi.fn(({ where }) =>
        Promise.resolve(rows.filter(matches(where)).length),
      ),
      findMany: vi.fn(({ where, skip, take }) =>
        Promise.resolve(
          rows
            .filter(matches(where))
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(skip, skip + take),
        ),
      ),
    },
  };
}

/** Map-backed Redis with the commands the app uses. TTLs are not simulated. */
function fakeRedis() {
  const store = new Map<string, string>();
  const incr = (key: string) => {
    const next = Number(store.get(key) ?? '0') + 1;
    store.set(key, String(next));
    return next;
  };
  return {
    store,
    status: 'ready',
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    // Throttler script: [totalHits, ttlMs, isBlocked, blockTtlMs].
    eval: vi.fn((_script: string, _n: number, hitsKey: string) =>
      Promise.resolve([incr(hitsKey), 60_000, 0, 0]),
    ),
    multi: vi.fn(() => {
      const ops: Array<() => unknown> = [];
      const chain = {
        incr: (key: string) => (ops.push(() => incr(key)), chain),
        expire: () => (ops.push(() => 1), chain),
        exec: () => Promise.resolve(ops.map((op) => [null, op()])),
      };
      return chain;
    }),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
  };
}

describe('Provinces (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof fakePrisma>;
  let redis: ReturnType<typeof fakeRedis>;

  beforeEach(async () => {
    prisma = fakePrisma([
      { id: 'id-1', name: 'Kinshasa' },
      { id: 'id-2', name: 'Kasaï' },
    ]);
    redis = fakeRedis();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1/health reports the database and Redis as up', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body.details).toEqual({
      database: { status: 'up' },
      redis: { status: 'up' },
    });
  });

  it('GET /api/v1/provinces lists, searches and caches pages', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/v1/provinces?search=kin')
      .expect(200);

    expect(first.body).toMatchObject({
      message: 'Provinces retrieved successfully.',
      data: [{ id: 'id-1', name: 'Kinshasa' }],
      meta: { total: 1, page: 1 },
    });
    expect(first.headers['x-ratelimit-limit']).toBe('100');
    expect(first.headers['x-content-type-options']).toBe('nosniff');

    await request(app.getHttpServer())
      .get('/api/v1/provinces?search=KIN')
      .expect(200);
    expect(prisma.province.findMany).toHaveBeenCalledTimes(1);
  });

  it('POST /api/v1/provinces creates a province and invalidates the cache', async () => {
    await request(app.getHttpServer()).get('/api/v1/provinces').expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/provinces')
      .send({ name: 'Lualaba' })
      .expect(201)
      .expect((res) =>
        expect(res.body.data).toEqual({ id: 'id-3', name: 'Lualaba' }),
      );

    const res = await request(app.getHttpServer())
      .get('/api/v1/provinces')
      .expect(200);
    expect(res.body.meta.total).toBe(3);
    expect(prisma.province.findMany).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/provinces')
      .send({ name: '', extra: 1 })
      .expect(400);

    expect(res.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      errors: expect.arrayContaining(['property extra should not exist']),
    });
    expect(prisma.province.create).not.toHaveBeenCalled();
  });

  it('answers unknown routes with NOT_FOUND and echoes the request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/nope')
      .set('x-request-id', 'e2e-request-1')
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(res.headers['x-request-id']).toBe('e2e-request-1');
  });
});
