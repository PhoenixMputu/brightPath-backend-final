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
const { Prisma } = await import('../src/generated/prisma/client.js');
const { setupSwagger } = await import('../src/swagger.js');
const { ROTATE_SESSION_SCRIPT } =
  await import('../src/modules/auth/token.service.js');

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
    eval: vi.fn(
      (script: string, _n: number, key: string, ...args: unknown[]) => {
        if (script === ROTATE_SESSION_SCRIPT) {
          // Same compare-and-set as the Lua script.
          const [userId, hash, next] = args as [string, string, string];
          const current = store.get(key);
          if (current === undefined) return Promise.resolve(0);
          const session = JSON.parse(current) as {
            userId: string;
            refreshTokenHash: string;
          };
          if (session.userId !== userId || session.refreshTokenHash !== hash) {
            store.delete(key);
            return Promise.resolve(-1);
          }
          store.set(key, next);
          return Promise.resolve(1);
        }
        // Throttler script: [totalHits, ttlMs, isBlocked, blockTtlMs].
        return Promise.resolve([incr(key), 60_000, 0, 0]);
      },
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

  /** An access_token cookie, as set by POST /auth/verify-email. */
  const signedIn = async () => {
    const token = await new JwtService({}).signAsync(
      { sub: 'u-1', sid: 's-1', typ: 'access' },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: 900,
        algorithm: 'HS256',
      },
    );
    return `access_token=${token}`;
  };

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
      .set('Cookie', await signedIn())
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

  it('POST /api/v1/provinces requires a signed-in user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/provinces')
      .send({ name: 'Lualaba' })
      .expect(401);

    expect(res.body).toEqual({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
    expect(prisma.province.create).not.toHaveBeenCalled();
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/provinces')
      .set('Cookie', await signedIn())
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
  provinceId: string;
  city: string;
  passwordHash: string;
  status: 'INACTIVE' | 'ACTIVE';
  createdAt: Date;
}

/**
 * Just enough of the Prisma user model for registration and verification,
 * with the province foreign key and relation.
 */
function fakeUsers(provinces: Province[]) {
  const rows: UserRow[] = [];
  const withProvince = (row: UserRow | undefined) =>
    row && {
      ...row,
      province: provinces.find((p) => p.id === row.provinceId),
    };
  return {
    rows,
    create: vi.fn(
      ({ data }: { data: Omit<UserRow, 'id' | 'status' | 'createdAt'> }) => {
        // Unique indexes are not modelled; the error is shaped like the pg
        // adapter's foreign key violation.
        if (!provinces.some((p) => p.id === data.provinceId)) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError(
              'Foreign key constraint violated',
              {
                code: 'P2003',
                clientVersion: 'e2e',
                meta: {
                  driverAdapterError: {
                    cause: { constraint: { index: 'users_province_id_fkey' } },
                  },
                },
              },
            ),
          );
        }
        const row: UserRow = {
          id: `019a7d2e-4b1c-7a3f-9e2d-00000000000${rows.length + 1}`,
          ...data,
          status: 'INACTIVE',
          createdAt: new Date('2026-11-21T10:00:00.000Z'),
        };
        rows.push(row);
        return Promise.resolve(withProvince(row));
      },
    ),
    findUnique: vi.fn(({ where }: { where: { email?: string; id?: string } }) =>
      Promise.resolve(
        withProvince(
          rows.find((row) =>
            where.id ? row.id === where.id : row.email === where.email,
          ),
        ) ?? null,
      ),
    ),
    update: vi.fn(
      ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) return Promise.reject(new Error('Record not found'));
        Object.assign(row, data);
        return Promise.resolve(withProvince(row));
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

  const province = {
    id: '019a6b1c-2d3e-7f40-8a51-6b7c8d9e0f12',
    name: 'Haut-Katanga',
  };
  const profile = {
    firstName: 'Victory',
    lastName: 'Deo',
    email: 'victory.deo@example.com',
    phone: '+243812345678',
    provinceId: province.id,
    city: 'Lubumbashi',
    password: 'Str0ngPassword',
  };

  beforeEach(async () => {
    sentEmails.length = 0;
    redis = fakeRedis();
    users = fakeUsers([province]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ ...fakePrisma([province]), user: users })
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
      data: {
        email: profile.email,
        province,
        city: 'Lubumbashi',
        status: 'ACTIVE',
      },
    });
    expect(res.body.data).not.toHaveProperty('provinceId');
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

    // The access cookie now identifies the user on protected routes.
    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', `access_token=${access.value}`)
      .expect(200);
    expect(me.body).toMatchObject({
      message: 'User retrieved successfully.',
      data: { id: users.rows[0].id, email: profile.email, status: 'ACTIVE' },
    });
    expect(me.body.data).not.toHaveProperty('passwordHash');

    // The refresh token cannot stand in for the access token (its secret
    // differs; the typ check is covered in jwt-auth.guard.spec.ts).
    const swapped = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', `access_token=${refresh.value}`)
      .expect(401);
    expect(swapped.body.code).toBe('UNAUTHENTICATED');
  });

  /** Registers and verifies the profile; returns its cookies and session id. */
  const signUp = async () => {
    await post('register', profile).expect(201);
    const res = await post('verify-email', {
      email: profile.email,
      code: lastCode(),
    }).expect(200);
    const { access_token: access, refresh_token: refresh } = cookiesOf(res);
    const { sid } = await new JwtService({}).verifyAsync<{ sid: string }>(
      access.value,
      { secret: process.env.JWT_ACCESS_SECRET },
    );
    return { access: access.value, refresh: refresh.value, sid };
  };

  const refreshWith = (refreshToken?: string) => {
    const req = request(app.getHttpServer()).post('/api/v1/auth/refresh');
    return refreshToken
      ? req.set('Cookie', `refresh_token=${refreshToken}`)
      : req;
  };

  it('refuses to register with an unknown province, and sends no email', async () => {
    const res = await post('register', {
      ...profile,
      provinceId: '019a6b1c-2d3e-7f40-8a51-000000000000',
    }).expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      code: 'PROVINCE_NOT_FOUND',
      message: 'Province not found',
    });
    expect(users.rows).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });

  it('rotates the refresh token and revokes the session when an old one is reused', async () => {
    const first = await signUp();
    const sessionKey = `brightpath:auth:session:${first.sid}`;

    const res = await refreshWith(first.refresh).expect(200);
    expect(res.body).toEqual({ message: 'Session refreshed successfully.' });
    expect(res.headers['cache-control']).toBe('no-store');
    const { access_token: access, refresh_token: refresh } = cookiesOf(res);
    expect(refresh.attributes).toEqual(
      expect.arrayContaining(['Path=/api/v1/auth', 'HttpOnly', 'Secure']),
    );
    expect(refresh.value).not.toBe(first.refresh);
    expect(res.text).not.toContain(refresh.value);

    // Same session, new tokens; the new access token works.
    const claims = await new JwtService({}).verifyAsync<{ sid: string }>(
      access.value,
      { secret: process.env.JWT_ACCESS_SECRET },
    );
    expect(claims.sid).toBe(first.sid);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', `access_token=${access.value}`)
      .expect(200);

    // The rotated token is still usable once more...
    const second = cookiesOf(await refreshWith(refresh.value).expect(200));
    expect(redis.store.has(sessionKey)).toBe(true);

    // ...but replaying an old one kills the whole session.
    const replay = await refreshWith(first.refresh).expect(401);
    expect(replay.body).toEqual({
      statusCode: 401,
      code: 'REFRESH_TOKEN_INVALID',
      message: 'Session expired, please sign in again',
    });
    expect(replay.headers['set-cookie']).toBeUndefined();
    expect(redis.store.has(sessionKey)).toBe(false);

    // Including for whoever holds the latest token.
    const latest = await refreshWith(second.refresh_token.value).expect(401);
    expect(latest.body.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('refuses to refresh without the refresh cookie or with the access token', async () => {
    const { access } = await signUp();

    expect((await refreshWith().expect(401)).body.code).toBe(
      'REFRESH_TOKEN_INVALID',
    );
    expect((await refreshWith(access).expect(401)).body.code).toBe(
      'REFRESH_TOKEN_INVALID',
    );
  });

  it('refuses to refresh once the account is no longer active, and revokes the session', async () => {
    const { refresh, sid } = await signUp();
    users.rows[0].status = 'INACTIVE';

    expect((await refreshWith(refresh).expect(401)).body.code).toBe(
      'REFRESH_TOKEN_INVALID',
    );
    expect(redis.store.has(`brightpath:auth:session:${sid}`)).toBe(false);
  });

  it('GET /api/v1/users/me answers 401 without the access cookie', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('Swagger (e2e)', () => {
  it('documents cookie auth on protected routes only', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma([]))
      .overrideProvider(REDIS_CLIENT)
      .useValue(fakeRedis())
      .compile();
    const app = configureApp(moduleRef.createNestApplication());
    setupSwagger(app);
    await app.init();

    try {
      const { body: spec } = await request(app.getHttpServer())
        .get('/docs-json')
        .expect(200);

      expect(spec.components.securitySchemes.access_token).toEqual({
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
        description: 'httpOnly cookie set when the user signs in.',
      });
      const cookieAuth = [{ access_token: [] }];
      expect(spec.paths['/api/v1/users/me'].get.security).toEqual(cookieAuth);
      expect(spec.paths['/api/v1/provinces'].post.security).toEqual(cookieAuth);
      expect(spec.paths['/api/v1/provinces'].get.security).toBeUndefined();
      expect(
        spec.paths['/api/v1/auth/verify-email'].post.security,
      ).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
