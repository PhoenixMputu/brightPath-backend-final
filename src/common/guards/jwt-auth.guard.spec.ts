import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { JwtStrategy } from '../../modules/auth/strategies/jwt.strategy.js';
import {
  type AuthUser,
  CurrentUser,
} from '../decorators/current-user.decorator.js';
import { Public } from '../decorators/public.decorator.js';
import {
  ACCESS_TOKEN_EXPIRED_CODE,
  JwtAuthGuard,
  UNAUTHENTICATED_CODE,
} from './jwt-auth.guard.js';

const ACCESS_SECRET = 'a'.repeat(32);
const REFRESH_SECRET = 'r'.repeat(32);

@Controller('probe')
class ProbeController {
  @Public()
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('closed')
  closed(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}

@Public()
@Controller('public-probe')
class PublicProbeController {
  @Get()
  open(): { ok: true } {
    return { ok: true };
  }
}

/**
 * The real guard, strategy, decorators and cookie parsing, wired like in
 * AppModule, on two throwaway controllers.
 */
describe('JwtAuthGuard with JwtStrategy', () => {
  let app: INestApplication;
  const jwt = new JwtService({});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProbeController, PublicProbeController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        {
          provide: ConfigService,
          useValue: { get: () => ACCESS_SECRET },
        },
      ],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(() => app.close());

  const sign = (
    payload: object,
    { secret = ACCESS_SECRET, expiresIn = 900 } = {},
  ) => jwt.signAsync(payload, { secret, expiresIn, algorithm: 'HS256' });
  const access = { sub: 'u-1', sid: 's-1', typ: 'access' };

  const closed = (cookie?: string) => {
    const req = request(app.getHttpServer()).get('/api/v1/probe/closed');
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const expectCode = async (res: request.Test, code: string) => {
    const { body } = await res.expect(401);
    expect(body).toMatchObject({ statusCode: 401, code });
  };

  it('lets anyone reach a @Public() route', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/probe/open')
      .expect(200, { ok: true });
  });

  it('lets anyone reach a route of a @Public() controller', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/public-probe')
      .expect(200, { ok: true });
  });

  it('protects every other route by default', async () => {
    await expectCode(closed(), UNAUTHENTICATED_CODE);
  });

  it('accepts a valid access token from the cookie and exposes the user', async () => {
    const token = await sign(access);
    await closed(`access_token=${token}`).expect(200, {
      userId: 'u-1',
      sessionId: 's-1',
    });
  });

  it('ignores a token sent in the Authorization header', async () => {
    const token = await sign(access);
    await expectCode(
      closed().set('Authorization', `Bearer ${token}`),
      UNAUTHENTICATED_CODE,
    );
  });

  it('rejects a refresh token used as an access token', async () => {
    const refreshClaims = { ...access, typ: 'refresh' };
    // Even if it were signed with the access secret.
    for (const secret of [REFRESH_SECRET, ACCESS_SECRET]) {
      const token = await sign(refreshClaims, { secret });
      await expectCode(closed(`access_token=${token}`), UNAUTHENTICATED_CODE);
    }
  });

  it('rejects a token signed with another secret', async () => {
    const token = await sign(access, { secret: 'x'.repeat(32) });
    await expectCode(closed(`access_token=${token}`), UNAUTHENTICATED_CODE);
  });

  it.each([
    ['without a subject', { sid: 's-1', typ: 'access' }],
    ['without a session', { sub: 'u-1', typ: 'access' }],
    ['with an empty subject', { sub: '', sid: 's-1', typ: 'access' }],
  ])('rejects a token %s', async (_label, claims) => {
    const token = await sign(claims);
    await expectCode(closed(`access_token=${token}`), UNAUTHENTICATED_CODE);
  });

  it('rejects an unsigned token (alg none)', async () => {
    const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString(
      'base64url',
    );
    const body = Buffer.from(JSON.stringify(access)).toString('base64url');
    await expectCode(
      closed(`access_token=${header}.${body}.`),
      UNAUTHENTICATED_CODE,
    );
  });

  it('rejects a malformed cookie', async () => {
    await expectCode(closed('access_token=not-a-jwt'), UNAUTHENTICATED_CODE);
  });

  it('tells the client to refresh when the token is only expired', async () => {
    const token = await sign(access, { expiresIn: -10 });
    await expectCode(
      closed(`access_token=${token}`),
      ACCESS_TOKEN_EXPIRED_CODE,
    );
  });
});
