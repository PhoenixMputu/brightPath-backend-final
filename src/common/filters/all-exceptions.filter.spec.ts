import {
  Body,
  ConflictException,
  Controller,
  Get,
  INestApplication,
  Logger,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IsEmail } from 'class-validator';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { Prisma } from '../../generated/prisma/client.js';

const SECRET = '$argon2id$v=19$SECRET-HASH';

class EmailBody {
  @IsEmail()
  email: string;
}

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

  @Get('unavailable')
  unavailable(): never {
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: 'VERIFICATION_EMAIL_NOT_SENT',
      message: 'Verification email could not be sent',
    });
  }

  @Post('validate')
  validate(@Body() body: EmailBody): EmailBody {
    return body;
  }
}

describe('AllExceptionsFilter', () => {
  let app: INestApplication;
  let logged: unknown[][];
  let warned: unknown[][];

  beforeEach(async () => {
    logged = [];
    warned = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args) => {
      logged.push(args);
    });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args) => {
      warned.push(args);
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
    const [fields, message] = logged[0] as [
      { err: { type: string; stack: string } },
      string,
    ];
    expect(message).toBe('Unhandled exception');
    expect(fields.err.type).toBe('PrismaClientValidationError');
    expect(fields.err.stack).toEqual(expect.stringContaining('at '));
    expect(JSON.stringify(logged)).not.toContain('SECRET');
    expect(JSON.stringify(logged)).not.toContain('passwordHash');
  });

  it('keeps explicit codes and does not log expected 4xx', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/boom/conflict')
      .expect(409)
      .expect({
        statusCode: 409,
        code: 'EMAIL_ALREADY_IN_USE',
        message: 'Email is already in use',
      });

    expect(logged).toHaveLength(0);
    expect(warned).toHaveLength(0);
  });

  it('derives a code from the status and warns about unexpected 4xx', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/boom/not-found')
      .expect(404)
      .expect({ statusCode: 404, code: 'NOT_FOUND', message: 'Nothing here' });
    await request(app.getHttpServer())
      .get('/api/v1/unknown-route')
      .expect(404)
      .expect((res) => expect(res.body.code).toBe('NOT_FOUND'));

    expect(warned).toHaveLength(2);
    expect(logged).toHaveLength(0);
  });

  it('returns validation errors as VALIDATION_FAILED with readable messages', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/boom/validate')
      .send({ email: 'nope', extra: true })
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      errors: expect.arrayContaining([
        'email must be an email',
        'property extra should not exist',
      ]),
    });
  });

  it('logs 5xx HTTP exceptions as errors', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/boom/unavailable')
      .expect(503)
      .expect({
        statusCode: 503,
        code: 'VERIFICATION_EMAIL_NOT_SENT',
        message: 'Verification email could not be sent',
      });

    expect(logged).toHaveLength(1);
    expect(logged[0][0]).toMatchObject({
      statusCode: 503,
      code: 'VERIFICATION_EMAIL_NOT_SENT',
    });
  });
});
