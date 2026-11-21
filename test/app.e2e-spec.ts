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
  JWT_ACCESS_SECRET: 'e2e-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-at-least-32-characters',
});

const { AppModule } = await import('../src/app.module.js');
const { configureApp } = await import('../src/app.setup.js');
const { PrismaService } = await import('../src/prisma/prisma.service.js');
const { REDIS_CLIENT } = await import('../src/redis/redis.constants.js');
const { EmailService } =
  await import('../src/integrations/resend/email.service.js');
const { JwtService } = await import('@nestjs/jwt');

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
    del: vi.fn((...keys: string[]) =>
      Promise.resolve(keys.filter((key) => store.delete(key)).length),
    ),
    // Throttler script: [totalHits, ttlMs, isBlocked, blockTtlMs].
    eval: vi.fn((_script: string, _n: number, hitsKey: string) =>
      Promise.resolve([incr(hitsKey), 60_000, 0, 0]),
    ),
    multi: vi.fn(() => {
      const ops: Array<() => unknown> = [];
      const chain = {
        incr: (key: string) => (ops.push(() => incr(key)), chain),
        expire: () => (ops.push(() => 1), chain),
        set: (key: string, value: string) => (
          ops.push(() => (store.set(key, value), 'OK')),
          chain
        ),
        del: (...keys: string[]) => (
          ops.push(() => keys.filter((key) => store.delete(key)).length),
          chain
        ),
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

interface UserRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  passwordHash: string;
  status: 'INACTIVE' | 'ACTIVE';
  createdAt: Date;
}

/** Just enough of the Prisma user model for registration and verification. */
function fakeUsers() {
  const rows: UserRow[] = [];
  return {
    rows,
    create: vi.fn(
      ({ data }: { data: Omit<UserRow, 'id' | 'status' | 'createdAt'> }) => {
        const row: UserRow = {
          id: `019a7d2e-4b1c-7a3f-9e2d-00000000000${rows.length + 1}`,
          ...data,
          status: 'INACTIVE',
          createdAt: new Date('2026-11-21T10:00:00.000Z'),
        };
        rows.push(row);
        return Promise.resolve(row);
      },
    ),
    findUnique: vi.fn(({ where }: { where: { email: string } }) =>
      Promise.resolve(rows.find((row) => row.email === where.email) ?? null),
    ),
    update: vi.fn(
      ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return Promise.reject(new Error('Record not found'));
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    ),
    delete: vi.fn(),
  };
}

describe('Email verification (e2e)', () => {
  let app: INestApplication<App>;
  let redis: ReturnType<typeof fakeRedis>;
  let users: ReturnType<typeof fakeUsers>;
  const sentEmails: Array<{ to: string; text: string }> = [];

  const profile = {
    firstName: 'Victory',
    lastName: 'Deo',
    email: 'victory.deo@example.com',
    phone: '+243812345678',
    password: 'Str0ngPassword',
  };

  beforeEach(async () => {
    sentEmails.length = 0;
    redis = fakeRedis();
    users = fakeUsers();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ ...fakePrisma([]), user: users })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .overrideProvider(EmailService)
      .useValue({
        send: vi.fn((email: { to: string; text: string }) => {
          sentEmails.push(email);
          return Promise.resolve('email-id');
        }),
      })
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (path: string, body: object) =>
    request(app.getHttpServer()).post(`/api/v1/auth/${path}`).send(body);

  /** The 6-digit code of the last verification email. */
  const lastCode = () => /\b(\d{6})\b/.exec(sentEmails.at(-1)?.text ?? '')?.[1];

  const cookiesOf = (res: request.Response) =>
    Object.fromEntries(
      ([] as string[]).concat(res.headers['set-cookie'] ?? []).map((line) => {
        const [pair, ...attributes] = line.split('; ');
        const [name, value] = pair.split('=');
        return [name, { value, attributes }];
      }),
    );

  it('signs the user in with httpOnly cookies once the email is verified', async () => {
    await post('register', profile).expect(201);
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);

    const wrong = code === '000000' ? '111111' : '000000';
    const rejected = await post('verify-email', {
      email: profile.email,
      code: wrong,
    }).expect(400);
    expect(rejected.body.code).toBe('OTP_INVALID');
    expect(rejected.headers['set-cookie']).toBeUndefined();

    const res = await post('verify-email', {
      email: profile.email,
      code,
    }).expect(200);

    expect(res.body).toMatchObject({
      message: 'Email verified successfully.',
      data: { email: profile.email, status: 'ACTIVE' },
    });
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(res.headers['cache-control']).toBe('no-store');

    const { access_token: access, refresh_token: refresh } = cookiesOf(res);
    expect(access.attributes).toEqual(
      expect.arrayContaining([
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
      ]),
    );
    expect(refresh.attributes).toEqual(
      expect.arrayContaining([
        'Path=/api/v1/auth',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
      ]),
    );
    expect(res.text).not.toContain(access.value);
    expect(res.text).not.toContain(refresh.value);

    const jwt = new JwtService({});
    const claims = await jwt.verifyAsync<{
      sub: string;
      sid: string;
      typ: string;
    }>(access.value, { secret: process.env.JWT_ACCESS_SECRET });
    expect(claims).toMatchObject({ sub: users.rows[0].id, typ: 'access' });
    await expect(
      jwt.verifyAsync(refresh.value, {
        secret: process.env.JWT_REFRESH_SECRET,
      }),
    ).resolves.toMatchObject({ sid: claims.sid, typ: 'refresh' });

    const session = redis.store.get(`brightpath:auth:session:${claims.sid}`);
    expect(session).toBeDefined();
    expect(session).not.toContain(refresh.value);

    const again = await post('verify-email', { email: profile.email, code });
    expect(again.status).toBe(409);
    expect(again.headers['set-cookie']).toBeUndefined();
  });
});
