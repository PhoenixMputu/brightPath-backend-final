import {
  ConflictException,
  Controller,
  Get,
  INestApplication,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { Prisma } from '../../generated/prisma/client.js';

const SECRET = '$argon2id$v=19$SECRET-HASH';

@Controller('boom')
class BoomController {
  @Get('prisma')
  prisma(): never {
    throw new Prisma.PrismaClientValidationError(
      `Invalid \`prisma.user.create()\` invocation: { passwordHash: "${SECRET}" }`,
      { clientVersion: 'test' },
    );
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictException({
      statusCode: 409,
      code: 'EMAIL_ALREADY_IN_USE',
      message: 'Email is already in use',
    });
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('Nothing here');
  }
}

describe('AllExceptionsFilter', () => {
  let app: INestApplication;
  let logged: unknown[][];

  beforeEach(async () => {
    logged = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args) => {
      logged.push(args);
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [BoomController],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('turns an unexpected error into a generic 500 that leaks nothing', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/boom/prisma')
      .expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it('logs the error type and stack, but never its message', async () => {
    await request(app.getHttpServer()).get('/api/v1/boom/prisma').expect(500);

    expect(logged).toHaveLength(1);
    const [summary, frames] = logged[0];
    expect(summary).toBe('Unhandled PrismaClientValidationError');
    expect(frames).toEqual(expect.stringContaining('at '));
    expect(JSON.stringify(logged)).not.toContain('SECRET');
    expect(JSON.stringify(logged)).not.toContain('passwordHash');
  });

  it('returns HTTP exceptions unchanged and does not log them', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/boom/conflict')
      .expect(409)
      .expect({
        statusCode: 409,
        code: 'EMAIL_ALREADY_IN_USE',
        message: 'Email is already in use',
      });
    await request(app.getHttpServer())
      .get('/api/v1/boom/not-found')
      .expect(404)
      .expect({ message: 'Nothing here', error: 'Not Found', statusCode: 404 });

    expect(logged).toHaveLength(0);
  });
});
