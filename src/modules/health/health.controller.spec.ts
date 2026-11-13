import { INestApplication, Logger } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { PrismaHealthIndicator } from '../../prisma/prisma.health.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../redis/redis.constants.js';
import { RedisHealthIndicator } from '../../redis/redis.health.js';
import { HealthController } from './health.controller.js';

/**
 * Runs the real controller and the real indicators through Terminus; only the
 * database and Redis clients are mocked.
 */
describe('HealthController', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: vi.fn() };
  const redis = { ping: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule.forRoot({ logger: false })],
      controllers: [HealthController],
      providers: [
        PrismaHealthIndicator,
        RedisHealthIndicator,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterEach(() => app.close());

  it('GET /health reports up when the database and Redis respond', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');

    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      details: { database: { status: 'up' }, redis: { status: 'up' } },
    });
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('GET /health stays 200 but degraded when Redis is down', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    redis.ping.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1'));

    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body.details.redis).toEqual({
      status: 'degraded',
      message: 'Redis is unreachable',
    });
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.1');
  });

  it('GET /health returns 503 without leaking details when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error("Can't reach database server at db.internal:5432"),
    );
    redis.ping.mockResolvedValue('PONG');

    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);

    expect(res.body.details.database).toEqual({
      status: 'down',
      message: 'Database is unreachable',
    });
    expect(JSON.stringify(res.body)).not.toContain('db.internal');
  });

  it('GET /health/live is 200 without touching any dependency', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });
});
